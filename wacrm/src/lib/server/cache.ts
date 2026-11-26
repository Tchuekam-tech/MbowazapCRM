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

export class FastTtlCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private hits = 0;
  private misses = 0;
  private coalesced = 0;
  private staleHits = 0;

  constructor(maxEntries = 1000) {
    this.maxEntries = Math.max(16, maxEntries);
  }

  get<T>(key: string, now = Date.now()): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.freshUntil > now) {
      // LRU bump
      this.store.delete(key);
      this.store.set(key, entry);
      this.hits += 1;
      return entry.value as T;
    }
    if (entry.staleUntil <= now) {
      this.store.delete(key);
    }
    return undefined;
  }
