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

describe('mapWithConcurrency & withRetry', () => {
  it('caps in-flight concurrency and preserves result order', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return n * 10;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('retries transient failures up to maxAttempts', async () => {
    let attempts = 0;
    const res = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('transient');
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 10 }
    );
    expect(res).toBe('ok');
    expect(attempts).toBe(3);
  });
});

describe('MboWazap bridge circuit breaker & metrics', () => {
  it('opens circuit after consecutive transport failures and short-circuits subsequent sends', async () => {
    let nowMs = 1_700_000_000_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('connect ECONNREFUSED');
    });
    const client = createMbowazapClient({
      botUrl: 'https://bot.example.com',
      secret: 'mbowazap-test-secret-0123456789abcdef',
      fetchImpl,
      now: () => nowMs,
      circuitBreaker: { failureThreshold: 2, cooldownMs: 10_000 },
    });
