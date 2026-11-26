import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { evaluateAccountSegment } from '@/lib/marketing/lead-scoring';
import { nextAllowedSendTime } from '@/lib/marketing/drip-engine';
import type { DripSequenceStep, SegmentRules } from '@/types/marketing';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data: sequences, error } = await ctx.supabase
      .from('drip_sequences')
      .select('*, steps:drip_sequence_steps(*)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const normalized = (sequences ?? []).map((seq: Record<string, unknown>) => ({
      ...seq,
      steps: Array.isArray(seq.steps)
        ? [...seq.steps].sort(
            (a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0)
          )
        : [],
    }));

    return NextResponse.json({ sequences: normalized });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();

    // Enroll contacts or segment into an existing drip sequence
    if (body.action === 'enroll') {
      const sequenceId = typeof body.sequence_id === 'string' ? body.sequence_id : '';
      if (!sequenceId) {
        return NextResponse.json({ error: 'sequence_id is required' }, { status: 400 });
      }

      const { data: seq } = await ctx.supabase
        .from('drip_sequences')
        .select('*, steps:drip_sequence_steps(*)')
        .eq('id', sequenceId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (!seq) {
        return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
      }

      let contactIds: string[] = Array.isArray(body.contact_ids)
        ? body.contact_ids.filter((id: unknown): id is string => typeof id === 'string')
        : [];

      const segmentId =
        typeof body.segment_id === 'string' ? body.segment_id : (seq.segment_id as string | null);

      if (contactIds.length === 0 && segmentId) {
        const { data: seg } = await ctx.supabase
          .from('marketing_segments')
          .select('rules')
          .eq('id', segmentId)
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (seg) {
          const evalRes = await evaluateAccountSegment(
            ctx.supabase,
            ctx.accountId,
            (seg.rules as SegmentRules) || {}
          );
          contactIds = evalRes.contactIds;
        }
      }

      if (contactIds.length === 0) {
        return NextResponse.json(
          { error: 'No matching contacts found to enroll' },
          { status: 400 }
        );
      }

      const sortedSteps = Array.isArray(seq.steps)
        ? [...seq.steps].sort((a, b) => a.step_order - b.step_order)
        : [];
      const firstStep = sortedSteps[0];
      const delayMin = Number(firstStep?.delay_minutes ?? 0);
      const rawFirst = new Date(Date.now() + delayMin * 60_000);
      const nextSend = nextAllowedSendTime(
        rawFirst,
        seq.quiet_hours_start || '21:00',
        seq.quiet_hours_end || '08:00',
        seq.timezone || 'UTC'
      );

      const rows = contactIds.slice(0, 500).map((cid) => ({
        sequence_id: sequenceId,
        account_id: ctx.accountId,
        contact_id: cid,
        current_step_order: firstStep?.step_order ?? 1,
        status: 'active',
        next_send_at: nextSend.toISOString(),
      }));

      const { data: inserted, error: enrErr } = await ctx.supabase
        .from('drip_enrollments')
        .upsert(rows, { onConflict: 'sequence_id,contact_id', ignoreDuplicates: true })
        .select('id');

      if (enrErr) return NextResponse.json({ error: enrErr.message }, { status: 500 });

      const addedCount = inserted?.length ?? 0;
      await ctx.supabase
        .from('drip_sequences')
        .update({
          status: seq.status === 'draft' ? 'active' : seq.status,
          enrolled_count: Number(seq.enrolled_count ?? 0) + addedCount,
        })
        .eq('id', sequenceId);

      return NextResponse.json({
        enrolled: addedCount,
        skippedDuplicates: rows.length - addedCount,
        firstSendAt: nextSend.toISOString(),
      });
    }

    // Create a new multi-step drip sequence
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const rawSteps = Array.isArray(body.steps) ? (body.steps as DripSequenceStep[]) : [];
    if (!name) {
      return NextResponse.json({ error: 'Sequence name is required' }, { status: 400 });
    }
    if (rawSteps.length === 0) {
      return NextResponse.json(
        { error: 'At least one drip step is required' },
        { status: 400 }
      );
    }
