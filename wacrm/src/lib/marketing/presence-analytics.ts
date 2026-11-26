// ============================================================
// Unified Omnichannel Digital Presence Analytics & AI Audit
//
// Combines ALL connected Buffer social channels + post metrics
// with MboWazapCRM WhatsApp Growth Links, Contacts, and Revenue
// to give marketers a 360° command view of their entire online
// digital presence.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BufferChannelRow,
  BufferIntegrationPublic,
  BufferOrganizationSummary,
  BufferPostRow,
  ChannelBridgeMetric,
  DigitalPresenceAudit,
  DigitalPresenceRecommendation,
  DigitalPresenceReport,
  GrowthLink,
} from '@/types/marketing';
import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';
import { serverCache } from '@/lib/server/cache';

/**
 * Maps any UTM source label (e.g. `facebook_ads`, `ig`, `x`, `yt`) to
 * Buffer's canonical service identifier so cross-channel attribution
 * automatically bridges social activity to WhatsApp CRM revenue.
 */
export function canonicalSocialService(raw: string | null | undefined): string {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return 'direct';
  if (s.includes('insta') || s === 'ig') return 'instagram';
  if (s.includes('face') || s === 'fb') return 'facebook';
  if (s.includes('link') || s === 'li') return 'linkedin';
  if (s.includes('twit') || s === 'x' || s === 'x_ads') return 'twitter';
  if (s.includes('tik')) return 'tiktok';
  if (s.includes('you') || s === 'yt') return 'youtube';
  if (s.includes('thread')) return 'threads';
  if (s.includes('pin')) return 'pinterest';
  if (s.includes('blue') || s === 'bsky') return 'bluesky';
  if (s.includes('mast')) return 'mastodon';
  if (s.includes('google') || s === 'gbp') return 'googlebusiness';
  return s;
}

export interface PresenceComputationInput {
  integration: BufferIntegrationPublic | null;
  channels: BufferChannelRow[];
  posts: BufferPostRow[];
  growthLinks: Pick<
    GrowthLink,
    'slug' | 'utm_source' | 'clicks_count' | 'conversions_count' | 'attributed_revenue' | 'is_active'
  >[];
  attributedContacts: Array<{ utm_source: string | null }>;
  wonDealsRevenue: number;
  nowMs?: number;
}

/**
 * Pure deterministic calculation of the holistic 0–100 Digital Presence
 * Score, cross-channel WhatsApp conversion bridge, top posts, queue
 * status, and prioritized growth recommendations.
 */
export function computeDigitalPresenceReport(
  input: PresenceComputationInput
): DigitalPresenceReport {
  const { integration, channels, posts, growthLinks, attributedContacts } = input;
  const now = input.nowMs ?? Date.now();
  const thirtyDaysAgo = now - 30 * 86_400_000;

  // Roll up WhatsApp Growth Link + Contact attribution by canonical service
  const waByService = new Map<
    string,
    { clicks: number; leads: number; revenue: number; hasLink: boolean }
  >();
  const ensureWa = (svc: string) => {
    let row = waByService.get(svc);
    if (!row) {
      row = { clicks: 0, leads: 0, revenue: 0, hasLink: false };
      waByService.set(svc, row);
    }
    return row;
  };

  for (const link of growthLinks) {
    const svc = canonicalSocialService(link.utm_source);
    const row = ensureWa(svc);
    if (link.is_active) row.hasLink = true;
    row.clicks += Number(link.clicks_count ?? 0);
    row.leads += Number(link.conversions_count ?? 0);
    row.revenue += Number(link.attributed_revenue ?? 0);
  }
  for (const c of attributedContacts) {
    if (!c.utm_source) continue;
    const svc = canonicalSocialService(c.utm_source);
    const row = ensureWa(svc);
    row.leads = Math.max(row.leads, row.leads + 1);
  }

  // Compute per-channel bridge metrics
  const channelMetrics: ChannelBridgeMetric[] = channels.map((ch) => {
    const svc = canonicalSocialService(ch.service);
    const wa = waByService.get(svc);
    const hasBridge = Boolean(wa?.hasLink);

    let healthStatus: ChannelBridgeMetric['healthStatus'] = 'thriving';
    if (ch.is_queue_paused) {
      healthStatus = 'paused';
    } else if (!hasBridge && (ch.sent_posts_count > 0 || ch.total_engagements > 0)) {
      healthStatus = 'needs_bridge';
    } else if (ch.scheduled_posts_count === 0) {
      healthStatus = 'low_queue';
    }

    return {
      channelId: ch.buffer_channel_id,
      service: svc,
      name: ch.display_name || ch.name,
      avatarUrl: ch.avatar_url,
      isQueuePaused: ch.is_queue_paused,
      sentPosts: Number(ch.sent_posts_count ?? 0),
      scheduledPosts: Number(ch.scheduled_posts_count ?? 0),
      impressions: Number(ch.total_impressions ?? 0),
      reach: Number(ch.total_reach ?? 0),
      engagements: Number(ch.total_engagements ?? 0),
      engagementRate: Number(ch.engagement_rate ?? 0),
      whatsappLinkClicks: wa?.clicks ?? 0,
      whatsappLeads: wa?.leads ?? 0,
      whatsappRevenue: wa?.revenue ?? 0,
      hasGrowthLinkBridge: hasBridge,
      healthStatus,
    };
  });
