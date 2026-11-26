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

