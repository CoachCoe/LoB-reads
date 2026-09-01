/**
 * @jest-environment node
 */
import { checkLimit, getClientIp, clientIpFromHeaders, __resetRateLimits, refundHit, clientRateLimitKey, clientIdentificationConfigured } from "@/lib/rate-limit";

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
 * SEC-4: a correct password must not spend the budget an attacker is draining.
 *
 * The login path called `checkLimit` before knowing whether the password was
 * right, so ten wrong guesses every fifteen minutes locked a known address out
 * permanently — and FLOW-1 meant the reader was told their password was wrong.
 *
 * The first attempt at this was a check-without-recording call, and /bastion was
 * right to reject it: `checkLimit` is a single synchronous check-and-record, so
 * it bounds concurrency. Reading the bucket, awaiting bcrypt for ~100ms and
 * recording afterwards let parallel attempts all observe an empty bucket and all
 * proceed. The concurrency assertion below is the one that would have caught it.
 */
describe("refundHit", () => {
  beforeEach(() => {
    __resetRateLimits();
  });

  const options = { limit: 3, windowMs: 60_000 };

  it("gives one attempt back", () => {
    checkLimit("k", options);
    checkLimit("k", options);
    expect(checkLimit("k", options).allowed).toBe(true);
    expect(checkLimit("k", options).allowed).toBe(false);

    refundHit("k");
    expect(checkLimit("k", options).allowed).toBe(true);
  });

  it("does nothing to a key with no hits", () => {
    refundHit("never-seen");
    expect(checkLimit("never-seen", options).remaining).toBe(2);
  });

  it("keeps a reader signing in indefinitely without spending the budget", () => {
    const key = "login:email:reader@example.com";

    // Ten successful sign-ins: record then refund each time.
    for (let i = 0; i < 10; i++) {
      expect(checkLimit(key, options).allowed).toBe(true);
      refundHit(key);
    }

    // The budget is untouched, so an attacker has not been handed a lockout and
    // the reader has not locked themselves out either.
    expect(checkLimit(key, options).allowed).toBe(true);
  });

  it("still bounds attempts that are never refunded", () => {
    const key = "login:email:victim@example.com";
    for (let i = 0; i < 3; i++) checkLimit(key, options);

    // Three failures, no refunds: the limiter still does its job.
    expect(checkLimit(key, options).allowed).toBe(false);
  });

  /**
   * The regression /bastion found, asserted directly.
   *
   * With a check-then-act split, N concurrent attempts all read an empty bucket
   * before any of them writes, so a limit of 3 admits N. Recording on arrival is
   * what makes this hold, and it holds only because checkLimit does both halves
   * in one synchronous step.
   */
  it("admits no more than the limit under concurrent arrival", async () => {
    const key = "login:ip:203.0.113.1";

    const attempts = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const result = checkLimit(key, options);
        // An await between the check and whatever follows it, as bcrypt is.
        await Promise.resolve();
        return result.allowed;
      })
    );

    expect(attempts.filter(Boolean)).toHaveLength(options.limit);
  });
});

/**
 * The key builder exists because `string | null` is not a guard.
 *
 * TypeScript accepts `` `login:ip:${ip}` `` with a nullable `ip` and produces the
 * literal "login:ip:null" — one shared bucket for the entire internet, which is
 * the outage the null was introduced to prevent, reintroduced by writing the
 * obvious thing. Returning the key already built means there is no null to
 * interpolate.
 */
describe("clientRateLimitKey", () => {
  const request = (headers: Record<string, string> = {}) =>
    new Request("https://example.com", { headers });

  it("builds a prefixed key for an identifiable client", () => {
    expect(
      clientRateLimitKey(request({ "x-real-ip": "203.0.113.9" }), "register")
    ).toBe("register:203.0.113.9");
  });

  it("returns null rather than a key naming null", () => {
    const key = clientRateLimitKey(request(), "register");

    expect(key).toBeNull();
    // The failure mode, stated: any string here would be shared by every caller.
    expect(key).not.toBe("register:null");
    expect(key).not.toBe("register:unknown");
  });
});

/**
 * A platform-set client-IP header, which is how the hop-counting problem is
 * meant to be avoided rather than tuned.
 *
 * Front Door sets `X-Azure-ClientIP`. Reading it removes the arithmetic — but
 * only if the app cannot be reached except through Front Door, because a
 * Container App's own ingress FQDN is public by default and an attacker who
 * reaches it directly can set the header themselves and take a fresh bucket per
 * request. That is a deployment fact this code cannot observe, so trust is
 * opt-in by configuration and the default must remain "not trusted".
 */
describe("a configured platform client-IP header", () => {
  const withEnv = <T,>(vars: Record<string, string | undefined>, run: () => T): T => {
    const previous: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      previous[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return run();
    } finally {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  const request = (headers: Record<string, string>) =>
    new Request("https://example.com", { headers });

  it("is ignored unless it is configured", () => {
    // The assertion that matters most. Without this, anyone reaching the app
    // directly picks their own bucket.
    withEnv({ TRUSTED_CLIENT_IP_HEADER: undefined, TRUSTED_PROXY_HOPS: "1" }, () => {
      expect(
        getClientIp(
          request({
            "x-azure-clientip": "9.9.9.9",
            "x-forwarded-for": "203.0.113.5, 70.41.3.18",
          })
        )
      ).toBe("70.41.3.18");
    });
  });

  it("wins over the forwarded chain once configured", () => {
    withEnv({ TRUSTED_CLIENT_IP_HEADER: "x-azure-clientip", TRUSTED_PROXY_HOPS: "1" }, () => {
      expect(
        getClientIp(
          request({
            "x-azure-clientip": "9.9.9.9",
            "x-forwarded-for": "203.0.113.5, 70.41.3.18",
          })
        )
      ).toBe("9.9.9.9");
    });
  });

  it("falls back to the chain when the configured header is absent", () => {
    // A revision reachable both ways, or a misconfigured name: fall back rather
    // than collapsing everyone onto one bucket.
    withEnv({ TRUSTED_CLIENT_IP_HEADER: "x-azure-clientip", TRUSTED_PROXY_HOPS: "1" }, () => {
      expect(
        getClientIp(request({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" }))
      ).toBe("70.41.3.18");
    });
  });

  it("reports whether this deployment can identify a client at all", () => {
    withEnv({ TRUSTED_CLIENT_IP_HEADER: undefined, TRUSTED_PROXY_HOPS: "0" }, () => {
      expect(clientIdentificationConfigured()).toBe(false);
    });
    withEnv({ TRUSTED_CLIENT_IP_HEADER: "x-azure-clientip", TRUSTED_PROXY_HOPS: "0" }, () => {
      expect(clientIdentificationConfigured()).toBe(true);
    });
    withEnv({ TRUSTED_CLIENT_IP_HEADER: undefined, TRUSTED_PROXY_HOPS: "2" }, () => {
      expect(clientIdentificationConfigured()).toBe(true);
    });
  });
});
