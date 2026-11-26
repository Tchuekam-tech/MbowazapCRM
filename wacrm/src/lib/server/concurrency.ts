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

  async function runWorker(): Promise<void> {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]!, idx);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

/**
 * Retry a transient async operation with capped exponential backoff and jitter.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const baseDelayMs = Math.max(10, opts.baseDelayMs ?? 150);
  const maxDelayMs = Math.max(baseDelayMs, opts.maxDelayMs ?? 2500);
  const shouldRetry = opts.shouldRetry ?? (() => true);
