/**
 * Cover image URL.
 *
 * Prefers a copy stored in our own object storage, falling back to hotlinking
 * Open Library for anything the cover worker has not reached yet. Pass
 * `storedUrl` wherever it is available; the fallback exists so a fresh catalog
 * still shows covers before the first backfill has run.
 *
 * The `id` form rather than `isbn`: we already hold cover_id, and the isbn form
 * is more aggressively rate limited.
 *
 * This lives in `src/lib` rather than `src/server` because it is a pure string
 * builder that client components need. It used to sit in `src/server/catalog.ts`,
 * whose module scope constructs a PrismaClient — so `ShelfSection`, a client
 * component, pulled Prisma into the browser bundle, where `Prisma.sql` throws on
 * evaluation and took the whole of /my-books' hydration with it. Nothing in the
 * build or the test suite noticed. See conventions.test.ts, which now forbids
 * the shape rather than trusting anyone to remember it.
 */
export function coverUrl(
  coverId: number | null | undefined,
  size: "S" | "M" | "L" = "M",
  storedUrl?: string | null
): string | null {
  if (storedUrl) return storedUrl;
  if (!coverId) return null;

  // `default=false` matters. Without it, a cover id Open Library has no image
  // for is answered with 200 and a 43-byte blank placeholder — so the browser
  // reports success and every fallback in the app is unreachable. With it the
  // same request 404s, which is a state a component can actually respond to.
  // (scripts/enrich/covers.ts already guards the same behaviour server-side
  // with MIN_IMAGE_BYTES.) Verified: a real cover returns 200 either way.
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg?default=false`;
}
