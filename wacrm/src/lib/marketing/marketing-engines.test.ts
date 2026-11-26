import { describe, it, expect } from 'vitest';
import {
  buildWhatsAppRedirectUrl,
  encodeQrMatrix,
  extractGrowthRefCode,
  normalizeSlug,
  renderQrSvg,
  slugifyLinkName,
} from './qr-svg';
import { computeLeadScore, matchesSegmentRules } from './lead-scoring';
import {
  evaluateAbWinner,
  lintWhatsAppCopy,
  renderPersonalizedCopy,
} from './copywriter';
import { isWithinQuietHours, nextAllowedSendTime } from './drip-engine';
import { buildSendTimeHeatmap } from './analytics';

describe('Feature 1: Growth Links, Attribution & Pure SVG QR', () => {
  it('slugifies names and normalizes custom slugs cleanly', () => {
    expect(slugifyLinkName('Instagram Flash Sale 2026!')).toBe('instagram-flash-sale-2026');
    expect(normalizeSlug('  VIP_Offer / 2026  ')).toBe('vip_offer-2026');
  });

  it('builds tracked wa.me redirect URLs and extracts [Ref:CODE] on inbound', () => {
    const url = buildWhatsAppRedirectUrl('+237 653 683 174', 'Hello, interested!', 'IG99K');
    expect(url).toContain('https://wa.me/237653683174?text=');
    const decoded = decodeURIComponent(url.split('text=')[1]!);
    expect(decoded).toBe('Hello, interested! [Ref:IG99K]');
    expect(extractGrowthRefCode(decoded)).toBe('IG99K');
    expect(extractGrowthRefCode('Plain message without tag')).toBeNull();
  });

  it('generates valid ISO/IEC 18004 QR matrices & SVGs for short and long URLs', () => {
    const shortMatrix = encodeQrMatrix('https://app.example.com/go/vip');
    expect(shortMatrix.length).toBeGreaterThanOrEqual(21);
    expect(shortMatrix.length).toBe(shortMatrix[0]!.length);
    // Top-left finder pattern corner must be dark
    expect(shortMatrix[0]![0]).toBe(true);
    expect(shortMatrix[6]![6]).toBe(true);

    const svg = renderQrSvg('https://mbowazapcrm-production.up.railway.app/go/black-friday-2026');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('<path d="M');
    expect(svg).toMatch(/<\/svg>$/);
  });
});

describe('Feature 2: Behavioral Lead Scoring & Smart Segments', () => {
  const nowMs = Date.parse('2026-11-26T12:00:00Z');

  it('scores high-intent active buyers as Hot (70+)', () => {
    const res = computeLeadScore({
      inboundMessageCount: 6,
      outboundMessageCount: 4,
      recentCustomerTexts: ['Bonjour, quel est le prix du pack Business? Je veux commander aujourd hui'],
      lastMessageAt: '2026-11-26T10:00:00Z',
      openDealsCount: 1,
      openDealsValue: 900,
      wonDealsCount: 0,
      tagNames: ['Instagram Lead'],
      hasGrowthAttribution: true,
      nowMs,
    });
    expect(res.score).toBeGreaterThanOrEqual(75);
    expect(res.tier).toBe('hot');
    expect(res.signals.length).toBeGreaterThanOrEqual(4);
  });

