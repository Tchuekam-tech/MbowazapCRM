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

  set<T>(
    key: string,
    value: T,
    ttlMs: number,
    staleWhileRevalidateMs = 0,
    now = Date.now()
  ): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      freshUntil: now + ttlMs,
      staleUntil: now + ttlMs + Math.max(0, staleWhileRevalidateMs),
    });
  }

  /**
   * Fetch with TTL caching, singleflight deduplication, and optional
   * stale-while-revalidate background refresh.
   */
  async getOrLoad<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    opts: { staleWhileRevalidateMs?: number; now?: () => number } = {}
  ): Promise<T> {
    const nowFn = opts.now ?? Date.now;
    const now = nowFn();
    const swrMs = opts.staleWhileRevalidateMs ?? 0;

    const existing = this.store.get(key);
    if (existing && existing.freshUntil > now) {
      this.store.delete(key);
      this.store.set(key, existing);
      this.hits += 1;
      return existing.value as T;
    }

    // Serve stale value instantly while refreshing in the background.
    if (existing && existing.staleUntil > now) {
      this.staleHits += 1;
      if (!this.inflight.has(key)) {
        const refresh = loader()
          .then((val) => {
            this.set(key, val, ttlMs, swrMs, nowFn());
            return val;
          })
          .catch(() => existing.value)
          .finally(() => {
            this.inflight.delete(key);
          });
        this.inflight.set(key, refresh);
      }
      return existing.value as T;
    }

    // Singleflight: piggyback on an already running load for the same key.
    const pending = this.inflight.get(key);
    if (pending) {
      this.coalesced += 1;
      return pending as Promise<T>;
    }

    this.misses += 1;
    const promise = loader()
      .then((val) => {
        this.set(key, val, ttlMs, swrMs, nowFn());
        return val;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
    this.hits = 0;
    this.misses = 0;
    this.coalesced = 0;
    this.staleHits = 0;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses + this.staleHits;
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      coalesced: this.coalesced,
      staleHits: this.staleHits,
      hitRate: total > 0 ? Math.round(((this.hits + this.staleHits) / total) * 1000) / 10 : 0,
    };
  }
}

/** Shared server-process cache for hot tenant & gateway reads. */
export const serverCache = new FastTtlCache(2000);
