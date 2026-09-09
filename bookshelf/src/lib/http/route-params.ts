/**
 * Reading a dynamic route segment that may or may not already be decoded.
 *
 * `/author/[authorName]` carries a display name, so the segment is
 * percent-encoded by every link that builds it (`encodeURIComponent`). The
 * question is who decodes it, and in Next 16 the answer is not the same for
 * every surface: measured against the running app, a **route handler** receives
 * `params` already decoded while a **page component** receives them still
 * encoded, and `generateMetadata` behaves like the route handler.
 *
 * Calling `decodeURIComponent` on an already-decoded value is not harmless when
 * the value contains a literal `%`: it throws `URIError: URI malformed`. Fifteen
 * authors in the catalog have `%` in their name and eight of those have works,
 * so they are linked from work pages — and the result was
 * `GET /api/authors/<name>/locations` answering **500** for all eight, and the
 * author page rendering with no `<title>`. The locations panel is one of the
 * product's two stated differentiators, so those authors could neither show a
 * location nor receive one, and the 500 was reachable anonymously.
 *
 * Rather than encode the asymmetry — which is a property of the framework and
 * can change under us, and which AGENTS.md's vendor block warns about in as many
 * words — this decodes only when decoding can succeed. A value that is already
 * decoded is returned unchanged.
 *
 * The one input this treats differently from a plain decode is a name that is
 * itself valid percent-encoding, e.g. an author literally called "100%20Jesus":
 * arriving decoded, it would be decoded again to "100 Jesus". No such author
 * exists in the catalog, and answering with the wrong author is a far smaller
 * fault than a 500 for eight real ones.
 */
export function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Not valid percent-encoding, so it is already a plain value.
    return value;
  }
}
