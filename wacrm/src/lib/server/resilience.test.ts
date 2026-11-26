import { describe, it, expect, vi } from 'vitest';
import { FastTtlCache } from './cache';
import { mapWithConcurrency, withRetry } from './concurrency';
import { createMbowazapClient } from '@/lib/mbowazap/client';

describe('FastTtlCache', () => {
  it('caches fresh entries, coalesces concurrent loads (singleflight), and evicts LRU', async () => {
    const cache = new FastTtlCache(16);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return { ok: true, n: calls };
    };

    const [a, b, c] = await Promise.all([
      cache.getOrLoad('k1', 5000, loader),
      cache.getOrLoad('k1', 5000, loader),
      cache.getOrLoad('k1', 5000, loader),
    ]);

    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(cache.stats().coalesced).toBe(2);

    // Prefix invalidation clears matching keys
    cache.set('acct:1:a', 1, 5000);
    cache.set('acct:1:b', 2, 5000);
    cache.set('acct:2:a', 3, 5000);
    expect(cache.invalidatePrefix('acct:1:')).toBe(2);
    expect(cache.get('acct:1:a')).toBeUndefined();
    expect(cache.get('acct:2:a')).toBe(3);
  });

  it('serves stale data immediately during SWR window while refreshing asynchronously', async () => {
    const cache = new FastTtlCache(16);
    let t = 1000;
    cache.set('swr-key', 'v1', 100, 500, t);

    t = 1200; // past freshUntil (1100), inside staleUntil (1600)
    const val = await cache.getOrLoad('swr-key', 100, async () => 'v2', {
      staleWhileRevalidateMs: 500,
      now: () => t,
    });
    expect(val).toBe('v1');
    expect(cache.stats().staleHits).toBe(1);

    // Wait microtask for background refresh to store v2
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get('swr-key', t)).toBe('v2');
  });
});

