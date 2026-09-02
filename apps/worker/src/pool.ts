/**
 * Bounded in-process concurrency. Not a distributed lock — outbox claiming
 * already serialized ownership in PostgreSQL.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (concurrency < 1) {
    throw new RangeError('concurrency must be >= 1');
  }

  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const task = Promise.resolve()
      .then(() => worker(item))
      .finally(() => {
        executing.delete(task);
      });
    executing.add(task);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}
