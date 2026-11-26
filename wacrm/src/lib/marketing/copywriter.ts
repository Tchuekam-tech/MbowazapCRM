// ============================================================
// Feature 4: AI Marketing Copywriter, WhatsApp Compliance Linter
// & A/B Split-Test Winner Engine
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AbCampaignVariant, AbWinnerMetric } from '@/types/marketing';
import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';

export interface ComplianceReport {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  warnings: string[];
}

const SPAM_PHRASES = [
  /act now!!!/i,
  /100%\s*free/i,
  /guaranteed\s+(money|income|winner)/i,
  /click here immediately/i,
  /bit\.ly|tinyurl\.com/i,
];

/**
 * Scores a WhatsApp marketing message for account-safety & high engagement.
 * Protects WhatsApp quality rating and prevents spam blocks.
 */
export function lintWhatsAppCopy(text: string): ComplianceReport {
  const trimmed = (text || '').trim();
  const warnings: string[] = [];
  let score = 100;

  if (!trimmed) {
    return { score: 0, grade: 'D', warnings: ['Message body is empty.'] };
  }
