import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { hasServiceRoleKey, supabaseAdmin } from '@/lib/flows/admin-client';
import { processDueDripEnrollments } from '@/lib/marketing/drip-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  const result = await processDueDripEnrollments(supabaseAdmin(), 15);
  return NextResponse.json({ ok: true, ...result });
}
