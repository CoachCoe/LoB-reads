/**
 * Sliding-window rate limiter.
 *
 * IMPORTANT: state lives in this process's memory. That is correct for local
 * development and a single long-lived server, but it does NOT hold across
 * serverless instances — each cold start gets its own empty window, so a
 * distributed deployment will let through roughly (limit x instances).
 *
 * The `checkLimit` signature is deliberately storage-agnostic so swapping the
 * body for Upstash Redis (or any shared store) is a change to this file alone.
 */

const globalForRateLimit = globalThis as unknown as {
  rateLimitBuckets: Map<string, number[]> | undefined;
};

// Reuse across hot reloads in dev, otherwise every edit resets every window.
const buckets =
  globalForRateLimit.rateLimitBuckets ?? new Map<string, number[]>();

if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.rateLimitBuckets = buckets;
}

export interface RateLimitOptions {
  /** Maximum number of hits permitted inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Hits still available in the current window. */
  remaining: number;
  /** Seconds until the window frees up. 0 when the request was allowed. */
  retryAfterSeconds: number;
}

/**
 * Hard cap on tracked keys. Eviction is least-recently-touched and O(1)
 * amortised — see the note in `checkLimit`.
 */
const MAX_BUCKETS = 10_000;

export function checkLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  const hits = (buckets.get(key) ?? []).filter(
    (timestamp) => timestamp > windowStart
  );

  // Touch the key on every call, allowed or not, so an actively-limited client
  // stays at the back of the eviction order and cannot be flushed out by a flood
  // of unrelated keys. A Map iterates in insertion order, so delete-then-set is
  // what moves an entry to the back.
  buckets.delete(key);

  if (hits.length >= limit) {
    const oldest = hits[0];
    buckets.set(key, hits);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + windowMs - now) / 1000)
      ),
    };
  }

  hits.push(now);
  buckets.set(key, hits);

  // Keep the map from growing without bound in a long-lived process.
  //
  // This used to scan EVERY bucket on every call once size passed MAX_BUCKETS,
  // deleting only buckets whose every timestamp had already aged out. With
  // LIMITS.register's one-hour window a fresh bucket is unprunable for an hour,
  // so the map grew monotonically while each call got more expensive: measured
  // at 10ms for the first 9,000 keys, then ~2,000ms per 5,000 once the map
  // reached 25,000 — quadratic total work, reachable unauthenticated by
  // rotating X-Forwarded-For against /api/auth/register. Evicting the
  // least-recently-touched entry is O(1) amortised and bounds memory outright.
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }

  return {
    allowed: true,
    remaining: limit - hits.length,
    retryAfterSeconds: 0,
  };
}

/**
 * Best-effort client identifier for rate-limit keys. Falls back to a shared
 * bucket when no forwarding header is present, which is the safe direction:
 * unknown clients share a limit rather than each getting their own.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Shared limits, kept here so they're visible in one place. */
export const LIMITS = {
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  upload: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitOptions>;

/** Test-only escape hatch; not exported through any route. */
export function __resetRateLimits() {
  buckets.clear();
}
