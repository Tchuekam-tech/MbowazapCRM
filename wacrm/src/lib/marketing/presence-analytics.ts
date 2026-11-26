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
