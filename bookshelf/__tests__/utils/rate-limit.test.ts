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
