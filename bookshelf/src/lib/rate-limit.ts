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

/**
 * Give back one recorded hit.
 *
 * The budget is spent by an attempt when it arrives, atomically, and refunded if
 * the attempt turns out not to have been abuse — a correct password, or a request
 * the schema rejected before any work was done.
 *
 * This exists instead of a check-without-recording call, which was tried and was
 * a concurrency bypass: reading the bucket, awaiting bcrypt for ~100ms and
 * recording afterwards let a hundred parallel sign-in attempts all observe an
 * empty bucket and all proceed, so a limit of ten became a hundred. `checkLimit`
 * is a single synchronous check-and-record and bounds concurrency for free;
 * anything that splits it does not.
 *
 * Removes the most recent hit, so a refund cannot resurrect one that has already
 * aged out of the window.
 */
export function refundHit(key: string): void {
  const hits = buckets.get(key);
  if (!hits || hits.length === 0) return;

  hits.pop();
  if (hits.length === 0) buckets.delete(key);
  else buckets.set(key, hits);
}

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
 * A single header the platform sets and the client cannot reach, if one exists.
 *
 * Azure Front Door sets `X-Azure-ClientIP`, and reading it removes the
 * hop-counting problem outright — no arithmetic about how many proxies append to
 * `X-Forwarded-For`, and nothing to get off by one.
 *
 * It is **opt-in by configuration and must stay that way.** The header is only
 * unforgeable if the app cannot be reached except through the proxy that sets
 * it: a Container App's own ingress FQDN is public by default, so an attacker
 * who can reach it directly can send whatever `X-Azure-ClientIP` they like and
 * pick a fresh rate-limit bucket per request. Trusting it therefore depends on a
 * deployment fact this code cannot observe — that direct ingress is blocked, by
 * Front Door ID validation or an access restriction — so it is named explicitly
 * rather than sniffed.
 *
 * Empty means "not configured", which falls through to hop counting below.
 */
function trustedClientIpHeader(): string | null {
  const configured = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  return configured ? configured : null;
}

/**
 * How many proxies we sit behind and therefore trust to have appended to
 * `X-Forwarded-For`.
 *
 * One by default, which is wrong for the documented topology and is why
 * `TRUSTED_CLIENT_IP_HEADER` exists: Front Door in front of Container Apps is
 * two appending hops, because the Container Apps ingress appends as well. A
 * count lower than the real chain returns a proxy's own address — identical for
 * every client — and a count higher than it returns nothing.
 *
 * Set to 0 to ignore the header entirely, which is the right answer when
 * nothing trusted is in front of the app.
 */
function trustedProxyHops(): number {
  const configured = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  return Number.isInteger(configured) && configured >= 0 ? configured : 1;
}

/**
 * Client identifier for rate-limit keys, derived from the part of
 * `X-Forwarded-For` a trusted proxy actually wrote.
 *
 * This used to take the LEFTMOST element, which is precisely the part the client
 * controls: a proxy *appends* the peer it saw, so `XFF: 1.2.3.4` arriving from
 * an attacker becomes `1.2.3.4, <real peer>`. Reading the left meant every
 * IP-keyed limit could be defeated by incrementing a header — unbounded
 * registrations against LIMITS.register, and `login:ip:*`, whose whole job is to
 * stop one host guessing across many accounts, reduced to nothing.
 *
 * Counting from the right instead: with one trusted hop the last element is what
 * that proxy observed, which the client cannot forge.
 *
 * Falls back to a shared bucket when there is nothing usable, which is the safe
 * direction — unknown clients share a limit rather than each getting their own.
 */
export function clientIpFromHeaders(
  forwardedFor: string | null | undefined,
  realIp?: string | null,
  platformIp?: string | null
): string | null {
  // A configured platform header wins: it is one value the client cannot write,
  // rather than a position in a list whose length we have to guess.
  const trusted = platformIp?.trim();
  if (trustedClientIpHeader() && trusted) return trusted;

  const hops = trustedProxyHops();

  if (hops > 0) {
    const chain = (forwardedFor ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (chain.length >= hops) return chain[chain.length - hops];
  }

  const direct = realIp?.trim();
  if (direct) return direct;

  // Null, not the string "unknown".
  //
  // Sharing one bucket looked like the safe direction and is the opposite. If
  // nothing in front appends X-Forwarded-For — a misconfigured
  // TRUSTED_PROXY_HOPS, or a platform whose ingress does not set x-real-ip —
  // then EVERY request is unidentified, so they all key on the same bucket, and
  // `login:ip:unknown` at 10 per 15 minutes means ten attempts from one
  // attacker refuse sign-in to every user of the site. Forty requests an hour
  // for an indefinite authentication outage. Five closes registration.
  //
  // A caller that cannot identify the client must fall back to a per-account
  // limit rather than a global one. See SEC-3 and FLOW-2.
  return null;
}

/** `clientIpFromHeaders` for a standard `Request`. Null when unidentifiable. */
export function getClientIp(request: Request): string | null {
  const header = trustedClientIpHeader();
  return clientIpFromHeaders(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
    header ? request.headers.get(header) : null
  );
}

/** True when this deployment can identify a client at all. */
export function clientIdentificationConfigured(): boolean {
  return trustedClientIpHeader() !== null || trustedProxyHops() > 0;
}

/**
 * A rate-limit key for the client behind a request, or null if there is no
 * identifiable client.
 *
 * Prefer this to interpolating `getClientIp` yourself. TypeScript accepts
 * `` `login:ip:${ip}` `` with a `string | null` and produces the literal
 * "login:ip:null" — one shared bucket for the entire internet, which is the
 * outage this whole mechanism exists to avoid, reintroduced by writing the
 * obvious thing. Returning the key already built means there is no null to
 * interpolate.
 */
export function clientRateLimitKey(
  request: Request,
  prefix: string
): string | null {
  const ip = getClientIp(request);
  return ip ? `${prefix}:${ip}` : null;
}

/** Shared limits, kept here so they're visible in one place. */
export const LIMITS = {
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  upload: { limit: 20, windowMs: 60 * 60 * 1000 },
  // Contributing a location or a world. Generous for a person adding pins to
  // the books they have read; a bound on an account inserting rows in a loop
  // into the tables the public /map reads on every request.
  contribute: { limit: 60, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitOptions>;

/** Test-only escape hatch; not exported through any route. */
export function __resetRateLimits() {
  buckets.clear();
}
