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
