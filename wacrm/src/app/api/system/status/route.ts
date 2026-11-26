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

        // 2. Measure Bot Gateway reachability + runtime metrics
        const env = readMbowazapEnv();
        let bot: {
          configured: boolean;
          reachable: boolean;
          latencyMs: number | null;
          metrics: BotRuntimeMetrics | null;
          error: string | null;
        } = {
          configured: env.ok,
          reachable: false,
          latencyMs: null,
          metrics: null,
          error: env.ok ? null : env.problems.join('; '),
        };

        if (env.ok) {
          const client = createMbowazapClient(env.env);
          const botStart = performance.now();
          try {
            const metrics = await client.metrics();
            bot = {
              configured: true,
              reachable: true,
              latencyMs: Math.round(performance.now() - botStart),
              metrics,
              error: null,
            };
          } catch (err) {
            // Fallback to /bridge/ping if running against an older bot build
            try {
              await client.ping();
              bot = {
                configured: true,
                reachable: true,
                latencyMs: Math.round(performance.now() - botStart),
                metrics: null,
                error: null,
              };
            } catch (pingErr) {
              bot = {
                configured: true,
                reachable: false,
                latencyMs: Math.round(performance.now() - botStart),
                metrics: null,
                error:
                  pingErr instanceof Error
                    ? pingErr.message
                    : err instanceof Error
                      ? err.message
                      : 'Bot unreachable',
              };
            }
          }
        }

        const overallHealth =
          !dbErr && (!env.ok || bot.reachable)
            ? 'optimal'
            : !dbErr
              ? 'degraded'
              : 'incident';

        return {
          status: overallHealth,
          checkedAt: new Date().toISOString(),
          crm: {
            uptimeSeconds: Math.round(process.uptime()),
            memoryMb: {
              rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
              heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
              heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
            },
            cache: serverCache.stats(),
          },
          database: {
            ok: !dbErr,
            latencyMs: dbLatencyMs,
            error: dbErr?.message ?? null,
          },
          bot,
        };
      },
      { staleWhileRevalidateMs: 10_000 }
    );

    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
