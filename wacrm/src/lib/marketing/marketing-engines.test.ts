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
