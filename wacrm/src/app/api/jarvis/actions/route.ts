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
      const { data: rejected, error: rejErr } = await supabase
        .from('jarvis_actions')
        .update({
          status: 'rejected',
          decided_by: userId,
          decided_at: new Date().toISOString(),
        })
        .eq('id', actionId)
        .eq('account_id', accountId)
        .eq('status', 'pending_approval')
        .select('*')
        .maybeSingle();
      if (rejErr) {
        return NextResponse.json({ error: rejErr.message }, { status: 500 });
      }
      if (!rejected) {
        return NextResponse.json(
          { error: 'Action has already been decided or executed' },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true, action: rejected });
    }

    // Optional inline payload edit — allowlist safe text/numeric fields only so
    // callers cannot overwrite cross-tenant foreign IDs (sequenceId/pipelineId/stageId).
    const ALLOWED_EDIT_KEYS = new Set([
      'messageText',
      'dealTitle',
      'value',
      'currency',
      'text',
      'alertTitle',
      'alertBody',
      'tagName',
    ]);
    let mergedPayload = (existing as JarvisActionRecord).payload;
    if (body?.editedPayload && typeof body.editedPayload === 'object') {
      const safePatch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.editedPayload)) {
        if (ALLOWED_EDIT_KEYS.has(k)) safePatch[k] = v;
      }
      if (Object.keys(safePatch).length > 0) {
        mergedPayload = { ...mergedPayload, ...safePatch };
      }
    }

    // Atomically claim the pending action to prevent double-execution on double-click/replay.
    const { data: claimed, error: claimErr } = await supabase
      .from('jarvis_actions')
      .update({
        status: 'approved',
        payload: mergedPayload,
        decided_by: userId,
        decided_at: new Date().toISOString(),
      })
      .eq('id', actionId)
      .eq('account_id', accountId)
      .eq('status', 'pending_approval')
      .select('*')
      .maybeSingle();

    if (claimErr) {
      return NextResponse.json({ error: claimErr.message }, { status: 500 });
    }
    if (!claimed) {
      return NextResponse.json(
        { error: 'Action has already been approved, executed, or rejected' },
        { status: 409 }
      );
    }

    const executed = await executeJarvisAction(
      supabaseAdmin(),
      accountId,
      claimed as JarvisActionRecord,
      userId
    );
    return NextResponse.json({ success: true, action: executed });
  } catch (err) {
    return toErrorResponse(err);
  }
}
