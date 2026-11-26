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
