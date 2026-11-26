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
  }>) {
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
