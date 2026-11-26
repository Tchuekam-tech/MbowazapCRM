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

  let aBody: string;
  let bBody: string;

  if (lang.startsWith('fr')) {
    const cFr = req.couponCode
      ? `\n\nUtilisez le code *${req.couponCode}* en répondant pour en profiter.`
      : '';
    aBody = `Bonjour {{first_name}} 👋\n\nPetite question rapide : vous cherchez encore à avancer sur ${offer} ?\n\nNous ouvrons quelques places prioritaires cette semaine.${cFr}\n\nRépondez *OUI* et je vous envoie les détails en 30 secondes.`;
    bBody = `Bonjour {{first_name}} ✨\n\nOffre spéciale (${req.goal}) : ${offer} est disponible dès aujourd'hui.${cFr}\n\nLes créneaux partent vite — répondez simplement à ce message pour réserver le vôtre.`;
  } else if (lang.startsWith('es')) {
    const cEs = req.couponCode
      ? `\n\nUsa el código *${req.couponCode}* al responder para activarlo.`
      : '';
    aBody = `Hola {{first_name}} 👋\n\nPregunta rápida: ¿sigues interesado en ${offer}?\n\nAbrimos acceso prioritario esta semana.${cEs}\n\nResponde *SÍ* y te comparto los detalles ahora mismo.`;
    bBody = `Hola {{first_name}} ✨\n\nAcceso exclusivo (${req.goal}): ${offer} ya está disponible.${cEs}\n\nCupos limitados — responde a este mensaje para reservar el tuyo.`;
  } else if (lang.startsWith('pt')) {
    const cPt = req.couponCode
      ? `\n\nUse o código *${req.couponCode}* ao responder para garantir.`
      : '';
    aBody = `Olá {{first_name}} 👋\n\nPergunta rápida: você ainda quer aproveitar ${offer}?\n\nLiberamos vagas prioritárias esta semana.${cPt}\n\nResponda *SIM* e envio os detalhes agora.`;
    bBody = `Olá {{first_name}} ✨\n\nCondição especial (${req.goal}): ${offer} está disponível hoje.${cPt}\n\nVagas limitadas — responda esta mensagem para reservar.`;
  } else {
    aBody = `Hi {{first_name}} 👋\n\nQuick question — are you still looking into ${offer}?\n\nWe just opened priority access this week.${couponLine}\n\nReply *YES* and I'll send the quick breakdown right away.`;
    bBody = `Hi {{first_name}} ✨\n\n${req.goal}: ${offer} is live right now.${couponLine}\n\nSpots are limited — just reply to this message and we'll get you set up in under 2 minutes.`;
  }

  return {
    variantA: {
      label: 'Conversational Hook',
      body: aBody,
      compliance: lintWhatsAppCopy(aBody),
    },
    variantB: {
      label: 'Direct Value & Urgency',
      body: bBody,
      compliance: lintWhatsAppCopy(bBody),
    },
    usedAi: false,
  };
}

/**
 * Generates two A/B split-test WhatsApp variants using the account's configured
 * AI model (Gemini / OpenAI / Anthropic), with instant high-converting fallback
 * templates when no AI provider key is configured.
 */
export async function generateAbCopyVariants(
  db: SupabaseClient,
  accountId: string,
  req: CopywriterRequest
): Promise<GeneratedAbCopy> {
  const config = await loadAiConfig(db, accountId, { requireActive: false }).catch(() => null);
  if (!config) {
    return buildFallbackAbCopy(req);
  }

  try {
    const prompt = [
      `Goal: ${req.goal}`,
      `Offer / Product: ${req.offer}`,
      req.audience ? `Target Audience: ${req.audience}` : null,
      `Tone: ${req.tone || 'Friendly & Persuasive'}`,
      `Language: ${req.language || 'English'}`,
      req.couponCode ? `Include promo code: ${req.couponCode}` : null,
      'Include {{first_name}} placeholder naturally. Keep each variant under 380 characters, formatted cleanly for WhatsApp (short paragraphs, light *bold* emphasis, clear reply CTA). Avoid spammy ALL CAPS.',
    ]
      .filter(Boolean)
      .join('\n');

    const res = await generateReply({
      config,
      systemPrompt:
        'You are a world-class WhatsApp direct-response marketing copywriter. Return ONLY valid JSON (no markdown code fences) with shape: {"variantA":{"label":"...","body":"..."},"variantB":{"label":"...","body":"..."}}. Variant A uses a conversational curiosity hook; Variant B uses direct value + urgency.',
      messages: [{ role: 'user', content: prompt }],
    });
