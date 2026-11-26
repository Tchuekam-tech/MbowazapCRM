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
