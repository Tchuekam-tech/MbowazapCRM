import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { BufferApiError } from '@/lib/marketing/buffer-client';
import { syncBufferForAccount } from '@/lib/marketing/buffer-sync';
import { loadDigitalPresenceReport } from '@/lib/marketing/presence-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`buffer-sync:${ctx.accountId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const sync = await syncBufferForAccount(ctx.supabase, ctx.accountId);
    const report = await loadDigitalPresenceReport(ctx.supabase, ctx.accountId);
    return NextResponse.json({ ok: true, sync, report });
  } catch (err) {
    if (err instanceof BufferApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 'rate_limited' ? 429 : 502 }
      );
    }
    return toErrorResponse(err);
  }
}
