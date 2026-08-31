/**
 * Resolve a `?page=` query parameter into a safe page number.
 *
 * `Math.max(1, Number(raw) || 1)` clamped the bottom and not the top, so
 * `?page=100000000` reached `searchWorks` as `OFFSET 2399999976` — a query the
 * planner has to walk to the offset, on an unauthenticated route, chosen by the
 * caller. The rendered pager capped its own links at 50, which hid the
 * reachability from anyone reading the UI but not from a typed URL.
 *
 * The ceiling is not arbitrary: match counts stop at `COUNT_CEILING`
 * (`src/server/catalog.ts`), so there is no page beyond that to show. Paging past
 * it could only ever return rows the count already refused to promise.
 */
export function resolvePage(
  raw: string | undefined,
  { pageSize, ceiling }: { pageSize: number; ceiling: number }
): number {
  const lastMeaningfulPage = Math.max(1, Math.ceil(ceiling / pageSize));
  const parsed = Number(raw);

  // Rejects NaN, Infinity, 1e9, negatives and fractions in one go.
  if (!Number.isInteger(parsed) || parsed < 1) return 1;

  return Math.min(parsed, lastMeaningfulPage);
}
