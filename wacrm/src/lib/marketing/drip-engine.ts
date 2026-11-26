// ============================================================
// Feature 3: Multi-Step Drip Sequence Engine + Unified Inbound
// Marketing Effects Hook
//
// Responsibilities:
//   1. Quiet-hours enforcement (never message prospects overnight)
//   2. Due drip step execution across both Meta Cloud API & MboWazap
//   3. Inbound marketing hook:
//        - Growth Link [Ref:XXXX] attribution & auto-tagging
//        - Stop-on-reply exit for active drip enrollments
//        - A/B campaign reply attribution
//        - Real-time behavioral lead score update
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadTransport } from '@/lib/whatsapp/transport';
import { findOrCreateConversation } from '@/lib/whatsapp/inbound/conversations';
import { renderPersonalizedCopy } from './copywriter';
import { extractGrowthRefCode } from './qr-svg';
import { recomputeAccountLeadScores } from './lead-scoring';
import {
  loadAccountTypingConfig,
  simulateHumanTyping,
} from '@/lib/ai/typing-simulator';

function parseHHMM(hhmm: string, fallbackMinutes: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return fallbackMinutes;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallbackMinutes;
  return h * 60 + min;
}

function getTimeOfDayMinutes(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h * 60 + m;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

/**
 * Returns true if `now` falls inside the configured quiet window
 * (e.g. start='21:00', end='08:00' wraps midnight; '13:00'..'14:00' is daytime).
 */
export function isWithinQuietHours(
  now: Date,
  quietStart: string,
  quietEnd: string,
  timezone = 'UTC'
): boolean {
  const start = parseHHMM(quietStart, 21 * 60);
  const end = parseHHMM(quietEnd, 8 * 60);
  if (start === end) return false;
  const cur = getTimeOfDayMinutes(now, timezone);
  if (start > end) {
    // Wraps midnight (e.g. 21:00 → 08:00)
    return cur >= start || cur < end;
  }
  return cur >= start && cur < end;
}

/**
 * Computes the next allowed send timestamp, pushing forward to quietEnd
 * if the candidate time lands inside quiet hours.
 */
export function nextAllowedSendTime(
  candidate: Date,
  quietStart: string,
  quietEnd: string,
  timezone = 'UTC'
): Date {
  if (!isWithinQuietHours(candidate, quietStart, quietEnd, timezone)) {
    return candidate;
  }
  const end = parseHHMM(quietEnd, 8 * 60);
  const cur = getTimeOfDayMinutes(candidate, timezone);
  let deltaMinutes = end - cur;
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;
  return new Date(candidate.getTime() + deltaMinutes * 60_000);
}

export interface DripProcessResult {
  processed: number;
  sent: number;
  deferredQuietHours: number;
  exited: number;
  failed: number;
}

/**
 * Processes due `drip_enrollments` rows across all active sequences.
 * Designed to run from `/api/marketing/sequences/cron` or `/api/cron/tick`.
 */
export async function processDueDripEnrollments(
  db: SupabaseClient,
  limit = 40,
  now = new Date()
): Promise<DripProcessResult> {
  const result: DripProcessResult = {
    processed: 0,
    sent: 0,
    deferredQuietHours: 0,
    exited: 0,
    failed: 0,
  };

  const { data: due, error } = await db
    .from('drip_enrollments')
    .select(
      'id, sequence_id, account_id, contact_id, conversation_id, current_step_order, next_send_at'
    )
    .eq('status', 'active')
    .lte('next_send_at', now.toISOString())
    .order('next_send_at', { ascending: true })
    .limit(limit);

  if (error || !due || due.length === 0) return result;

  for (const enrollment of due as Array<{
    id: string;
    sequence_id: string;
    account_id: string;
    contact_id: string;
    conversation_id: string | null;
    current_step_order: number;
    next_send_at: string;
  }>) {
    // Atomically lease this enrollment for 5 minutes so overlapping cron ticks
    // cannot send duplicate drip steps to the same contact.
    const leaseUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
    const { data: claimed } = await db
      .from('drip_enrollments')
      .update({ next_send_at: leaseUntil })
      .eq('id', enrollment.id)
      .eq('status', 'active')
      .eq('next_send_at', enrollment.next_send_at)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    result.processed += 1;

    // Load parent sequence
    const { data: seq } = await db
      .from('drip_sequences')
      .select('*')
      .eq('id', enrollment.sequence_id)
      .maybeSingle();

    if (!seq || seq.status !== 'active') {
      continue;
    }

    // Quiet hours check
    if (
      isWithinQuietHours(
        now,
        seq.quiet_hours_start || '21:00',
        seq.quiet_hours_end || '08:00',
        seq.timezone || 'UTC'
      )
    ) {
      const nextTime = nextAllowedSendTime(
        now,
        seq.quiet_hours_start || '21:00',
        seq.quiet_hours_end || '08:00',
        seq.timezone || 'UTC'
      );
      await db
        .from('drip_enrollments')
        .update({ next_send_at: nextTime.toISOString() })
        .eq('id', enrollment.id);
      result.deferredQuietHours += 1;
      continue;
    }

    // Check opt-out / exit tag conditions before sending
    const { data: contactTags } = await db
      .from('contact_tags')
      .select('tag_id, tags(name)')
      .eq('contact_id', enrollment.contact_id);

    const tagRows = (contactTags ?? []) as unknown as Array<{
      tag_id: string;
      tags: { name: string } | { name: string }[] | null;
    }>;
    const shouldExit = tagRows.some((tr) => {
      if (seq.stop_on_tag_id && tr.tag_id === seq.stop_on_tag_id) return true;
      const tObj = Array.isArray(tr.tags) ? tr.tags[0] : tr.tags;
      const name = (tObj?.name || '').toLowerCase();
      return name.includes('opt-out') || name.includes('opted out') || name === 'stop';
    });

    if (shouldExit) {
      await db
        .from('drip_enrollments')
        .update({ status: 'exited', completed_at: now.toISOString() })
        .eq('id', enrollment.id);
      result.exited += 1;
      continue;
    }

    // Load sequence steps
    const { data: steps } = await db
      .from('drip_sequence_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .order('step_order', { ascending: true });

    const stepList = (steps ?? []) as Array<{
      step_order: number;
      delay_minutes: number;
      message_type: 'text' | 'template' | 'image';
      content_text: string;
      media_url: string | null;
      template_name: string | null;
      template_language: string | null;
      coupon_id: string | null;
    }>;

    const currentStep = stepList.find((s) => s.step_order === enrollment.current_step_order);
    if (!currentStep) {
      await db
        .from('drip_enrollments')
        .update({ status: 'completed', completed_at: now.toISOString() })
        .eq('id', enrollment.id);
      await db
        .from('drip_sequences')
        .update({ completed_count: Number(seq.completed_count ?? 0) + 1 })
        .eq('id', seq.id);
      continue;
    }

    // Load contact + optional coupon scoped strictly to enrollment.account_id
    const [{ data: contact }, couponRes] = await Promise.all([
      db
        .from('contacts')
        .select('*')
        .eq('id', enrollment.contact_id)
        .eq('account_id', enrollment.account_id)
        .maybeSingle(),
      currentStep.coupon_id
        ? db
            .from('promo_coupons')
            .select('code')
            .eq('id', currentStep.coupon_id)
            .eq('account_id', enrollment.account_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (!contact) {
      await db
        .from('drip_enrollments')
        .update({ status: 'exited', last_error: 'Contact deleted' })
        .eq('id', enrollment.id);
      result.exited += 1;
      continue;
    }

    try {
      const transport = await loadTransport(db, enrollment.account_id);
      const target = transport.resolveTarget(contact);
      if (!target) throw new Error('Contact has no valid WhatsApp recipient');

      let conversationId = enrollment.conversation_id;
      if (!conversationId) {
        const opened = await findOrCreateConversation(
          db,
          enrollment.account_id,
          seq.user_id,
          contact.id
        );
        conversationId = opened?.conversation.id ?? null;
      }
      if (!conversationId) throw new Error('Could not open conversation');

      const rendered = renderPersonalizedCopy(
        currentStep.content_text,
        contact,
        couponRes.data?.code ?? null
      );

      // Simulate realistic human typing before delivering drip message
      const typingCfg = await loadAccountTypingConfig(db, enrollment.account_id);
      await simulateHumanTyping({
        transport,
        to: target.target,
        conversationId,
        text: rendered,
        config: typingCfg,
      });

      let waMessageId = '';
      if (currentStep.message_type === 'template' && currentStep.template_name) {
        const sent = await transport.sendTemplate({
          to: target.target,
          templateName: currentStep.template_name,
          language: currentStep.template_language || 'en_US',
          contentText: rendered,
          params: [],
          origin: 'automation',
          conversationId,
        });
        waMessageId = sent.messageId;
      } else if (currentStep.message_type === 'image' && currentStep.media_url) {
        const sent = await transport.sendMedia({
          to: target.target,
          kind: 'image',
          link: currentStep.media_url,
          caption: rendered || undefined,
          origin: 'automation',
          conversationId,
        });
        waMessageId = sent.messageId;
      } else {
        const sent = await transport.sendText({
          to: target.target,
          text: rendered,
          origin: 'automation',
          conversationId,
        });
        waMessageId = sent.messageId;
      }

      // Persist outbound message into thread so inbox stays in sync
      await db.from('messages').insert({
        conversation_id: conversationId,
        sender_type: 'bot',
        content_type: currentStep.message_type === 'image' ? 'image' : 'text',
        content_text: rendered,
        media_url: currentStep.media_url || null,
        message_id: waMessageId,
        status: 'sent',
      });

      await db
        .from('conversations')
        .update({
          last_message_text: rendered.slice(0, 160),
          last_message_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('id', conversationId);

      // Advance to next step or complete
      const nextStep = stepList.find((s) => s.step_order > currentStep.step_order);
      if (nextStep) {
        const rawNext = new Date(now.getTime() + Math.max(1, nextStep.delay_minutes) * 60_000);
        const scheduled = nextAllowedSendTime(
          rawNext,
          seq.quiet_hours_start || '21:00',
          seq.quiet_hours_end || '08:00',
          seq.timezone || 'UTC'
        );
        await db
          .from('drip_enrollments')
          .update({
            conversation_id: conversationId,
            current_step_order: nextStep.step_order,
            last_sent_at: now.toISOString(),
            next_send_at: scheduled.toISOString(),
            last_error: null,
          })
          .eq('id', enrollment.id);
      } else {
        await db
          .from('drip_enrollments')
          .update({
            conversation_id: conversationId,
            status: 'completed',
            last_sent_at: now.toISOString(),
            completed_at: now.toISOString(),
            last_error: null,
          })
          .eq('id', enrollment.id);
        await db
          .from('drip_sequences')
          .update({ completed_count: Number(seq.completed_count ?? 0) + 1 })
          .eq('id', seq.id);
      }

      result.sent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .from('drip_enrollments')
        .update({ status: 'failed', last_error: msg.slice(0, 500) })
        .eq('id', enrollment.id);
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Runs non-blocking marketing attribution & automation side-effects
 * whenever a customer sends an inbound message:
 *   1. Growth Link [Ref:XXXX] matching -> UTM attribution + auto-tag + conversion count
 *   2. Stop-on-reply exit for active Drip Sequences
 *   3. A/B Campaign reply attribution
 *   4. Real-time Lead Score refresh
 *
 * Always swallows errors so it can NEVER interrupt core inbox ingestion.
 */
export async function handleMarketingInboundEffects(
  db: SupabaseClient,
  params: {
    accountId: string;
    contactId: string;
    contentText: string | null;
  }
): Promise<void> {
  const { accountId, contactId, contentText } = params;
  const nowIso = new Date().toISOString();

  // 1. Growth Link attribution via [Ref:CODE]
  try {
    const refCode = extractGrowthRefCode(contentText);
    if (refCode) {
      const { data: link } = await db
        .from('growth_links')
        .select('id, utm_source, utm_medium, utm_campaign, auto_tag_id, conversions_count')
        .eq('account_id', accountId)
        .eq('ref_code', refCode)
        .maybeSingle();

      if (link) {
        const { data: attributed } = await db
          .from('contacts')
          .update({
            utm_source: link.utm_source || 'growth-link',
            utm_medium: link.utm_medium || 'whatsapp',
            utm_campaign: link.utm_campaign || refCode,
            growth_link_id: link.id,
          })
          .eq('id', contactId)
          .eq('account_id', accountId)
          .is('growth_link_id', null)
          .select('id')
          .maybeSingle();

        if (attributed) {
          await db
            .from('growth_links')
            .update({
              conversions_count: Number(link.conversions_count ?? 0) + 1,
              updated_at: nowIso,
            })
            .eq('id', link.id);
        }

        if (link.auto_tag_id) {
          const { data: ownedTag } = await db
            .from('tags')
            .select('id')
            .eq('id', link.auto_tag_id)
            .eq('account_id', accountId)
            .maybeSingle();
          if (ownedTag) {
            await db
              .from('contact_tags')
              .upsert(
                { contact_id: contactId, tag_id: ownedTag.id },
                { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
              );
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 2. Stop-on-reply for active Drip Sequences
  try {
    const { data: activeEnrollments } = await db
      .from('drip_enrollments')
      .select('id, sequence_id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active');

    for (const enr of (activeEnrollments ?? []) as Array<{ id: string; sequence_id: string }>) {
      const { data: seq } = await db
        .from('drip_sequences')
        .select('id, stop_on_reply, replied_count')
        .eq('id', enr.sequence_id)
        .maybeSingle();

      if (seq?.stop_on_reply) {
        await db
          .from('drip_enrollments')
          .update({ status: 'replied', completed_at: nowIso })
          .eq('id', enr.id)
          .eq('status', 'active');
        await db
          .from('drip_sequences')
          .update({ replied_count: Number(seq.replied_count ?? 0) + 1 })
          .eq('id', seq.id);
      }
    }
  } catch {
    // Non-fatal
  }

  // 3. Attribute reply to most recent A/B Campaign sent within 7 days
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: abRecip } = await db
      .from('ab_campaign_recipients')
      .select('id, variant_id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .in('status', ['sent', 'delivered', 'read'])
      .gte('sent_at', sevenDaysAgo)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (abRecip) {
      await db
        .from('ab_campaign_recipients')
        .update({ status: 'replied', replied_at: nowIso })
        .eq('id', abRecip.id);

      if (abRecip.variant_id) {
        const { data: variant } = await db
          .from('ab_campaign_variants')
          .select('id, replied_count')
          .eq('id', abRecip.variant_id)
          .maybeSingle();
        if (variant) {
          await db
            .from('ab_campaign_variants')
            .update({ replied_count: Number(variant.replied_count ?? 0) + 1 })
            .eq('id', variant.id);
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 4. Refresh contact's live behavioral lead score
  try {
    await recomputeAccountLeadScores(db, accountId, { contactId, limit: 1 });
  } catch {
    // Non-fatal
  }
}
