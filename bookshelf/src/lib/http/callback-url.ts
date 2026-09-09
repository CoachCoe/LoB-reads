/**
 * Where to send a reader after signing in, validated against open redirects.
 *
 * Shared, because `/register` did not honour `?callbackUrl=` at all — it
 * pushed `/` on success — so linking to it with one would have been a dangling
 * promise. Now both forms use this.
 *
 * JR-19: the previous check rejected any URL containing a colon. That blocks
 * `javascript:` and absolute URLs, which is the point, but it also blocks a
 * perfectly ordinary `/search?q=dune:messiah` — which then silently became `/`
 * with no indication. Nothing generates such a URL today, so this was latent
 * rather than broken.
 *
 * Parsing against a fixed base is what separates the two cases properly: a
 * relative path resolves to that origin, and anything absolute or
 * protocol-relative resolves elsewhere and is rejected. The base is a constant
 * rather than `location.origin` so the rule is identical on the server and in
 * a test, and does not depend on where the page happens to be served from.
 */
const BASE = "http://callback.invalid";

export function getSafeCallbackUrl(url: string | null | undefined): string {
  if (!url) return "/";

  // A path must be given as a path. Rejecting these before parsing keeps
  // `//evil.example` and `/\evil.example` out, both of which some parsers
  // treat as protocol-relative.
  if (!url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) {
    return "/";
  }

  try {
    const parsed = new URL(url, BASE);
    if (parsed.origin !== BASE) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
