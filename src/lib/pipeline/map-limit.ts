/**
 * Runs `fn` over `items` with at most `limit` calls in flight, keeping input order in the result.
 * Every started call is allowed to finish; the first failure is then thrown.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  const completed = await Promise.allSettled(workers);
  for (const result of completed) if (result.status === "rejected") throw result.reason;
  return results;
}
