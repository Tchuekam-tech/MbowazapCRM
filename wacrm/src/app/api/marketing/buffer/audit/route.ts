import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { runAiDigitalPresenceAudit } from '@/lib/marketing/presence-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`buffer-audit:${ctx.userId}`, RATE_LIMITS.aiDraft);
    if (!limit.success) return rateLimitResponse(limit);

    // Use admin client after requireRole('agent') so writing ai_audit_summary
    // on buffer_integrations (admin-gated RLS) succeeds for agents too.
    const audit = await runAiDigitalPresenceAudit(supabaseAdmin(), ctx.accountId);
    return NextResponse.json({ ok: true, audit });
  } catch (err) {
    return toErrorResponse(err);
  }
}
