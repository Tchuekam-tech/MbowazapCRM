// ============================================================
// Feature 2: AI Lead Intelligence & Smart Dynamic Segments
//
// Deterministic real-time behavioral scoring (0-100) + optional
// LLM deep analysis + dynamic audience segment evaluation.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadSignal, LeadTier, SegmentRules } from '@/types/marketing';
import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';

export interface LeadScoreInput {
  inboundMessageCount: number;
  outboundMessageCount: number;
  recentCustomerTexts: string[];
  lastMessageAt: string | null;
  openDealsCount: number;
  openDealsValue: number;
  wonDealsCount: number;
  tagNames: string[];
  hasGrowthAttribution: boolean;
  nowMs?: number;
}

export interface ComputedLeadScore {
  score: number;
  tier: LeadTier;
  intentLabel: string;
  signals: LeadSignal[];
  nextBestAction: string;
}

const HIGH_BUY_INTENT_PATTERNS: Array<{ re: RegExp; label: string; pts: number }> = [
  {
    re: /\b(buy|purchase|order|checkout|pay|payment|invoice|subscribe|sign up|acheter|commander|payer|paiement|facture|abonner|comprar|pedir|pagar|assinar)\b/i,
    label: 'Direct purchase intent keywords',
    pts: 22,
  },
  {
    re: /\b(price|pricing|cost|quote|how much|rate|plan|package|pack|tarif|prix|combien|devis|forfait|precio|cuanto|quanto|orcamento)\b/i,
    label: 'Pricing & package inquiry',
    pts: 16,
  },
  {
    re: /\b(discount|coupon|promo|offer|deal|trial|demo|sample|remise|reduction|essai|demonstration|descuento|cupom)\b/i,
    label: 'Offer / demo interest',
    pts: 12,
  },
  {
    re: /\b(urgent|today|now|asap|ready|available|delivery|shipping|aujourd'hui|maintenant|disponible|livraison|hoy|ahora|entrega)\b/i,
    label: 'Time-sensitive buying signal',
    pts: 10,
  },
];

const OPT_OUT_PATTERNS = /\b(stop|unsubscribe|opt[- ]?out|arret|arrêt|ne plus|pas interess|do not contact|spam)\b/i;

export function tierFromScore(score: number): LeadTier {
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

/**
 * Deterministic real-time behavioral scoring (0..100).
 * Runs in <1ms with zero external calls so every inbound message and
 * contact refresh stays instantaneous.
 */
export function computeLeadScore(input: LeadScoreInput): ComputedLeadScore {
  const now = input.nowMs ?? Date.now();
  const signals: LeadSignal[] = [];
  let score = 0;

  // 1. Recency (up to +25)
  if (input.lastMessageAt) {
    const ageHours = Math.max(0, (now - Date.parse(input.lastMessageAt)) / 3_600_000);
    if (ageHours <= 24) {
      score += 25;
      signals.push({ label: 'Active within 24 hours', points: 25, category: 'recency' });
    } else if (ageHours <= 72) {
      score += 18;
      signals.push({ label: 'Active within 3 days', points: 18, category: 'recency' });
    } else if (ageHours <= 168) {
      score += 10;
      signals.push({ label: 'Active this week', points: 10, category: 'recency' });
    } else if (ageHours <= 720) {
      score += 4;
      signals.push({ label: 'Active within 30 days', points: 4, category: 'recency' });
    } else if (ageHours > 1440) {
      score -= 12;
      signals.push({ label: 'Dormant for 60+ days', points: -12, category: 'risk' });
    }
  }

  // 2. Engagement depth (up to +20)
  if (input.inboundMessageCount >= 5) {
    score += 20;
    signals.push({
      label: `Deep engagement (${input.inboundMessageCount} customer messages)`,
      points: 20,
      category: 'engagement',
    });
  } else if (input.inboundMessageCount >= 2) {
    score += 12;
    signals.push({
      label: `Two-way conversation (${input.inboundMessageCount} messages)`,
      points: 12,
      category: 'engagement',
    });
  } else if (input.inboundMessageCount === 1) {
    score += 6;
    signals.push({ label: 'Initiated conversation', points: 6, category: 'engagement' });
  }

  // 3. Multilingual buying intent (up to +32)
  const corpus = input.recentCustomerTexts.join('\n');
  let intentPts = 0;
  let primaryIntent = 'General Inquiry';
  for (const rule of HIGH_BUY_INTENT_PATTERNS) {
    if (rule.re.test(corpus)) {
      const add = Math.min(rule.pts, Math.max(0, 32 - intentPts));
      if (add > 0) {
        intentPts += add;
        score += add;
        signals.push({ label: rule.label, points: add, category: 'intent' });
      }
      if (primaryIntent === 'General Inquiry') {
        primaryIntent =
          rule.pts >= 20
            ? 'Ready to Buy'
            : rule.pts >= 15
              ? 'Pricing Inquiry'
              : 'Promo / Demo Interest';
      }
    }
  }

  // 4. Pipeline & Deal Value (up to +20)
  if (input.wonDealsCount > 0) {
    score += 16;
    signals.push({
      label: `Existing customer (${input.wonDealsCount} won deal${input.wonDealsCount > 1 ? 's' : ''})`,
      points: 16,
      category: 'deal',
    });
    if (primaryIntent === 'General Inquiry') primaryIntent = 'Repeat / VIP Customer';
  } else if (input.openDealsCount > 0) {
    const dealPts = input.openDealsValue >= 500 ? 18 : 12;
    score += dealPts;
    signals.push({
      label: `Active pipeline deal (${input.openDealsCount})`,
      points: dealPts,
      category: 'deal',
    });
    if (primaryIntent === 'General Inquiry') primaryIntent = 'Active Opportunity';
  }
