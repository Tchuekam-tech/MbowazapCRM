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

  if (trimmed.length > 700) {
    score -= 18;
    warnings.push('Long copy (>700 chars) reduces mobile read completion on WhatsApp.');
  } else if (trimmed.length > 480) {
    score -= 8;
    warnings.push('Consider tightening under 480 characters for instant mobile readability.');
  }

  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 12) {
    const upper = letters.replace(/[^A-Z]/g, '').length;
    if (upper / letters.length > 0.35) {
      score -= 22;
      warnings.push('Excessive ALL CAPS triggers WhatsApp spam filters and hurts trust.');
    }
  }

  const bangs = (trimmed.match(/!/g) ?? []).length;
  if (bangs >= 4) {
    score -= 12;
    warnings.push('Too many exclamation marks can look spammy — keep to 1-2.');
  }

  for (const pattern of SPAM_PHRASES) {
    if (pattern.test(trimmed)) {
      score -= 20;
      warnings.push('Contains spam-trigger phrasing or public URL shorteners flagged by Meta.');
      break;
    }
  }

  if (!/\{\{\s*(name|first_name)\s*\}\}/i.test(trimmed)) {
    score -= 5;
    warnings.push('Add {{first_name}} personalization to boost reply rates by ~20-35%.');
  }

  const clamped = Math.max(0, Math.min(100, score));
  const grade = clamped >= 85 ? 'A' : clamped >= 70 ? 'B' : clamped >= 50 ? 'C' : 'D';
  return { score: clamped, grade, warnings };
}

export function renderPersonalizedCopy(
  template: string,
  contact: {
    name?: string | null;
    phone?: string | null;
    company?: string | null;
    email?: string | null;
  },
  couponCode?: string | null
): string {
  const fullName = (contact.name || '').trim() || 'there';
  const firstName = fullName.split(/\s+/)[0] || fullName;
  return template
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*company\s*\}\}/gi, (contact.company || '').trim() || 'your business')
    .replace(/\{\{\s*phone\s*\}\}/gi, contact.phone || '')
    .replace(/\{\{\s*email\s*\}\}/gi, contact.email || '')
    .replace(/\{\{\s*coupon\s*\}\}/gi, couponCode || '');
}

export interface CopywriterRequest {
  goal: string;
  offer: string;
  audience?: string;
  tone?: string;
  language?: string;
  couponCode?: string | null;
}

export interface GeneratedAbCopy {
  variantA: { label: string; body: string; compliance: ComplianceReport };
  variantB: { label: string; body: string; compliance: ComplianceReport };
  usedAi: boolean;
}

function buildFallbackAbCopy(req: CopywriterRequest): GeneratedAbCopy {
  const couponLine = req.couponCode
    ? `\n\nUse code *${req.couponCode}* when replying to lock it in.`
    : '';
  const offer = req.offer.trim() || 'our latest offer';
  const lang = (req.language || 'English').toLowerCase();
