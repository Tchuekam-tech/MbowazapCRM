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

