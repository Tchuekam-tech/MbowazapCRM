import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { runAiDigitalPresenceAudit } from '@/lib/marketing/presence-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`buffer-audit:${ctx.userId}`, RATE_LIMITS.aiDraft);
    if (!limit.success) return rateLimitResponse(limit);

    const audit = await runAiDigitalPresenceAudit(ctx.supabase, ctx.accountId);
    return NextResponse.json({ ok: true, audit });
  } catch (err) {
    return toErrorResponse(err);
  }
}
