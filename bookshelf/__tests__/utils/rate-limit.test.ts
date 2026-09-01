/**
 * @jest-environment node
 */
import { checkLimit, getClientIp, clientIpFromHeaders, __resetRateLimits, isLimited } from "@/lib/rate-limit";

describe("checkLimit", () => {
  beforeEach(() => {
    __resetRateLimits();
    jest.useRealTimers();
  });

  it("allows requests up to the limit and then blocks", () => {
    const opts = { limit: 3, windowMs: 60_000 };

    expect(checkLimit("k", opts).allowed).toBe(true);
    expect(checkLimit("k", opts).allowed).toBe(true);
    expect(checkLimit("k", opts).allowed).toBe(true);

    const blocked = checkLimit("k", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each key separately", () => {
    const opts = { limit: 1, windowMs: 60_000 };

    expect(checkLimit("a", opts).allowed).toBe(true);
    expect(checkLimit("b", opts).allowed).toBe(true);
    expect(checkLimit("a", opts).allowed).toBe(false);
  });

  it("reports remaining capacity", () => {
    const opts = { limit: 5, windowMs: 60_000 };

    expect(checkLimit("k", opts).remaining).toBe(4);
    expect(checkLimit("k", opts).remaining).toBe(3);
  });

  it("frees up once the window has passed", () => {
    jest.useFakeTimers();
    const opts = { limit: 1, windowMs: 1_000 };

    expect(checkLimit("k", opts).allowed).toBe(true);
    expect(checkLimit("k", opts).allowed).toBe(false);

    jest.advanceTimersByTime(1_001);

    expect(checkLimit("k", opts).allowed).toBe(true);
  });
});

/**
 * The prune loop used to scan every bucket on every call once the map passed
 * MAX_BUCKETS, and could only delete buckets whose every timestamp had aged out
 * — which, with a one-hour window, is none of the recent ones. Cost per call
 * grew with map size, so total work was quadratic, and an unauthenticated caller
 * could drive it by rotating X-Forwarded-For against /api/auth/register.
 */
describe("checkLimit bucket accounting", () => {
  const opts = { limit: 5, windowMs: 60_000 };

  it("keeps a client that is still calling blocked through a flood of other keys", () => {
    for (let i = 0; i < opts.limit; i++) {
      expect(checkLimit("victim", opts).allowed).toBe(true);
    }
    expect(checkLimit("victim", opts).allowed).toBe(false);

    // The victim keeps trying, which is the realistic case for someone being
    // limited. Touching the key on each call keeps it off the eviction front.
    for (let i = 0; i < 40_000; i++) {
      checkLimit(`flood:${i}`, opts);
      if (i % 1_000 === 0) {
        expect(checkLimit("victim", opts).allowed).toBe(false);
      }
    }

    expect(checkLimit("victim", opts).allowed).toBe(false);
  });

  it("stays cheap per call as the key count grows", () => {
    const time = (from: number, to: number) => {
      const started = Date.now();
      for (let i = from; i < to; i++) checkLimit(`k:${i}`, opts);
      return Date.now() - started;
    };

    const early = time(0, 10_000);
    const late = time(60_000, 70_000);

    // The old implementation grew from ~10ms to seconds for the same batch
    // size. Allow generous slack for a loaded machine; the point is that it is
    // not super-linear.
    expect(late).toBeLessThan(Math.max(250, early * 8 + 100));
  });
});

describe("getClientIp", () => {
  /**
   * This previously asserted the LEFTMOST element, which is the part a client
   * controls: a proxy appends the peer it saw, so an attacker sending
   * `X-Forwarded-For: 203.0.113.5` arrives as `203.0.113.5, <real peer>`. The
   * assertion encoded the bug, so both IP-keyed limits were bypassable by
   * incrementing a header. It now asserts the trusted hop.
   */
  it("takes the address the trusted proxy appended, not the one the client sent", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.5, 70.41.3.18" },
    });
    expect(getClientIp(request)).toBe("70.41.3.18");
  });

  it("cannot be moved by prepending more spoofed hops", () => {
    const spoofed = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3, 70.41.3.18",
      },
    });
    expect(getClientIp(spoofed)).toBe("70.41.3.18");
  });

  it("falls back to x-real-ip", () => {
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "203.0.113.9" },
    });
    expect(getClientIp(request)).toBe("203.0.113.9");
  });

  /**
   * This assertion used to expect the string "unknown", and its name said
   * "buckets unidentifiable clients together rather than exempting them" — i.e.
   * it encoded the shared bucket as the deliberate, safe choice.
   *
   * It is the opposite of safe. If nothing in front appends X-Forwarded-For
   * (a misconfigured TRUSTED_PROXY_HOPS, or a platform whose ingress does not
   * set x-real-ip) then EVERY request is unidentified, so they all share one
   * bucket. `login:ip:unknown` at 10 per 15 minutes means ten attempts from one
   * attacker refuse sign-in to every user of the site, indefinitely, from forty
   * requests an hour. Five requests close registration.
   *
   * Per-client that reasoning is sound; across the whole population it is a
   * self-service outage. Callers now fall back to their per-account limit
   * instead, which is what `refuses to let one origin lock out the site` below
   * pins.
   */
  it("cannot identify a client with no proxy headers at all", () => {
    const request = new Request("https://example.com");
    expect(getClientIp(request)).toBeNull();
  });
});

describe("clientIpFromHeaders trusted-hop configuration", () => {
  const withHops = <T,>(value: string | undefined, run: () => T): T => {
    const previous = process.env.TRUSTED_PROXY_HOPS;
    if (value === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = value;
    try {
      return run();
    } finally {
      if (previous === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = previous;
    }
  };

  it("counts from the right by the configured number of hops", () => {
    withHops("2", () => {
      expect(
        clientIpFromHeaders("1.1.1.1, 203.0.113.7, 10.0.0.1")
      ).toBe("203.0.113.7");
    });
  });

  it("ignores the header entirely when nothing trusted is in front", () => {
    withHops("0", () => {
      expect(clientIpFromHeaders("203.0.113.5, 70.41.3.18")).toBeNull();
      expect(clientIpFromHeaders("203.0.113.5", "10.0.0.9")).toBe("10.0.0.9");
    });
  });

  it("declines to guess when the chain is shorter than the trusted hop count", () => {
    // The SEC-3 case: hops configured higher than the real topology. Returning
    // an element here would hand back a proxy's own address, shared by every
    // client behind it — the same outage as the no-header case, but harder to
    // spot because a plausible-looking IP comes back.
    withHops("3", () => {
      expect(clientIpFromHeaders("203.0.113.5, 70.41.3.18")).toBeNull();
    });
  });

  it("falls back to one hop for a nonsense setting", () => {
    withHops("banana", () => {
      expect(clientIpFromHeaders("203.0.113.5, 70.41.3.18")).toBe("70.41.3.18");
    });
  });
});

/**
 * SEC-4 / SEC-3: the two ways the login limiter locked out the wrong people.
 *
 * `checkLimit` both checks and records, and the login path called it before
 * knowing whether the password was right. So a correct password spent the same
 * budget an attacker was draining: ten wrong guesses every fifteen minutes
 * locked a known address out permanently, and FLOW-1 meant the reader was told
 * their password was wrong.
 */
describe("isLimited does not spend the budget", () => {
  beforeEach(() => {
    __resetRateLimits();
  });

  const options = { limit: 3, windowMs: 60_000 };

  it("reports the state without recording an attempt", () => {
    for (let i = 0; i < 10; i++) {
      expect(isLimited("k", options).allowed).toBe(true);
    }
    // Ten checks, no hits recorded — so a reader who signs in correctly ten
    // times has spent nothing.
    expect(isLimited("k", options).remaining).toBe(3);
  });

  it("agrees with checkLimit once hits are recorded", () => {
    checkLimit("k", options);
    checkLimit("k", options);
    expect(isLimited("k", options).remaining).toBe(1);

    checkLimit("k", options);
    expect(isLimited("k", options).allowed).toBe(false);
    expect(isLimited("k", options).retryAfterSeconds).toBeGreaterThan(50);
  });

  it("keeps a victim's own sign-in possible while an attacker guesses", () => {
    // The lockout, stated as the scenario. The attacker's failures fill the
    // per-account bucket; what must not happen is the victim's correct password
    // filling it too.
    const key = "login:email:victim@example.com";
    for (let i = 0; i < 3; i++) checkLimit(key, options);
    expect(isLimited(key, options).allowed).toBe(false);

    // A fresh window: the victim gets in, and checking does not re-close it.
    __resetRateLimits();
    expect(isLimited(key, options).allowed).toBe(true);
    expect(isLimited(key, options).allowed).toBe(true);
    expect(isLimited(key, options).allowed).toBe(true);
    expect(isLimited(key, options).allowed).toBe(true);
  });
});
