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

  // Totals across all connected social channels
  const activeServices = [...new Set(channelMetrics.map((c) => c.service))];
  const sentPosts30d = posts.filter((p) => {
    if (p.status === 'scheduled' || p.status === 'buffer') return false;
    const ts = p.sent_at || p.due_at;
    return !ts || Date.parse(ts) >= thirtyDaysAgo;
  }).length;
  const scheduledQueueTotal = channelMetrics.reduce((s, c) => s + c.scheduledPosts, 0);
  const totalImpressions = channelMetrics.reduce((s, c) => s + c.impressions, 0);
  const totalReach = channelMetrics.reduce((s, c) => s + c.reach, 0);
  const totalEngagements = channelMetrics.reduce((s, c) => s + c.engagements, 0);
  const avgDenom = Math.max(totalImpressions, totalReach);
  const avgEngagementRate =
    avgDenom > 0 ? Math.round((totalEngagements / avgDenom) * 10000) / 100 : 0;

  let socialDrivenWaClicks = 0;
  let socialDrivenWaLeads = 0;
  let socialDrivenRevenue = 0;
  for (const svc of activeServices) {
    const wa = waByService.get(svc);
    if (wa) {
      socialDrivenWaClicks += wa.clicks;
      socialDrivenWaLeads += wa.leads;
      socialDrivenRevenue += wa.revenue;
    }
  }
  const postsWithGrowthLinks = posts.filter((p) => Boolean(p.linked_growth_slug)).length;

  // 4-Pillar Digital Presence Score (each 0..25 -> total 0..100)
  const activeUnpaused = channelMetrics.filter((c) => !c.isQueuePaused).length;
  const channelCoverage = Math.min(
    25,
    activeServices.length * 6 + (activeUnpaused > 0 ? 7 : 0)
  );
  const publishingConsistency = Math.min(
    25,
    Math.min(15, sentPosts30d * 2) + Math.min(10, scheduledQueueTotal * 2)
  );
  const audienceEngagement = Math.min(
    25,
    totalEngagements > 0
      ? Math.min(15, Math.round(Math.log10(totalEngagements + 1) * 5)) +
          Math.min(10, Math.round(avgEngagementRate * 2))
      : sentPosts30d > 0
        ? 6
        : 0
  );
  const bridgedChannels = channelMetrics.filter((c) => c.hasGrowthLinkBridge).length;
  const whatsappConversionBridge = Math.min(
    25,
    (channelMetrics.length > 0
      ? Math.round((bridgedChannels / channelMetrics.length) * 14)
      : 0) +
      Math.min(6, postsWithGrowthLinks * 2) +
      Math.min(5, socialDrivenWaLeads)
  );

  const presenceScore = integration
    ? Math.max(
        0,
        Math.min(
          100,
          channelCoverage +
            publishingConsistency +
            audienceEngagement +
            whatsappConversionBridge
        )
      )
    : 0;

  // Top performing sent posts & upcoming scheduled queue
  const topPosts = [...posts]
    .filter((p) => p.status !== 'scheduled' && p.status !== 'buffer')
    .sort(
      (a, b) =>
        b.total_engagements - a.total_engagements ||
        b.impressions - a.impressions ||
        (b.sent_at || '').localeCompare(a.sent_at || '')
    )
    .slice(0, 8);

  const upcomingQueue = [...posts]
    .filter((p) => p.status === 'scheduled' || p.status === 'buffer')
    .sort((a, b) => (a.due_at || '').localeCompare(b.due_at || ''))
    .slice(0, 8);

  // Actionable Cross-Channel Recommendations
  const recommendations: DigitalPresenceRecommendation[] = [];

  for (const ch of channelMetrics) {
    if (ch.isQueuePaused) {
      recommendations.push({
        priority: 'high',
        title: `Resume paused ${ch.service} queue (${ch.name})`,
        detail: `Your Buffer queue for ${ch.name} is paused. Resuming keeps organic reach and inbound WhatsApp discovery active.`,
        channel: ch.service,
        actionType: 'resume_queue',
      });
    } else if (!ch.hasGrowthLinkBridge) {
      recommendations.push({
        priority: 'high',
        title: `Bridge ${ch.service} traffic to WhatsApp`,
        detail: `${ch.name} has ${ch.sentPosts} synced post(s) but no tracked MboWazap /go/ link for "${ch.service}". Create one and drop it into your bio & next Buffer post to capture leads directly in WhatsApp.`,
        channel: ch.service,
        actionType: 'create_growth_link',
      });
    } else if (ch.scheduledPosts === 0) {
      recommendations.push({
        priority: 'medium',
        title: `Refill empty queue on ${ch.name}`,
        detail: `No upcoming posts are scheduled on ${ch.service}. Queue a Growth-Link promo post below to stay visible this week.`,
        channel: ch.service,
        actionType: 'publish_post',
      });
    }
  }

  if (topPosts.length > 0 && topPosts[0]!.total_engagements > 0) {
    recommendations.push({
      priority: 'medium',
      title: `Repurpose your top ${topPosts[0]!.service} post into a WhatsApp A/B Campaign`,
      detail: `Your #1 post earned ${topPosts[0]!.total_engagements.toLocaleString()} engagements — reuse that proven hook for Warm/Hot WhatsApp leads in the A/B Studio.`,
      channel: topPosts[0]!.service,
      actionType: 'launch_ab_test',
    });
  }
