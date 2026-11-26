// ============================================================
// Bounded in-memory TTL + LRU cache with Singleflight request
// deduplication and Stale-While-Revalidate (SWR) support.
//
// Designed for high-throughput Next.js API routes:
//   - Prevents thundering herds when multiple tabs or webhooks
//     request the same tenant metadata or bot status at once.
//   - Bounded maxEntries prevents unbounded heap growth on long-
//     lived Node containers (Railway / Render / VPS).
//   - Zero background timers (works identically on serverless
//     and container runtimes).
// ============================================================

export interface CacheStats {
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
  coalesced: number;
  staleHits: number;
  hitRate: number;
}

interface CacheEntry<T> {
  value: T;
  freshUntil: number;
  staleUntil: number;
}
