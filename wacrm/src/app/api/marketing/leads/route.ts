import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  aiDeepAnalyzeContact,
  recomputeAccountLeadScores,
} from '@/lib/marketing/lead-scoring';

export const dynamic = 'force-dynamic';

/**
 * GET /api/marketing/leads
 * - Optional `?contactId=<uuid>` returns a single contact's score (computing on demand if absent)
 * - Optional `?tier=hot|warm|cold` filters the account leaderboard
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const contactId = request.nextUrl.searchParams.get('contactId');
    const tier = request.nextUrl.searchParams.get('tier');

    if (contactId) {
      const { data: existing } = await ctx.supabase
        .from('contact_lead_scores')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .maybeSingle();
