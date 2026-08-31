/**
 * @jest-environment node
 */
import {
  checkLimit,
  getClientIp,
  __resetRateLimits,
} from "@/lib/rate-limit";

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
  it("takes the first address from x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.5, 70.41.3.18" },
    });
    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "203.0.113.9" },
    });
    expect(getClientIp(request)).toBe("203.0.113.9");
  });

  it("buckets unidentifiable clients together rather than exempting them", () => {
    const request = new Request("https://example.com");
    expect(getClientIp(request)).toBe("unknown");
  });
});
