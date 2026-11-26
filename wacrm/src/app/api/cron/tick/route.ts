import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { GET as runAutomationsCron } from '@/app/api/automations/cron/route';
import { GET as runFlowsCron } from '@/app/api/flows/cron/route';
import { hasServiceRoleKey, supabaseAdmin } from '@/lib/flows/admin-client';
import { processDueDripEnrollments } from '@/lib/marketing/drip-engine';
import { syncStaleBufferIntegrations } from '@/lib/marketing/buffer-sync';
import { processScheduledJarvisCycles } from '@/lib/jarvis/autonomous-engine';
import { syncStaleWebsiteSources } from '@/lib/jarvis/knowledge-ingestor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Unified always-on cron tick endpoint.
 * Runs delayed automations, stale flow sweeps, and due marketing drip
 * sequences in parallel with full fault isolation so one subsystem error
 * never blocks the others.
 *
 * Protected by `x-cron-secret === AUTOMATION_CRON_SECRET`.
 * Automatically pinged every 60s by TchuekBot's built-in runtime monitor
 * when `AUTOMATION_CRON_SECRET` is configured on both services.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasServiceRoleKey()) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' },
      { status: 503 }
    );
  }

  const startedAt = performance.now();

  const adminDb = supabaseAdmin();
  const [automations, flows, drips, bufferSync, jarvisCycles, websiteKbSync] = await Promise.all([
    runAutomationsCron(request)
      .then((r) => r.json())
      .catch((err) => ({ error: err instanceof Error ? err.message : String(err) })),
    runFlowsCron(request)
      .then((r) => r.json())
      .catch((err) => ({ error: err instanceof Error ? err.message : String(err) })),
    processDueDripEnrollments(adminDb, 15).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    })),
    syncStaleBufferIntegrations(adminDb, 10).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    })),
    processScheduledJarvisCycles(adminDb, 8).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    })),
    syncStaleWebsiteSources(adminDb, 6).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    })),
  ]);

  return NextResponse.json({
    ok: true,
    durationMs: Math.round(performance.now() - startedAt),
    automations,
    flows,
    drips,
    bufferSync,
    jarvisCycles,
    websiteKbSync,
  });
}
