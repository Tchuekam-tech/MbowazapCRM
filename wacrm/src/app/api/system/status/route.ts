import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { serverCache } from '@/lib/server/cache';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient, type BotRuntimeMetrics } from '@/lib/mbowazap/client';

export const dynamic = 'force-dynamic';

/**
 * Authenticated live server health & speed monitor for both the
 * Next.js CRM server and the TchuekBot Baileys gateway.
 * Cached for 5s via singleflight to keep repeated dashboard refreshes instant.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const snapshot = await serverCache.getOrLoad(
      `system:status:${ctx.accountId}`,
      5_000,
      async () => {
        const mem = process.memoryUsage();

        // 1. Measure Supabase RLS read latency
        const dbStart = performance.now();
        const { error: dbErr } = await ctx.supabase
          .from('accounts')
          .select('id')
          .eq('id', ctx.accountId)
          .maybeSingle();
        const dbLatencyMs = Math.round(performance.now() - dbStart);
