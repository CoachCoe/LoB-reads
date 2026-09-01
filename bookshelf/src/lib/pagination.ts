/**
 * Resolve a `?page=` query parameter into a safe page number.
 *
 * `Math.max(1, Number(raw) || 1)` clamped the bottom and not the top, so
 * `?page=100000000` reached `searchWorks` as `OFFSET 2399999976` — a query the
 * planner has to walk to the offset, on an unauthenticated route, chosen by the
 * caller. The rendered pager capped its own links at 50, which hid the
 * reachability from anyone reading the UI but not from a typed URL.
 *
 * `lastPage` must be the caller's OWN bound, not a shared constant. The two
 * modes answer different questions: a search count stops at `COUNT_CEILING`, so
 * there is genuinely no page past it, while a subject browse reads an exact
 * count out of `catalog.subject_counts` and can legitimately run to tens of
 * thousands of pages over an indexed containment lookup. Clamping the browse to
 * the search's ceiling made 30,000 pages of it unreachable and left the pager
 * rendering links that silently resolved to page 42.
 */
export function resolvePage(
  raw: string | undefined,
  { lastPage }: { lastPage: number }
): number {
  const parsed = Number(raw);

  // Rejects NaN, Infinity, 1e9, negatives and fractions in one go.
  if (!Number.isInteger(parsed) || parsed < 1) return 1;

  return Math.min(parsed, Math.max(1, lastPage));
}

/** The last page worth offering for a bounded count. */
export function lastPageFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
