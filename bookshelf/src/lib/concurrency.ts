/**
 * Run an async mapper over items with at most `limit` in flight.
 *
 * Used by the Goodreads import, which previously awaited one Open Library
 * request per book inside a serial loop — a 500-book export meant 500
 * sequential round trips in a single request handler.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index], index);
      }
    }
  );

  await Promise.all(workers);
  return results;
}
