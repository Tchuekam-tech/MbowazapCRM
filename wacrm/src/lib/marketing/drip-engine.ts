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

