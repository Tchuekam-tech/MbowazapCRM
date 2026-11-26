import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { evaluateAccountSegment } from '@/lib/marketing/lead-scoring';
import {
  evaluateAbWinner,
  lintWhatsAppCopy,
  renderPersonalizedCopy,
} from '@/lib/marketing/copywriter';
import { loadTransport } from '@/lib/whatsapp/transport';
import { findOrCreateConversation } from '@/lib/whatsapp/inbound/conversations';
import { mapWithConcurrency } from '@/lib/server/concurrency';
import type { AbCampaignVariant, SegmentRules } from '@/types/marketing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('ab_campaigns')
      .select('*, variants:ab_campaign_variants(*)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const campaigns = (data ?? []).map((c: Record<string, unknown>) => {
      const variants = Array.isArray(c.variants)
        ? [...(c.variants as AbCampaignVariant[])].sort((a, b) =>
            a.variant_key.localeCompare(b.variant_key)
          )
        : [];
      const vA = variants.find((v) => v.variant_key === 'A');
      const vB = variants.find((v) => v.variant_key === 'B');
      const verdict =
        vA && vB
          ? evaluateAbWinner(
              vA,
              vB,
              (c.winner_metric as 'reply_rate' | 'read_rate' | 'conversion_rate') || 'reply_rate'
            )
          : null;
      return { ...c, variants, verdict };
    });
