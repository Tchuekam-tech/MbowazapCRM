import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { serverCache } from '@/lib/server/cache';
import { hasServiceRoleKey, supabaseAdmin } from '@/lib/flows/admin-client';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient } from '@/lib/mbowazap/client';

export const dynamic = 'force-dynamic';

function hasValidCronSecret(request: NextRequest): boolean {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Ultra-fast liveness endpoint (default: <5ms, zero external I/O so
 * Railway/Docker/Render healthchecks never flap on transient DB blips).
 *
 * Pass `?deep=1` with `x-cron-secret` for full dependency probes.
 */
export async function GET(request: NextRequest) {
  const mem = process.memoryUsage();
  const base = {
    ok: true,
    service: 'wacrm',
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: {
      rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
    },
    cache: serverCache.stats(),
    timestamp: new Date().toISOString(),
  };

  if (request.nextUrl.searchParams.get('deep') !== '1') {
    return NextResponse.json(base, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (!hasValidCronSecret(request)) {
    return NextResponse.json(
      { ...base, deep: 'unauthorized' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const checks: Record<string, unknown> = {};

  // Supabase probe
  const dbStart = performance.now();
  try {
    if (hasServiceRoleKey()) {
      const { error } = await supabaseAdmin()
        .from('accounts')
        .select('id', { count: 'exact', head: true });
      checks.supabase = {
        ok: !error,
        latencyMs: Math.round(performance.now() - dbStart),
        error: error?.message ?? null,
      };
    } else {
      checks.supabase = { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY unset' };
    }
  } catch (err) {
    checks.supabase = {
      ok: false,
      latencyMs: Math.round(performance.now() - dbStart),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Bot gateway probe
  const env = readMbowazapEnv();
  if (env.ok) {
    const botStart = performance.now();
    try {
      const client = createMbowazapClient(env.env);
      const ping = await client.ping();
      checks.botBridge = {
        ok: true,
        protocol: ping.protocol,
        latencyMs: Math.round(performance.now() - botStart),
      };
    } catch (err) {
      checks.botBridge = {
        ok: false,
        latencyMs: Math.round(performance.now() - botStart),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    checks.botBridge = { ok: false, configured: false };
  }

  return NextResponse.json(
    { ...base, checks },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
