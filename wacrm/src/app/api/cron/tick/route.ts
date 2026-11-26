import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { GET as runAutomationsCron } from '@/app/api/automations/cron/route';
import { GET as runFlowsCron } from '@/app/api/flows/cron/route';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { processDueDripEnrollments } from '@/lib/marketing/drip-engine';
import { syncStaleBufferIntegrations } from '@/lib/marketing/buffer-sync';

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
