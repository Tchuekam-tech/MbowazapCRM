import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { executeJarvisAction } from '@/lib/jarvis/autonomous-engine';
import type { JarvisActionRecord } from '@/types/jarvis';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('jarvis_actions')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ actions: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(`jarvis-act:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      actionId?: string;
      decision?: 'approve' | 'reject';
      editedPayload?: Record<string, unknown>;
    } | null;

    const actionId = typeof body?.actionId === 'string' ? body.actionId : '';
    const decision = body?.decision;
    if (!actionId || (decision !== 'approve' && decision !== 'reject')) {
      return NextResponse.json(
        { error: 'actionId and decision ("approve" | "reject") are required' },
        { status: 400 }
      );
    }

    const { data: existing, error } = await supabase
      .from('jarvis_actions')
      .select('*')
      .eq('id', actionId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error || !existing) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    if (decision === 'reject') {
      const { data: rejected } = await supabase
        .from('jarvis_actions')
        .update({
          status: 'rejected',
          decided_by: userId,
          decided_at: new Date().toISOString(),
        })
        .eq('id', actionId)
        .eq('account_id', accountId)
        .select('*')
        .single();
      return NextResponse.json({ success: true, action: rejected });
    }

    // Optional inline payload edit (e.g. tweaking WhatsApp follow-up text before approving)
    let actionRow = existing as JarvisActionRecord;
    if (body?.editedPayload && typeof body.editedPayload === 'object') {
      const mergedPayload = { ...actionRow.payload, ...body.editedPayload };
      const { data: updated } = await supabase
        .from('jarvis_actions')
        .update({ payload: mergedPayload })
        .eq('id', actionId)
        .eq('account_id', accountId)
        .select('*')
        .single();
      if (updated) actionRow = updated as JarvisActionRecord;
    }

    const executed = await executeJarvisAction(
      supabaseAdmin(),
      accountId,
      actionRow,
      userId
    );
    return NextResponse.json({ success: true, action: executed });
  } catch (err) {
    return toErrorResponse(err);
  }
}
