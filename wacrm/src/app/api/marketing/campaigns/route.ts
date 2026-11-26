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

    return NextResponse.json({ campaigns });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();

    // Launch or Promote-Winner action on an existing campaign
    if (body.action === 'launch' || body.action === 'promote_winner') {
      const campaignId = typeof body.campaign_id === 'string' ? body.campaign_id : '';
      if (!campaignId) {
        return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 });
      }

      const { data: campaign } = await ctx.supabase
        .from('ab_campaigns')
        .select('*, variants:ab_campaign_variants(*)')
        .eq('id', campaignId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (!campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
      }

      const variants = (campaign.variants ?? []) as AbCampaignVariant[];
      const variantA = variants.find((v) => v.variant_key === 'A');
      const variantB = variants.find((v) => v.variant_key === 'B');
      if (!variantA || !variantB) {
        return NextResponse.json({ error: 'Campaign requires both Variant A and B' }, { status: 400 });
      }

      const transport = await loadTransport(ctx.supabase, ctx.accountId);
      const concurrency = transport.provider === 'meta' ? 5 : 1;

      // Helper to deliver a single contact with a chosen variant
      const deliverOne = async (
        contact: { id: string; phone: string; wa_lid?: string | null; name?: string | null; company?: string | null; email?: string | null },
        variant: AbCampaignVariant,
        recipientRowId: string,
        couponCode: string | null
      ): Promise<boolean> => {
        try {
          const target = transport.resolveTarget(contact);
          if (!target) throw new Error('No valid WhatsApp recipient');

          const opened = await findOrCreateConversation(
            ctx.supabase,
            ctx.accountId,
            ctx.userId,
            contact.id
          );
          if (!opened) throw new Error('Could not open conversation');
