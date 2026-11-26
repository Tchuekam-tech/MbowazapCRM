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

  it('penalizes opted-out contacts to Cold and advises compliance', () => {
    const res = computeLeadScore({
      inboundMessageCount: 2,
      outboundMessageCount: 2,
      recentCustomerTexts: ['STOP'],
      lastMessageAt: '2026-11-26T11:00:00Z',
      openDealsCount: 0,
      openDealsValue: 0,
      wonDealsCount: 0,
      tagNames: ['Opted Out'],
      hasGrowthAttribution: false,
      nowMs,
    });
    expect(res.tier).toBe('cold');
    expect(res.intentLabel).toBe('Opted Out');
    expect(res.nextBestAction.toLowerCase()).toContain('opt-out');
  });

  it('evaluates Smart Segment rules accurately including opt-out protection', () => {
    const hotLead = {
      id: 'c1',
      utm_source: 'instagram',
      utm_campaign: 'bf26',
      tagIds: ['t1'],
      tagNames: ['VIP'],
      score: 84,
      tier: 'hot' as const,
      lastMessageAt: '2026-11-25T12:00:00Z',
      openDealsCount: 1,
      openDealsValue: 500,
    };
    expect(
      matchesSegmentRules(
        hotLead,
        { tiers: ['hot'], minScore: 70, utmSource: 'instagram', activeWithinDays: 7 },
        nowMs
      )
    ).toBe(true);
    expect(
      matchesSegmentRules(hotLead, { inactiveDays: 14 }, nowMs)
    ).toBe(false);
    expect(
      matchesSegmentRules({ ...hotLead, tagNames: ['Opted Out'] }, { tiers: ['hot'] }, nowMs)
    ).toBe(false);
  });
});

describe('Feature 3: Drip Quiet Hours Scheduler', () => {
  it('detects midnight-wrapping quiet hours and shifts sends to quietEnd', () => {
    const lateNight = new Date('2026-11-26T23:30:00Z');
    expect(isWithinQuietHours(lateNight, '21:00', '08:00', 'UTC')).toBe(true);
    const shifted = nextAllowedSendTime(lateNight, '21:00', '08:00', 'UTC');
    expect(shifted.toISOString()).toBe('2026-11-27T08:00:00.000Z');

    const daytime = new Date('2026-11-26T14:15:00Z');
    expect(isWithinQuietHours(daytime, '21:00', '08:00', 'UTC')).toBe(false);
    expect(nextAllowedSendTime(daytime, '21:00', '08:00', 'UTC').toISOString()).toBe(
      daytime.toISOString()
    );
  });
});

describe('Feature 4: Copywriter Compliance Linter & A/B Winner Evaluator', () => {
  it('grades personalized clean copy as A and flags ALL CAPS spammy copy', () => {
    const clean = lintWhatsAppCopy(
      'Hi {{first_name}} 👋 Quick update — your VIP offer is live today. Reply YES to claim it.'
    );
    expect(clean.grade).toBe('A');
    expect(clean.score).toBeGreaterThanOrEqual(90);

    const spam = lintWhatsAppCopy(
      'ACT NOW!!!! 100% FREE GUARANTEED MONEY CLICK HERE IMMEDIATELY https://bit.ly/spam'
    );
    expect(spam.grade).toBe('D');
    expect(spam.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('interpolates contact fields and coupon codes', () => {
    expect(
      renderPersonalizedCopy(
        'Hey {{first_name}} at {{company}}, use {{coupon}}!',
        { name: 'Marie Claire', company: 'Maison Belle' },
        'VIP20'
      )
    ).toBe('Hey Marie at Maison Belle, use VIP20!');
  });

  it('picks the winning variant with lift and confidence', () => {
    const verdict = evaluateAbWinner(
      { sent_count: 50, read_count: 40, replied_count: 15, conversions_count: 5 },
      { sent_count: 50, read_count: 35, replied_count: 6, conversions_count: 2 },
      'reply_rate'
    );
    expect(verdict.winner).toBe('A');
    expect(verdict.rateA).toBe(30);
    expect(verdict.rateB).toBe(12);
    expect(verdict.liftPercent).toBe(150);
    expect(verdict.confidence).toBe('high');
  });
});

describe('Feature 5: Optimal Send-Time Heatmap', () => {
  it('identifies the peak customer reply window across 7x6 blocks', () => {
    const { heatmap, bestSendWindow } = buildSendTimeHeatmap([
      '2026-11-26T17:10:00Z', // Thu 16:00-20:00
      '2026-11-26T18:20:00Z', // Thu 16:00-20:00
      '2026-11-26T19:05:00Z', // Thu 16:00-20:00
      '2026-11-25T09:00:00Z', // Wed 08:00-12:00
    ]);
    expect(heatmap).toHaveLength(42);
    expect(bestSendWindow).toEqual({
      dayName: 'Thu',
      hourRange: '16:00–20:00',
      replyCount: 3,
    });
  });
});
