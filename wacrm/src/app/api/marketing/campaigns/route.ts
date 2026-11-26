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

          const text = renderPersonalizedCopy(variant.body_text, contact, couponCode);
          const sent =
            variant.template_name && transport.provider === 'meta'
              ? await transport.sendTemplate({
                  to: target.target,
                  templateName: variant.template_name,
                  language: variant.template_language || 'en_US',
                  contentText: text,
                  params: [],
                  origin: 'automation',
                  conversationId: opened.conversation.id,
                })
              : await transport.sendText({
                  to: target.target,
                  text,
                  origin: 'automation',
                  conversationId: opened.conversation.id,
                });

          const nowIso = new Date().toISOString();
          await Promise.all([
            ctx.supabase.from('messages').insert({
              conversation_id: opened.conversation.id,
              sender_type: 'bot',
              content_type: 'text',
              content_text: text,
              message_id: sent.messageId,
              status: 'sent',
            }),
            ctx.supabase
              .from('ab_campaign_recipients')
              .update({
                variant_id: variant.id,
                variant_key: variant.variant_key,
                status: 'sent',
                whatsapp_message_id: sent.messageId,
                sent_at: nowIso,
                error_message: null,
              })
              .eq('id', recipientRowId),
          ]);
          return true;
        } catch (err) {
          await ctx.supabase
            .from('ab_campaign_recipients')
            .update({
              status: 'failed',
              error_message: (err instanceof Error ? err.message : String(err)).slice(0, 400),
            })
            .eq('id', recipientRowId);
          return false;
        }
      };

      if (body.action === 'promote_winner') {
        const requestedWinner = body.winner === 'A' || body.winner === 'B' ? body.winner : null;
        const autoVerdict = evaluateAbWinner(variantA, variantB, campaign.winner_metric);
        const winnerKey = requestedWinner ?? autoVerdict.winner ?? 'A';
        const winnerVariant = winnerKey === 'A' ? variantA : variantB;

        const { data: holdoutRows } = await ctx.supabase
          .from('ab_campaign_recipients')
          .select('id, contact_id, contact:contacts(id, phone, wa_lid, name, company, email)')
          .eq('campaign_id', campaignId)
          .eq('variant_key', 'holdout')
          .eq('status', 'pending');

        let couponCode: string | null = null;
        if (winnerVariant.coupon_id) {
          const { data: cp } = await ctx.supabase
            .from('promo_coupons')
            .select('code')
            .eq('id', winnerVariant.coupon_id)
            .maybeSingle();
          couponCode = cp?.code ?? null;
        }

        const holdouts = (holdoutRows ?? []) as unknown as Array<{
          id: string;
          contact:
            | { id: string; phone: string; wa_lid?: string | null; name?: string | null; company?: string | null; email?: string | null }
            | Array<{ id: string; phone: string; wa_lid?: string | null; name?: string | null; company?: string | null; email?: string | null }>;
        }>;

        let sentHoldout = 0;
        const outcomes = await mapWithConcurrency(holdouts, concurrency, async (row) => {
          const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
          if (!contact) return false;
          return deliverOne(contact, winnerVariant, row.id, couponCode);
        });
        sentHoldout = outcomes.filter(Boolean).length;

        await Promise.all([
          ctx.supabase
            .from('ab_campaign_variants')
            .update({ sent_count: winnerVariant.sent_count + sentHoldout })
            .eq('id', winnerVariant.id),
          ctx.supabase
            .from('ab_campaigns')
            .update({
              winner_variant: winnerKey,
              status: 'completed',
              completed_at: new Date().toISOString(),
            })
            .eq('id', campaignId),
        ]);

        return NextResponse.json({
          ok: true,
          winner: winnerKey,
          sentHoldout,
        });
      }

      // Launch A/B test pass
      let contactIds: string[] = [];
      if (campaign.segment_id) {
        const { data: seg } = await ctx.supabase
          .from('marketing_segments')
          .select('rules')
          .eq('id', campaign.segment_id)
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
      } else {
        const { data: allContacts } = await ctx.supabase
          .from('contacts')
          .select('id')
          .eq('account_id', ctx.accountId)
          .limit(200);
        contactIds = (allContacts ?? []).map((c) => c.id as string);
      }

      if (contactIds.length === 0) {
        return NextResponse.json(
          { error: 'No contacts match the target audience' },
          { status: 400 }
        );
      }

      // Deterministic Fisher-Yates shuffle for unbiased A/B split
      const shuffled = [...contactIds.slice(0, 200)];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }

      const holdoutPct = Number(campaign.holdout_percent ?? 0);
      const splitRatio = Number(campaign.split_ratio ?? 50);
      const testCount = Math.max(
        Math.min(2, shuffled.length),
        Math.round((shuffled.length * (100 - holdoutPct)) / 100)
      );
      const countA = Math.max(1, Math.round((testCount * splitRatio) / 100));

      const planRows = shuffled.map((cid, idx) => {
        if (idx < countA) {
          return {
            campaign_id: campaignId,
            variant_id: variantA.id,
            account_id: ctx.accountId,
            contact_id: cid,
            variant_key: 'A' as const,
            status: 'pending' as const,
          };
        }
        if (idx < testCount) {
          return {
            campaign_id: campaignId,
            variant_id: variantB.id,
            account_id: ctx.accountId,
            contact_id: cid,
            variant_key: 'B' as const,
            status: 'pending' as const,
          };
        }
        return {
          campaign_id: campaignId,
          variant_id: null,
          account_id: ctx.accountId,
          contact_id: cid,
          variant_key: 'holdout' as const,
          status: 'pending' as const,
        };
      });

      const { data: insertedRecips, error: recErr } = await ctx.supabase
        .from('ab_campaign_recipients')
        .upsert(planRows, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true })
        .select('id, contact_id, variant_key');

      if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 });

      const testRecipients = (insertedRecips ?? []).filter(
        (r) => r.variant_key === 'A' || r.variant_key === 'B'
      );

      const { data: contactRows } = await ctx.supabase
        .from('contacts')
        .select('id, phone, wa_lid, name, company, email')
        .in(
          'id',
          testRecipients.map((r) => r.contact_id)
        );
      const contactById = new Map(
        (contactRows ?? []).map((c) => [c.id as string, c])
      );

      const [cpA, cpB] = await Promise.all([
        variantA.coupon_id
          ? ctx.supabase.from('promo_coupons').select('code').eq('id', variantA.coupon_id).maybeSingle()
          : Promise.resolve({ data: null }),
        variantB.coupon_id
          ? ctx.supabase.from('promo_coupons').select('code').eq('id', variantB.coupon_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      await ctx.supabase
        .from('ab_campaigns')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', campaignId);

      let sentA = 0;
      let sentB = 0;
      await mapWithConcurrency(testRecipients, concurrency, async (rec) => {
        const contact = contactById.get(rec.contact_id);
        if (!contact) return;
        const isA = rec.variant_key === 'A';
        const ok = await deliverOne(
          contact,
          isA ? variantA : variantB,
          rec.id,
          isA ? cpA.data?.code ?? null : cpB.data?.code ?? null
        );
        if (ok) {
          if (isA) sentA += 1;
          else sentB += 1;
        }
      });

      const hasHoldout = shuffled.length > testCount;
      await Promise.all([
        ctx.supabase
          .from('ab_campaign_variants')
          .update({ sent_count: variantA.sent_count + sentA })
          .eq('id', variantA.id),
        ctx.supabase
          .from('ab_campaign_variants')
          .update({ sent_count: variantB.sent_count + sentB })
          .eq('id', variantB.id),
        ctx.supabase
          .from('ab_campaigns')
          .update({
            status: hasHoldout ? 'evaluating' : 'completed',
            completed_at: hasHoldout ? null : new Date().toISOString(),
          })
          .eq('id', campaignId),
      ]);

      return NextResponse.json({
        ok: true,
        sentA,
        sentB,
        holdoutQueued: Math.max(0, shuffled.length - testCount),
      });
    }

    // Create a new A/B split-test campaign
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const bodyA = typeof body.variant_a?.body_text === 'string' ? body.variant_a.body_text.trim() : '';
    const bodyB = typeof body.variant_b?.body_text === 'string' ? body.variant_b.body_text.trim() : '';

    if (!name || !bodyA || !bodyB) {
      return NextResponse.json(
        { error: 'Campaign name, Variant A copy, and Variant B copy are required' },
        { status: 400 }
      );
    }

    const splitRatio = Math.max(10, Math.min(90, Number(body.split_ratio ?? 50)));
    const holdoutPercent = Math.max(0, Math.min(80, Number(body.holdout_percent ?? 0)));

    const { data: created, error: cErr } = await ctx.supabase
      .from('ab_campaigns')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        goal: typeof body.goal === 'string' ? body.goal : 'promotion',
        segment_id: typeof body.segment_id === 'string' && body.segment_id ? body.segment_id : null,
        status: 'draft',
        split_ratio: splitRatio,
        holdout_percent: holdoutPercent,
        winner_metric: ['reply_rate', 'read_rate', 'conversion_rate'].includes(body.winner_metric)
          ? body.winner_metric
          : 'reply_rate',
      })
      .select()
      .single();
