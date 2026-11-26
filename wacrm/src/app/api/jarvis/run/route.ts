import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { runJarvisCycle } from '@/lib/jarvis/autonomous-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const { accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(`jarvis-run:${accountId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { run, actions } = await runJarvisCycle(supabaseAdmin(), accountId, {
      trigger: 'manual',
      actorUserId: userId,
    });

    return NextResponse.json({ success: true, run, actions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
