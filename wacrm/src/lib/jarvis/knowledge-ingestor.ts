// ============================================================
// Multi-Tenant Knowledge Hub Ingestor
//
// Designed for SaaS distribution so every customer account can
// connect their entire business brain in minutes:
//   1. Structured Company Bio & Brand DNA (`jarvis_company_profiles`)
//   2. Website & Help-Center URL Crawler (SSRF-hardened, optional
//      same-origin multi-page crawl + scheduled auto-refresh)
//   3. Business Document File Parser (.txt, .md, .csv, .json,
//      .html, .xml, and pure-Node .pdf text extraction)
// ============================================================

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { inflateRawSync, inflateSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEmbeddingsKey } from '@/lib/ai/config';
import { ingestDocument } from '@/lib/ai/knowledge';
import { chunkText } from '@/lib/ai/chunk';
import { serverCache } from '@/lib/server/cache';
import type {
  JarvisBrandVoice,
  JarvisCompanyProfile,
  JarvisFaqPair,
  JarvisSocialLinks,
  KnowledgeSourceType,
} from '@/types/jarvis';

const MAX_FETCH_BYTES = 1_500_000; // 1.5 MB per crawled page
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB uploaded doc
const MAX_EXTRACTED_CHARS = 120_000;
const FETCH_TIMEOUT_MS = 12_000;

// ------------------------------------------------------------
// 1. Company Profile / Brand DNA
// ------------------------------------------------------------

export function createEmptyCompanyProfile(accountId: string): JarvisCompanyProfile {
  return {
    id: '',
    account_id: accountId,
    company_name: '',
    tagline: '',
    industry: '',
    company_bio: '',
    website_url: '',
    support_email: '',
    support_phone: '',
    business_hours: '',
    timezone: 'UTC',
    primary_language: 'English',
    brand_voice: 'consultative',
    products_services_summary: '',
    pricing_summary: '',
    policies_summary: '',
    escalation_rules: '',
    custom_instructions: '',
    social_links: {},
    faq_pairs: [],
    kb_document_id: null,
    completeness_score: 0,
    updated_at: new Date().toISOString(),
  };
}

export function computeProfileCompleteness(
  profile: Partial<JarvisCompanyProfile>
): number {
  const checks: Array<[boolean, number]> = [
    [Boolean(profile.company_name?.trim()), 15],
    [Boolean(profile.company_bio?.trim() && profile.company_bio.trim().length >= 30), 20],
    [Boolean(profile.industry?.trim()), 5],
    [Boolean(profile.website_url?.trim()), 10],
    [Boolean(profile.products_services_summary?.trim()), 15],
    [Boolean(profile.pricing_summary?.trim()), 10],
    [Boolean(profile.business_hours?.trim()), 5],
    [Boolean(profile.policies_summary?.trim()), 5],
    [Boolean(profile.support_email?.trim() || profile.support_phone?.trim()), 5],
    [
      Array.isArray(profile.faq_pairs) &&
        profile.faq_pairs.some((p) => p.question?.trim() && p.answer?.trim()),
      10,
    ],
  ];
  return Math.min(
    100,
    checks.reduce((acc, [ok, pts]) => acc + (ok ? pts : 0), 0)
  );
}

export function compileCompanyProfileMarkdown(
  profile: Partial<JarvisCompanyProfile>
): string {
  const sections: string[] = [];
  const name = profile.company_name?.trim() || 'Our Company';

  const headerLines = [`# ${name} — Official Company Profile & Brand DNA`];
  if (profile.tagline?.trim()) headerLines.push(`Tagline: ${profile.tagline.trim()}`);
  if (profile.industry?.trim()) headerLines.push(`Industry: ${profile.industry.trim()}`);
  if (profile.website_url?.trim()) headerLines.push(`Website: ${profile.website_url.trim()}`);
  if (profile.brand_voice) headerLines.push(`Brand Voice: ${profile.brand_voice}`);
  if (profile.primary_language?.trim()) {
    headerLines.push(`Primary Language: ${profile.primary_language.trim()}`);
  }
  sections.push(headerLines.join('\n'));

  if (profile.company_bio?.trim()) {
    sections.push(`## Company Bio\n${profile.company_bio.trim()}`);
  }
  if (profile.products_services_summary?.trim()) {
    sections.push(`## Products & Services\n${profile.products_services_summary.trim()}`);
  }
  if (profile.pricing_summary?.trim()) {
    sections.push(`## Pricing & Offers\n${profile.pricing_summary.trim()}`);
  }

  const contactBits: string[] = [];
  if (profile.business_hours?.trim()) {
    contactBits.push(`Business Hours: ${profile.business_hours.trim()} (${profile.timezone || 'UTC'})`);
  }
  if (profile.support_email?.trim()) contactBits.push(`Support Email: ${profile.support_email.trim()}`);
  if (profile.support_phone?.trim()) contactBits.push(`Support Phone: ${profile.support_phone.trim()}`);
  if (profile.social_links && typeof profile.social_links === 'object') {
    for (const [net, url] of Object.entries(profile.social_links)) {
      if (typeof url === 'string' && url.trim()) {
        contactBits.push(`${net}: ${url.trim()}`);
      }
    }
  }
  if (contactBits.length > 0) {
    sections.push(`## Contact, Hours & Social Channels\n${contactBits.join('\n')}`);
  }

  if (profile.policies_summary?.trim()) {
    sections.push(`## Policies (Shipping, Refunds, Guarantees)\n${profile.policies_summary.trim()}`);
  }
  if (profile.escalation_rules?.trim()) {
    sections.push(`## Human Escalation Rules\n${profile.escalation_rules.trim()}`);
  }
  if (profile.custom_instructions?.trim()) {
    sections.push(`## Operating Instructions\n${profile.custom_instructions.trim()}`);
  }

  const validFaqs = (profile.faq_pairs ?? []).filter(
    (f) => f && f.question?.trim() && f.answer?.trim()
  );
  if (validFaqs.length > 0) {
    const faqText = validFaqs
      .map((f, i) => `Q${i + 1}: ${f.question.trim()}\nA${i + 1}: ${f.answer.trim()}`)
      .join('\n\n');
    sections.push(`## Frequently Asked Questions\n${faqText}`);
  }

  return sections.join('\n\n');
}

export async function loadCompanyProfile(
  db: SupabaseClient,
  accountId: string
): Promise<JarvisCompanyProfile> {
  const { data } = await db
    .from('jarvis_company_profiles')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!data) return createEmptyCompanyProfile(accountId);
  return {
    ...createEmptyCompanyProfile(accountId),
    ...(data as Partial<JarvisCompanyProfile>),
    social_links: ((data as { social_links?: JarvisSocialLinks }).social_links ?? {}) as JarvisSocialLinks,
    faq_pairs: Array.isArray((data as { faq_pairs?: unknown }).faq_pairs)
      ? ((data as { faq_pairs: JarvisFaqPair[] }).faq_pairs)
      : [],
  };
}

/**
 * Lightweight cached summary injected into auto-reply and Jarvis prompts.
 * Never throws so an unmigrated DB or mock test stays green.
 */
export async function loadCompanyProfilePromptContext(
  db: SupabaseClient,
  accountId: string
): Promise<{
  companyPrompt: string | null;
  agentPersona: { name?: string; role?: string } | null;
}> {
  return serverCache.getOrLoad(
    `jarvis:prompt-ctx:${accountId}`,
    60_000,
    async () => {
      try {
        const [{ data: profile }, { data: cfg }] = await Promise.all([
          db
            .from('jarvis_company_profiles')
            .select(
              'company_name, tagline, industry, company_bio, website_url, business_hours, timezone, primary_language, brand_voice, products_services_summary, pricing_summary, policies_summary, escalation_rules, custom_instructions'
            )
            .eq('account_id', accountId)
            .maybeSingle(),
          db
            .from('jarvis_configs')
            .select('agent_name, agent_role')
            .eq('account_id', accountId)
            .maybeSingle(),
        ]);

        const persona =
          cfg && (cfg.agent_name || cfg.agent_role)
            ? {
                name: typeof cfg.agent_name === 'string' ? cfg.agent_name : undefined,
                role: typeof cfg.agent_role === 'string' ? cfg.agent_role : undefined,
              }
            : null;

        if (!profile) {
          return { companyPrompt: null, agentPersona: persona };
        }

        const compiled = compileCompanyProfileMarkdown(
          profile as Partial<JarvisCompanyProfile>
        ).trim();
        const hasSignal = Boolean(
          profile.company_name ||
            profile.company_bio ||
            profile.products_services_summary ||
            profile.pricing_summary ||
            profile.custom_instructions
        );
        return {
          companyPrompt: hasSignal ? compiled.slice(0, 4500) : null,
          agentPersona: persona,
        };
      } catch {
        return { companyPrompt: null, agentPersona: null };
      }
    }
  );
}

export function invalidateCompanyProfileCache(accountId: string): void {
  serverCache.delete(`jarvis:prompt-ctx:${accountId}`);
}

const VALID_VOICES: ReadonlySet<JarvisBrandVoice> = new Set([
  'professional',
  'friendly',
  'consultative',
  'bold',
  'luxury',
  'custom',
]);

export async function saveAndIndexCompanyProfile(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  raw: Record<string, unknown>
): Promise<{ profile: JarvisCompanyProfile; warning?: string }> {
  const existing = await loadCompanyProfile(db, accountId);

  const str = (key: string, max = 4000, fallback = '') => {
    const v = raw[key];
    if (typeof v !== 'string') return fallback;
    return v.trim().slice(0, max);
  };

  const brandVoiceRaw = typeof raw.brand_voice === 'string' ? raw.brand_voice : existing.brand_voice;
  const brand_voice: JarvisBrandVoice = VALID_VOICES.has(brandVoiceRaw as JarvisBrandVoice)
    ? (brandVoiceRaw as JarvisBrandVoice)
    : 'consultative';

  const social_links: JarvisSocialLinks = {};
  if (raw.social_links && typeof raw.social_links === 'object' && !Array.isArray(raw.social_links)) {
    for (const key of ['instagram', 'facebook', 'linkedin', 'twitter', 'tiktok', 'youtube'] as const) {
      const val = (raw.social_links as Record<string, unknown>)[key];
      if (typeof val === 'string' && val.trim()) {
        social_links[key] = val.trim().slice(0, 500);
      }
    }
  } else {
    Object.assign(social_links, existing.social_links);
  }

  const faq_pairs: JarvisFaqPair[] = Array.isArray(raw.faq_pairs)
    ? raw.faq_pairs
        .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
        .map((f) => ({
          question: typeof f.question === 'string' ? f.question.trim().slice(0, 500) : '',
          answer: typeof f.answer === 'string' ? f.answer.trim().slice(0, 2000) : '',
        }))
        .filter((f) => f.question && f.answer)
        .slice(0, 40)
    : existing.faq_pairs;

  const merged: Partial<JarvisCompanyProfile> = {
    company_name: str('company_name', 160, existing.company_name),
    tagline: str('tagline', 240, existing.tagline),
    industry: str('industry', 120, existing.industry),
    company_bio: str('company_bio', 6000, existing.company_bio),
    website_url: str('website_url', 500, existing.website_url),
    support_email: str('support_email', 200, existing.support_email),
    support_phone: str('support_phone', 60, existing.support_phone),
    business_hours: str('business_hours', 300, existing.business_hours),
    timezone: str('timezone', 80, existing.timezone || 'UTC') || 'UTC',
    primary_language: str('primary_language', 60, existing.primary_language || 'English') || 'English',
    brand_voice,
    products_services_summary: str('products_services_summary', 8000, existing.products_services_summary),
    pricing_summary: str('pricing_summary', 6000, existing.pricing_summary),
    policies_summary: str('policies_summary', 6000, existing.policies_summary),
    escalation_rules: str('escalation_rules', 3000, existing.escalation_rules),
    custom_instructions: str('custom_instructions', 4000, existing.custom_instructions),
    social_links,
    faq_pairs,
  };

  const completeness_score = computeProfileCompleteness(merged);
  const compiledMarkdown = compileCompanyProfileMarkdown(merged);
  const docTitle = `${merged.company_name || 'Company'} — Company Bio & Brand DNA`;
  const chunkCount = chunkText(compiledMarkdown).length;

  let kbDocId = existing.kb_document_id;
  let warning: string | undefined;

  // Create or update the canonical company_bio knowledge document
  if (compiledMarkdown.trim().length > 40) {
    if (kbDocId) {
      const { data: updated } = await db
        .from('ai_knowledge_documents')
        .update({
          title: docTitle,
          content: compiledMarkdown,
          source_type: 'company_bio',
          source_url: merged.website_url || null,
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          last_sync_error: null,
          chunk_count: chunkCount,
          char_count: compiledMarkdown.length,
        })
        .eq('id', kbDocId)
        .eq('account_id', accountId)
        .select('id')
        .maybeSingle();
      if (!updated) kbDocId = null;
    }

    if (!kbDocId) {
      const { data: inserted } = await db
        .from('ai_knowledge_documents')
        .insert({
          account_id: accountId,
          created_by: userId,
          title: docTitle,
          content: compiledMarkdown,
          source_type: 'company_bio',
          source_url: merged.website_url || null,
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          chunk_count: chunkCount,
          char_count: compiledMarkdown.length,
        })
        .select('id')
        .single();
      kbDocId = inserted?.id ?? null;
    }

    if (kbDocId) {
      const { key: embeddingsApiKey } = await loadEmbeddingsKey(db, accountId);
      try {
        await ingestDocument(db, accountId, { embeddingsApiKey }, kbDocId, compiledMarkdown);
      } catch (err) {
        warning = `Company profile saved, but semantic embedding degraded (${err instanceof Error ? err.message : 'error'}). Keyword search is active.`;
      }
    }
  }

  const { data: saved, error } = await db
    .from('jarvis_company_profiles')
    .upsert(
      {
        account_id: accountId,
        updated_by: userId,
        ...merged,
        kb_document_id: kbDocId,
        completeness_score,
      },
      { onConflict: 'account_id' }
    )
    .select('*')
    .single();

  if (error || !saved) {
    throw new Error(error?.message || 'Failed to save company profile');
  }

  invalidateCompanyProfileCache(accountId);
  return { profile: saved as JarvisCompanyProfile, warning };
}

// ------------------------------------------------------------
// 2. SSRF-Hardened Website Crawler & HTML Cleaner
// ------------------------------------------------------------

function isPrivateIpv4Octets(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export function isPrivateOrBlockedIp(ip: string): boolean {
  const lower = ip.toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (!lower) return true;

  // Strip IPv4-mapped IPv6 prefix ::ffff: (handles both dotted and hex forms like ::ffff:7f00:1)
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice(7);
    if (isIP(tail) === 4) {
      const parts = tail.split('.').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
      return isPrivateIpv4Octets(parts[0]!, parts[1]!);
    }
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hexMatch) {
      const hi = Number.parseInt(hexMatch[1]!, 16);
      const a = (hi >>> 8) & 0xff;
      const b = hi & 0xff;
      return isPrivateIpv4Octets(a, b);
    }
    return true;
  }

  if (isIP(lower) === 4) {
    const parts = lower.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
    return isPrivateIpv4Octets(parts[0]!, parts[1]!);
  }

  if (isIP(lower) === 6) {
    if (lower === '::' || lower === '::1') return true;
    // Block full fe80::/10 link-local, fc00::/7 unique local, ff00::/8 multicast, and 0:0:0:0:0:ffff:...
    if (/^fe[89ab][0-9a-f]:/.test(lower) || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    if (lower.startsWith('ff') || /^0*:0*:0*:0*:0*:ffff:/.test(lower)) return true;
    return false;
  }

  return true;
}

export async function validatePublicHttpUrl(
  rawUrl: string,
  opts: { skipDnsLookup?: boolean } = {}
): Promise<URL> {
  const trimmed = rawUrl.trim();
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Please enter a valid website URL (e.g. https://example.com)');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http:// and https:// URLs are supported');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  const host = parsed.hostname.toLowerCase();
  const bareHost = host.replace(/^\[|\]$/g, '');
  if (
    !bareHost ||
    bareHost === 'localhost' ||
    bareHost.endsWith('.localhost') ||
    bareHost.endsWith('.local') ||
    bareHost.endsWith('.internal') ||
    bareHost.endsWith('.arpa')
  ) {
    throw new Error('Private or internal network URLs are not allowed');
  }

  if (isIP(bareHost)) {
    if (isPrivateOrBlockedIp(bareHost)) {
      throw new Error('Private IP addresses are not allowed');
    }
  } else if (!opts.skipDnsLookup) {
    let records: Array<{ address: string }>;
    try {
      records = await lookup(bareHost, { all: true });
    } catch {
      throw new Error(`Could not resolve domain "${bareHost}"`);
    }
    if (!records.length || records.some((r) => isPrivateOrBlockedIp(r.address))) {
      throw new Error('Website resolves to a private or disallowed IP address');
    }
  }

  return parsed;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n >= 32 && n <= 126 ? String.fromCharCode(n) : ' ';
    });
}

export function htmlToCleanText(html: string): {
  title: string;
  description: string;
  text: string;
} {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';

  const descMatch =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i.exec(html);
  const description = descMatch ? decodeHtmlEntities(descMatch[1]).trim() : '';

  // Extract JSON-LD snippets (FAQPage / Product / Organization) before stripping scripts
  const ldParts: string[] = [];
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldRe.exec(html)) !== null && ldParts.length < 4) {
    try {
      const parsed = JSON.parse(ldMatch[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item?.['@type'] === 'FAQPage' && Array.isArray(item.mainEntity)) {
          for (const q of item.mainEntity.slice(0, 20)) {
            if (q?.name && q?.acceptedAnswer?.text) {
              ldParts.push(`Q: ${String(q.name).trim()}\nA: ${String(q.acceptedAnswer.text).trim()}`);
            }
          }
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }

  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, '\n\n## $2\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<(?:p|div|section|article|tr|br|hr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  body = decodeHtmlEntities(body)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const assembled: string[] = [];
  if (title) assembled.push(`# ${title}`);
  if (description) assembled.push(description);
  if (body) assembled.push(body);
  if (ldParts.length > 0) {
    assembled.push(`## Structured FAQs\n${ldParts.join('\n\n')}`);
  }

  return {
    title,
    description,
    text: assembled.join('\n\n').slice(0, MAX_EXTRACTED_CHARS),
  };
}

const PRIORITY_PATH_HINTS = [
  /about/i,
  /pricing|plans|tarif/i,
  /faq|help|support/i,
  /product|service|feature|solution|catalog|shop/i,
  /contact|hours|location/i,
  /policy|refund|shipping|terms/i,
];

export function extractSameOriginLinks(html: string, baseUrl: URL, maxLinks = 4): string[] {
  const seen = new Set<string>([`${baseUrl.origin}${baseUrl.pathname.replace(/\/$/, '')}`]);
  const candidates: Array<{ url: string; priority: number }> = [];
  const hrefRe = /<a[^>]+href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;

  while ((m = hrefRe.exec(html)) !== null) {
    const rawHref = m[1].trim();
    if (!rawHref || /^(mailto:|tel:|javascript:)/i.test(rawHref)) continue;
    let resolved: URL;
    try {
      resolved = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== baseUrl.origin) continue;
    if (/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|pdf|zip|mp4|mp3|woff2?)$/i.test(resolved.pathname)) {
      continue;
    }
    const cleanKey = `${resolved.origin}${resolved.pathname.replace(/\/$/, '')}`;
    if (seen.has(cleanKey)) continue;
    seen.add(cleanKey);

    let priority = 0;
    for (let i = 0; i < PRIORITY_PATH_HINTS.length; i++) {
      if (PRIORITY_PATH_HINTS[i].test(resolved.pathname)) {
        priority = PRIORITY_PATH_HINTS.length - i + 1;
        break;
      }
    }
    candidates.push({ url: `${resolved.origin}${resolved.pathname}`, priority });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.slice(0, maxLinks).map((c) => c.url);
}

async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body || typeof res.body.getReader !== 'function') {
    return (await res.text()).slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let total = 0;
  let out = '';
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      out += decoder.decode(slice, { stream: true });
      total += slice.byteLength;
      if (total >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    out += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return out;
}

async function fetchSinglePage(
  targetUrl: URL,
  fetchImpl: typeof fetch = fetch
): Promise<{ html: string; finalUrl: string; contentType: string }> {
  const MAX_REDIRECTS = 3;
  let currentUrl = targetUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(currentUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'user-agent': 'MboWazapJarvisBot/1.0 (+https://mbowazapcrm.app; KnowledgeBaseSync)',
        accept: 'text/html, text/plain, text/markdown, application/json;q=0.9, */*;q=0.5',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc && hop < MAX_REDIRECTS) {
        await res.body?.cancel().catch(() => {});
        currentUrl = await validatePublicHttpUrl(new URL(loc, currentUrl).toString());
        continue;
      }
      throw new Error(`Too many redirects or missing Location header (HTTP ${res.status})`);
    }

    if (!res.ok) {
      throw new Error(`Website returned HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || 'text/html';
    const html = await readBodyCapped(res, MAX_FETCH_BYTES);
    return { html, finalUrl: currentUrl.toString(), contentType };
  }

  throw new Error('Too many redirects');
}

export async function crawlWebsiteUrl(
  rawUrl: string,
  opts: { crawlSubpages?: boolean; maxPages?: number; fetchImpl?: typeof fetch; skipDnsLookup?: boolean } = {}
): Promise<{
  title: string;
  finalUrl: string;
  pagesCrawled: number;
  content: string;
}> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const parsedUrl = await validatePublicHttpUrl(rawUrl, { skipDnsLookup: opts.skipDnsLookup });
  const root = await fetchSinglePage(parsedUrl, fetchImpl);

  const isHtml = /html|xml/i.test(root.contentType) || /<html|<body|<title/i.test(root.html.slice(0, 500));
  const rootExtracted = isHtml
    ? htmlToCleanText(root.html)
    : { title: parsedUrl.hostname, description: '', text: root.html.trim() };

  const blocks: string[] = [
    `Source URL: ${root.finalUrl}\n\n${rootExtracted.text}`,
  ];
  let pagesCrawled = 1;

  if (opts.crawlSubpages && isHtml) {
    const maxSub = Math.min(4, Math.max(0, (opts.maxPages ?? 5) - 1));
    const subLinks = extractSameOriginLinks(root.html, parsedUrl, maxSub);
    for (const sub of subLinks) {
      try {
        const subUrl = await validatePublicHttpUrl(sub, { skipDnsLookup: opts.skipDnsLookup });
        const page = await fetchSinglePage(subUrl, fetchImpl);
        const extracted = htmlToCleanText(page.html);
        if (extracted.text.length >= 60) {
          blocks.push(`\n\n=== Page: ${page.finalUrl} ===\n\n${extracted.text}`);
          pagesCrawled += 1;
        }
      } catch {
        // Best-effort for secondary pages
      }
    }
  }

  const combined = blocks.join('\n').trim().slice(0, MAX_EXTRACTED_CHARS);
  if (combined.length < 25) {
    throw new Error('Could not extract readable text from this URL (the page may require JavaScript login).');
  }

  return {
    title: rootExtracted.title || parsedUrl.hostname,
    finalUrl: root.finalUrl,
    pagesCrawled,
    content: combined,
  };
}

export async function ingestWebsiteIntoKnowledgeBase(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  opts: {
    url: string;
    title?: string;
    crawlSubpages?: boolean;
    autoSyncHours?: number | null;
    existingDocId?: string;
  }
): Promise<{
  id: string;
  title: string;
  pagesCrawled: number;
  chunkCount: number;
  charCount: number;
  warning?: string;
}> {
  const crawled = await crawlWebsiteUrl(opts.url, {
    crawlSubpages: opts.crawlSubpages,
    maxPages: opts.crawlSubpages ? 5 : 1,
  });

  const finalTitle = (opts.title?.trim() || crawled.title || crawled.finalUrl).slice(0, 180);
  const chunkCount = chunkText(crawled.content).length;
  const nowIso = new Date().toISOString();

  let docId = opts.existingDocId;
  if (docId) {
    const { error } = await db
      .from('ai_knowledge_documents')
      .update({
        title: finalTitle,
        content: crawled.content,
        source_type: 'website',
        source_url: crawled.finalUrl,
        sync_status: 'synced',
        last_synced_at: nowIso,
        last_sync_error: null,
        auto_sync_hours: opts.autoSyncHours ?? null,
        chunk_count: chunkCount,
        char_count: crawled.content.length,
        metadata: {
          crawlSubpages: Boolean(opts.crawlSubpages),
          pagesCrawled: crawled.pagesCrawled,
        },
      })
      .eq('id', docId)
      .eq('account_id', accountId);
    if (error) throw new Error(error.message);
  } else {
    const { data: doc, error } = await db
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        created_by: userId,
        title: finalTitle,
        content: crawled.content,
        source_type: 'website',
        source_url: crawled.finalUrl,
        sync_status: 'synced',
        last_synced_at: nowIso,
        auto_sync_hours: opts.autoSyncHours ?? null,
        chunk_count: chunkCount,
        char_count: crawled.content.length,
        metadata: {
          crawlSubpages: Boolean(opts.crawlSubpages),
          pagesCrawled: crawled.pagesCrawled,
        },
      })
      .select('id')
      .single();
    if (error || !doc) throw new Error(error?.message || 'Failed to save website document');
    docId = doc.id;
  }

  const { key: embeddingsApiKey } = await loadEmbeddingsKey(db, accountId);
  let warning: string | undefined;
  try {
    await ingestDocument(db, accountId, { embeddingsApiKey }, docId!, crawled.content);
  } catch (err) {
    warning = `Website saved (${crawled.pagesCrawled} page(s)), but semantic embedding degraded (${err instanceof Error ? err.message : 'error'}). Keyword search is active.`;
  }

  return {
    id: docId!,
    title: finalTitle,
    pagesCrawled: crawled.pagesCrawled,
    chunkCount,
    charCount: crawled.content.length,
    warning,
  };
}

export async function syncStaleWebsiteSources(
  db: SupabaseClient,
  limit = 6
): Promise<{ checked: number; synced: number; failed: number }> {
  const result = { checked: 0, synced: 0, failed: 0 };
  const { data: rows, error } = await db
    .from('ai_knowledge_documents')
    .select('id, account_id, created_by, title, source_url, auto_sync_hours, last_synced_at, metadata')
    .eq('source_type', 'website')
    .not('source_url', 'is', null)
    .not('auto_sync_hours', 'is', null)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(limit * 2);

  if (error || !rows || rows.length === 0) return result;

  const nowMs = Date.now();
  for (const row of rows) {
    if (result.checked >= limit) break;
    const intervalMs = Math.max(1, Number(row.auto_sync_hours ?? 24)) * 3_600_000;
    const lastMs = row.last_synced_at ? new Date(row.last_synced_at).getTime() : 0;
    if (nowMs - lastMs < intervalMs) continue;

    result.checked += 1;
    try {
      const meta = (row.metadata ?? {}) as { crawlSubpages?: boolean };
      await ingestWebsiteIntoKnowledgeBase(db, row.account_id, row.created_by || row.account_id, {
        url: row.source_url,
        title: row.title,
        crawlSubpages: Boolean(meta.crawlSubpages),
        autoSyncHours: row.auto_sync_hours,
        existingDocId: row.id,
      });
      result.synced += 1;
    } catch (err) {
      result.failed += 1;
      await db
        .from('ai_knowledge_documents')
        .update({
          sync_status: 'error',
          last_synced_at: new Date().toISOString(),
          last_sync_error: err instanceof Error ? err.message.slice(0, 400) : 'Sync failed',
        })
        .eq('id', row.id);
    }
  }
  return result;
}

// ------------------------------------------------------------
// 3. Business Document File Extractor (TXT, MD, CSV, JSON, HTML, PDF)
// ------------------------------------------------------------

function decodePdfLiteralString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function extractTextOperatorsFromPdfStream(streamText: string): string[] {
  const pieces: string[] = [];
  const btRe = /BT([\s\S]*?)ET/g;
  let bt: RegExpExecArray | null;
  while ((bt = btRe.exec(streamText)) !== null) {
    const block = bt[1];
    // Match (literal) Tj or [(lit) -10 (lit)] TJ
    const litRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let m: RegExpExecArray | null;
    const lineParts: string[] = [];
    while ((m = litRe.exec(block)) !== null) {
      const decoded = decodePdfLiteralString(m[1]).trim();
      if (decoded) lineParts.push(decoded);
    }
    if (lineParts.length > 0) pieces.push(lineParts.join(' '));
  }
  return pieces;
}

export function extractTextFromPdfBuffer(buffer: Buffer): string {
  const latin = buffer.toString('latin1');
  const extracted: string[] = [];

  // 1. Direct uncompressed BT...ET blocks
  extracted.push(...extractTextOperatorsFromPdfStream(latin));

  // 2. Decompress FlateDecode streams
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let sm: RegExpExecArray | null;
  while ((sm = streamRe.exec(latin)) !== null) {
    const rawStream = Buffer.from(sm[1], 'latin1');
    if (rawStream.length === 0 || rawStream.length > 2_000_000) continue;
    let inflated: Buffer | null = null;
    try {
      inflated = inflateSync(rawStream);
    } catch {
      try {
        inflated = inflateRawSync(rawStream);
      } catch {
        inflated = null;
      }
    }
    if (inflated) {
      const text = inflated.toString('latin1');
      if (text.includes('BT') && text.includes('ET')) {
        extracted.push(...extractTextOperatorsFromPdfStream(text));
      }
    }
  }

  return extracted
    .join('\n')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatCsvAsReadableText(csvText: string): string {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';

  const splitRow = (line: string): string[] => {
    const cols: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = splitRow(lines[0]);
  if (lines.length === 1) return headers.join(' | ');

  const rows: string[] = [];
  for (let i = 1; i < Math.min(lines.length, 500); i++) {
    const vals = splitRow(lines[i]);
    const pairs = headers
      .map((h, idx) => (vals[idx] ? `${h}: ${vals[idx]}` : ''))
      .filter(Boolean);
    if (pairs.length > 0) rows.push(`- ${pairs.join(' | ')}`);
  }
  return rows.join('\n');
}

export function extractTextFromUploadedFile(
  buffer: Buffer,
  fileName: string,
  mimeType = ''
): string {
  if (buffer.byteLength === 0) {
    throw new Error('Uploaded file is empty');
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('File exceeds the 5 MB limit');
  }

  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mime = mimeType.toLowerCase();

  let extracted = '';
  if (ext === 'pdf' || mime === 'application/pdf') {
    extracted = extractTextFromPdfBuffer(buffer);
    if (extracted.length < 20) {
      throw new Error(
        'This PDF appears to be scanned/image-only or uses unsupported font encoding. Please export it as .txt/.md or paste its text.'
      );
    }
  } else if (ext === 'csv' || mime.includes('csv')) {
    extracted = formatCsvAsReadableText(buffer.toString('utf-8'));
  } else if (ext === 'json' || mime.includes('json')) {
    const raw = buffer.toString('utf-8');
    try {
      extracted = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      extracted = raw;
    }
  } else if (ext === 'html' || ext === 'htm' || ext === 'xml' || mime.includes('html')) {
    extracted = htmlToCleanText(buffer.toString('utf-8')).text;
  } else if (
    ['txt', 'md', 'markdown', 'log', 'yaml', 'yml', 'tsv'].includes(ext) ||
    mime.startsWith('text/')
  ) {
    extracted = buffer.toString('utf-8').trim();
  } else {
    throw new Error(
      `Unsupported file format ".${ext || 'unknown'}". Supported formats: .txt, .md, .csv, .json, .html, .pdf`
    );
  }

  const cleaned = extracted.trim().slice(0, MAX_EXTRACTED_CHARS);
  if (cleaned.length < 10) {
    throw new Error('Could not extract meaningful text from this file');
  }
  return cleaned;
}

export async function ingestUploadedFileIntoKnowledgeBase(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  opts: {
    buffer: Buffer;
    fileName: string;
    mimeType?: string;
    title?: string;
    sourceType?: KnowledgeSourceType;
  }
): Promise<{
  id: string;
  title: string;
  chunkCount: number;
  charCount: number;
  warning?: string;
}> {
  const content = extractTextFromUploadedFile(opts.buffer, opts.fileName, opts.mimeType);
  const title = (
    opts.title?.trim() || opts.fileName.replace(/\.[^.]+$/, '') || 'Uploaded Document'
  ).slice(0, 180);
  const sourceType: KnowledgeSourceType = opts.sourceType ?? 'document';
  const chunkCount = chunkText(content).length;

  const { data: doc, error } = await db
    .from('ai_knowledge_documents')
    .insert({
      account_id: accountId,
      created_by: userId,
      title,
      content,
      source_type: sourceType,
      file_name: opts.fileName.slice(0, 255),
      mime_type: (opts.mimeType || 'text/plain').slice(0, 120),
      file_size_bytes: opts.buffer.byteLength,
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
      chunk_count: chunkCount,
      char_count: content.length,
    })
    .select('id')
    .single();

  if (error || !doc) {
    throw new Error(error?.message || 'Failed to store uploaded document');
  }

  const { key: embeddingsApiKey } = await loadEmbeddingsKey(db, accountId);
  let warning: string | undefined;
  try {
    await ingestDocument(db, accountId, { embeddingsApiKey }, doc.id, content);
  } catch (err) {
    warning = `File saved, but semantic embedding degraded (${err instanceof Error ? err.message : 'error'}). Keyword search is active.`;
  }

  return {
    id: doc.id,
    title,
    chunkCount,
    charCount: content.length,
    warning,
  };
}
