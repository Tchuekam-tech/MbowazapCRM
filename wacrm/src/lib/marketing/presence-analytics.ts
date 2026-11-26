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
