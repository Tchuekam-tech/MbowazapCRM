// ============================================================
// Bounded async concurrency + resilient jittered retry helpers.
// ============================================================

/**
 * Run an async worker over `items` with at most `concurrency` tasks
 * in flight simultaneously, preserving input ordering in the result.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;
