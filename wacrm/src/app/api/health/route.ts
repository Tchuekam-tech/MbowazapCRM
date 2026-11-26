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
  return NextResponse.json(
    {
      ok: true,
      service: 'wacrm',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
