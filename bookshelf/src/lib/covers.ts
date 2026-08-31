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
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;
}
