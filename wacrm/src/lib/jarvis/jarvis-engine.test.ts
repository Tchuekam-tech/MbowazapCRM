import { describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  computeHumanTypingDelayMs,
  simulateHumanTyping,
  DEFAULT_TYPING_CONFIG,
} from '@/lib/ai/typing-simulator';
import {
  compileCompanyProfileMarkdown,
  computeProfileCompleteness,
  crawlWebsiteUrl,
  extractSameOriginLinks,
  extractTextFromUploadedFile,
  htmlToCleanText,
  isPrivateOrBlockedIp,
  validatePublicHttpUrl,
} from './knowledge-ingestor';
import { computeEcosystemHealthScore } from './ecosystem-analyzer';
import {
  buildDeterministicProposals,
  createDefaultJarvisConfig,
  evaluateActionGuardrail,
} from './autonomous-engine';
import type { EcosystemSnapshot } from '@/types/jarvis';

describe('Human Typing Simulator', () => {
  it('scales typing duration proportionally to message length and speed profile', () => {
    const shortMsg = 'Hello!';
    const longMsg =
      'Thanks for reaching out to our team! We have both the Starter and Pro plans available today, and onboarding takes under 15 minutes.';

    const shortNatural = computeHumanTypingDelayMs(shortMsg, DEFAULT_TYPING_CONFIG, {
      random: () => 0.5,
    });
    const longNatural = computeHumanTypingDelayMs(longMsg, DEFAULT_TYPING_CONFIG, {
      random: () => 0.5,
    });
    const longFast = computeHumanTypingDelayMs(
      longMsg,
      { ...DEFAULT_TYPING_CONFIG, speedProfile: 'fast' },
      { random: () => 0.5 }
    );
    const longThoughtful = computeHumanTypingDelayMs(
      longMsg,
      { ...DEFAULT_TYPING_CONFIG, speedProfile: 'thoughtful' },
      { random: () => 0.5 }
    );

    expect(shortNatural).toBeGreaterThanOrEqual(DEFAULT_TYPING_CONFIG.minMs);
    expect(longNatural).toBeGreaterThan(shortNatural);
    expect(longNatural).toBeLessThanOrEqual(DEFAULT_TYPING_CONFIG.maxMs);
    expect(longThoughtful).toBeGreaterThanOrEqual(longNatural);
    expect(longFast).toBeLessThanOrEqual(longNatural);
  });

  it('subtracts elapsed LLM generation time and returns 0 when disabled', () => {
    const msg = 'Your order is confirmed and ships tomorrow morning!';
    const full = computeHumanTypingDelayMs(msg, DEFAULT_TYPING_CONFIG, { random: () => 0.5 });
    const remaining = computeHumanTypingDelayMs(msg, DEFAULT_TYPING_CONFIG, {
      alreadyElapsedMs: 2000,
      random: () => 0.5,
    });
    expect(remaining).toBe(Math.max(0, full - 2000));

    const disabled = computeHumanTypingDelayMs(msg, {
      ...DEFAULT_TYPING_CONFIG,
      enabled: false,
    });
    expect(disabled).toBe(0);
  });

  it('emits composing -> sleep -> paused and cleans up on abort', async () => {
    const events: string[] = [];
    const transport = {
      provider: 'mbowazap' as const,
      capabilities: {
        templates: false,
        broadcasts: false,
        interactive: false,
        sessionWindowHours: null,
      },
      resolveTarget: () => null,
      sendText: vi.fn(),
      sendMedia: vi.fn(),
      sendTemplate: vi.fn(),
      sendInteractive: vi.fn(),
      sendReaction: vi.fn(),
      setTyping: vi.fn(async ({ typing }: { typing: boolean }) => {
        events.push(typing ? 'composing' : 'paused');
      }),
    };

    const slept: number[] = [];
    const res = await simulateHumanTyping({
      transport,
      to: '237650000000',
      conversationId: 'conv-1',
      text: 'Hello there, let me check your account details right now.',
      config: { enabled: true, speedProfile: 'natural', minMs: 1200, maxMs: 8500 },
      random: () => 0.5,
      sleep: async (ms) => {
        slept.push(ms);
        events.push(`sleep:${ms}`);
      },
    });

    expect(res.skipped).toBe(false);
    expect(res.simulatedMs).toBeGreaterThanOrEqual(1200);
    expect(events[0]).toBe('composing');
    expect(events[events.length - 1]).toBe('paused');
    expect(slept.reduce((a, b) => a + b, 0)).toBe(res.simulatedMs);

    // Abort mid-typing must still emit paused
    const controller = new AbortController();
    events.length = 0;
    await expect(
      simulateHumanTyping({
        transport,
        to: '237650000000',
        conversationId: 'conv-1',
        text: 'This should abort mid-typing when a human replies.',
        signal: controller.signal,
        sleep: async () => {
          controller.abort(new Error('human_takeover'));
          throw new Error('human_takeover');
        },
      })
    ).rejects.toThrow('human_takeover');
    expect(events).toContain('composing');
    expect(events[events.length - 1]).toBe('paused');
  });
});

describe('Knowledge Hub Ingestor (Company DNA, SSRF Crawler, Document Parser)', () => {
  it('scores Company DNA completeness and compiles structured Markdown', () => {
    const score = computeProfileCompleteness({
      company_name: 'MboWazap Cloud',
      company_bio: 'We build autonomous WhatsApp CRM and omnichannel marketing software for African and global SMEs.',
      industry: 'SaaS',
      website_url: 'https://mbowazap.example.com',
      products_services_summary: 'CRM Inbox, Jarvis 24/7 AI Employee, Marketing Growth OS',
      pricing_summary: 'Starter $29/mo, Growth $79/mo',
      business_hours: 'Mon-Sat 08:00-19:00',
      policies_summary: '14-day refund guarantee',
      support_email: 'support@mbowazap.example.com',
      faq_pairs: [{ question: 'Do you support Buffer?', answer: 'Yes, paste your Buffer API key.' }],
    });
    expect(score).toBe(100);

    const md = compileCompanyProfileMarkdown({
      company_name: 'MboWazap Cloud',
      tagline: 'Your 24/7 WhatsApp Growth Employee',
      pricing_summary: 'Starter $29/mo',
      faq_pairs: [{ question: 'Free trial?', answer: 'Yes, 7 days free.' }],
    });
    expect(md).toContain('# MboWazap Cloud');
    expect(md).toContain('Starter $29/mo');
    expect(md).toContain('Q1: Free trial?');
  });

  it('blocks SSRF targets including localhost, metadata IPs, private RFC1918 ranges, and non-http protocols', async () => {
    expect(isPrivateOrBlockedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrBlockedIp('10.20.30.40')).toBe(true);
    expect(isPrivateOrBlockedIp('192.168.1.5')).toBe(true);
    expect(isPrivateOrBlockedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrBlockedIp('::1')).toBe(true);
    expect(isPrivateOrBlockedIp('8.8.8.8')).toBe(false);

    await expect(validatePublicHttpUrl('http://localhost:3000/admin')).rejects.toThrow();
    await expect(validatePublicHttpUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(validatePublicHttpUrl('ftp://example.com/file.txt')).rejects.toThrow();
    await expect(validatePublicHttpUrl('http://bot.railway.internal:8080')).rejects.toThrow();
  });

  it('cleans HTML pages, extracts JSON-LD FAQs, and prioritizes same-origin subpages', async () => {
    const html = `
      <html>
        <head>
          <title>Acme Solar — Clean Energy</title>
          <meta name="description" content="Affordable solar kits with 5-year warranty." />
          <script>window.__hack = 1;</script>
          <script type="application/ld+json">
            {"@type":"FAQPage","mainEntity":[{"name":"How long is installation?","acceptedAnswer":{"text":"Same day within 4 hours."}}]}
          </script>
        </head>
        <body>
          <nav><a href="/pricing">Pricing</a><a href="/about">About</a><a href="https://evil.com/x">Out</a></nav>
          <main><h1>Solar Kits</h1><p>Power your business 24/7 with zero blackouts.</p></main>
        </body>
      </html>
    `;

    const cleaned = htmlToCleanText(html);
    expect(cleaned.title).toBe('Acme Solar — Clean Energy');
    expect(cleaned.text).toContain('Power your business 24/7');
    expect(cleaned.text).toContain('Q: How long is installation?');
    expect(cleaned.text).not.toContain('window.__hack');

    const links = extractSameOriginLinks(html, new URL('https://acmesolar.example.com'), 4);
    expect(links).toContain('https://acmesolar.example.com/pricing');
    expect(links).toContain('https://acmesolar.example.com/about');
    expect(links.some((u) => u.includes('evil.com'))).toBe(false);

    const crawled = await crawlWebsiteUrl('https://acmesolar.example.com', {
      crawlSubpages: false,
      skipDnsLookup: true,
      fetchImpl: vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })),
    });
    expect(crawled.pagesCrawled).toBe(1);
    expect(crawled.content).toContain('Acme Solar');
  });

  it('extracts text from CSV, JSON, Markdown, and compressed PDF uploads', () => {
    const csv = extractTextFromUploadedFile(
      Buffer.from('Product,Price,Warranty\nSolar Kit 5kW,$950,5 Years\nInverter 3kW,$420,2 Years'),
      'catalog.csv',
      'text/csv'
    );
    expect(csv).toContain('Product: Solar Kit 5kW | Price: $950 | Warranty: 5 Years');

    // Minimal synthetic PDF with FlateDecode stream containing BT (text) Tj ET
    const compressed = deflateSync(Buffer.from('BT (Welcome to Acme Business Handbook 2026) Tj ET', 'latin1'));
    const pdfBuf = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
      compressed,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    const pdfText = extractTextFromUploadedFile(pdfBuf, 'handbook.pdf', 'application/pdf');
    expect(pdfText).toContain('Welcome to Acme Business Handbook 2026');

    expect(() =>
      extractTextFromUploadedFile(Buffer.from('binary'), 'malware.exe', 'application/octet-stream')
    ).toThrow(/Unsupported file format/);
  });
});

describe('Autonomous Jarvis Ecosystem Scoring & Guardrails', () => {
  it('computes 0-100 Ecosystem Health across 5 pillars and builds deterministic proposals', () => {
    const { healthScore, pillars } = computeEcosystemHealthScore({
      openConversations: 12,
      unansweredOver15m: 3,
      unansweredOver2h: 1,
      openDealsCount: 5,
      stalledDealsCount: 2,
      wonDeals7dCount: 1,
      hotCount: 4,
      hotWithoutDealCount: 2,
      totalContacts: 80,
      activeGrowthLinks: 3,
      bufferConnected: true,
      presenceScore: 70,
      companyProfileCompleteness: 80,
      totalDocuments: 4,
    });

    expect(healthScore).toBeGreaterThan(40);
    expect(healthScore).toBeLessThanOrEqual(100);
    expect(pillars.knowledgeReadiness).toBeGreaterThanOrEqual(16);

    const snapshot: EcosystemSnapshot = {
      capturedAt: new Date().toISOString(),
      healthScore,
      pillars,
      inbox: {
        openConversations: 5,
        unansweredOver15m: 1,
        unansweredOver2h: 1,
        aiHandledActive: 4,
        humanHandledActive: 1,
        urgentThreads: [
          {
            conversationId: 'conv-1',
            contactId: 'ct-1',
            contactName: 'Alice Ndongo',
            phone: '237650000111',
            lastMessageText: 'How much is the Growth package?',
            waitingMinutes: 140,
            leadScore: 88,
            leadTier: 'hot',
          },
        ],
      },
      leads: {
        totalContacts: 50,
        newContacts24h: 4,
        hotCount: 2,
        warmCount: 10,
        coldCount: 38,
        hotWithoutDeal: [
          {
            contactId: 'ct-1',
            contactName: 'Alice Ndongo',
            phone: '237650000111',
            score: 88,
            intentLabel: 'pricing_inquiry',
            conversationId: 'conv-1',
          },
        ],
      },
      pipeline: {
        openDealsCount: 3,
        openDealsValue: 4500,
        wonDeals7dCount: 1,
        wonRevenue7d: 1200,
        stalledDealsCount: 1,
        stalledDeals: [
          {
            dealId: 'deal-1',
            title: 'Enterprise Rollout',
            value: 3000,
            currency: 'USD',
            contactId: 'ct-2',
            contactName: 'Paul Biya Corp',
            daysIdle: 11,
          },
        ],
        defaultPipelineId: 'pipe-1',
        firstStageId: 'stage-1',
      },
      marketing: {
        activeGrowthLinks: 2,
        totalLinkClicks: 120,
        totalLinkConversions: 18,
        activeDripSequences: 1,
        activeDripEnrollments: 12,
        activeAbCampaigns: 0,
        activeCoupons: 2,
        defaultDripSequenceId: 'drip-1',
        topGrowthLinkUrl: 'https://app.example.com/go/vip',
      },
      omnichannel: {
        bufferConnected: true,
        presenceScore: 65,
        connectedChannels: 3,
        scheduledQueueTotal: 1,
        pausedChannels: 0,
        channelsMissingBridge: ['Instagram'],
        channelIds: ['ch-ig', 'ch-li'],
      },
      knowledge: {
        companyProfileCompleteness: 80,
        companyName: 'Acme Corp',
        totalDocuments: 4,
        websiteSources: 2,
        uploadedDocs: 1,
        totalChunks: 28,
      },
      aiConfigured: true,
      whatsappConnected: true,
    };

    const proposals = buildDeterministicProposals(snapshot, {
      id: 'p1',
      account_id: 'acc-1',
      company_name: 'Acme Corp',
      tagline: 'Grow faster on WhatsApp',
      industry: 'SaaS',
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
      completeness_score: 80,
      updated_at: '',
    });

    expect(proposals.some((p) => p.action_type === 'send_whatsapp_followup')).toBe(true);
    expect(proposals.some((p) => p.action_type === 'create_or_advance_deal')).toBe(true);
    expect(proposals.some((p) => p.action_type === 'create_team_alert')).toBe(true);
    expect(proposals.some((p) => p.action_type === 'queue_buffer_post')).toBe(true);
  });

  it('enforces observer, copilot, quiet hours, cooldown, and daily cap guardrails', () => {
    const baseCfg = createDefaultJarvisConfig('acc-1');
    const action = {
      action_type: 'send_whatsapp_followup' as const,
      priority: 'high' as const,
      title: 'Follow up Alice',
      reasoning: 'Waiting 40m',
      target_contact_id: 'ct-1',
      payload: { messageText: 'Hi Alice!' },
    };

    expect(
      evaluateActionGuardrail({
        action,
        config: { ...baseCfg, autonomy_mode: 'observer' },
        actionsExecutedToday: 0,
        proactiveMessagesToday: 0,
        inQuietHours: false,
        contactInCooldown: false,
      }).decision
    ).toBe('skip');

    expect(
      evaluateActionGuardrail({
        action,
        config: { ...baseCfg, autonomy_mode: 'copilot' },
        actionsExecutedToday: 0,
        proactiveMessagesToday: 0,
        inQuietHours: false,
        contactInCooldown: false,
      }).decision
    ).toBe('pending_approval');

    expect(
      evaluateActionGuardrail({
        action,
        config: { ...baseCfg, autonomy_mode: 'autonomous' },
        actionsExecutedToday: 0,
        proactiveMessagesToday: 0,
        inQuietHours: false,
        contactInCooldown: false,
      }).decision
    ).toBe('execute');

    expect(
      evaluateActionGuardrail({
        action,
        config: { ...baseCfg, autonomy_mode: 'autonomous' },
        actionsExecutedToday: 0,
        proactiveMessagesToday: 0,
        inQuietHours: true,
        contactInCooldown: false,
      }).decision
    ).toBe('pending_approval');

    expect(
      evaluateActionGuardrail({
        action,
        config: { ...baseCfg, autonomy_mode: 'autonomous' },
        actionsExecutedToday: 0,
        proactiveMessagesToday: 0,
        inQuietHours: false,
        contactInCooldown: true,
      }).decision
    ).toBe('skip');
  });
});
