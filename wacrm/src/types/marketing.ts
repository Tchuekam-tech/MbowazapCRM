// ============================================================
// MboWazap Marketing Growth Suite Types (Migration 049)
// ============================================================

export type LeadTier = 'hot' | 'warm' | 'cold';

export interface GrowthLink {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  slug: string;
  destination_phone: string;
  prefill_message: string;
  ref_code: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  auto_tag_id: string | null;
  clicks_count: number;
  unique_clicks_count: number;
  conversions_count: number;
  attributed_revenue: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadSignal {
  label: string;
  points: number;
  category: 'engagement' | 'intent' | 'recency' | 'deal' | 'attribution' | 'risk';
}

export interface ContactLeadScore {
  contact_id: string;
  account_id: string;
  score: number;
  tier: LeadTier;
  intent_label: string | null;
  signals: LeadSignal[];
  ai_summary: string | null;
  next_best_action: string | null;
  last_message_at: string | null;
  computed_at: string;
  updated_at: string;
  contact?: {
    id: string;
    name: string | null;
    phone: string;
    company: string | null;
    email: string | null;
    utm_source?: string | null;
    utm_campaign?: string | null;
  };
}

export interface SegmentRules {
  tiers?: LeadTier[];
  minScore?: number;
  maxScore?: number;
  tagIds?: string[];
  excludeTagIds?: string[];
  activeWithinDays?: number;
  inactiveDays?: number;
  hasOpenDeal?: boolean;
  minDealValue?: number;
  utmSource?: string;
  utmCampaign?: string;
  excludeOptedOut?: boolean;
}

export interface MarketingSegment {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  description: string | null;
  rules: SegmentRules;
  cached_count: number;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DripSequenceStatus = 'draft' | 'active' | 'paused';
export type DripStepMessageType = 'text' | 'template' | 'image';
export type DripEnrollmentStatus =
  | 'active'
  | 'completed'
  | 'replied'
  | 'exited'
  | 'failed'
  | 'paused';

export interface DripSequenceStep {
  id?: string;
  sequence_id?: string;
  step_order: number;
  delay_minutes: number;
  message_type: DripStepMessageType;
  content_text: string;
  media_url?: string | null;
  template_name?: string | null;
  template_language?: string | null;
  coupon_id?: string | null;
}

export interface DripSequence {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: DripSequenceStatus;
  segment_id: string | null;
  stop_on_reply: boolean;
  stop_on_tag_id: string | null;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
  enrolled_count: number;
  completed_count: number;
  replied_count: number;
  created_at: string;
  updated_at: string;
  steps?: DripSequenceStep[];
}

export type AbCampaignStatus =
  | 'draft'
  | 'running'
  | 'evaluating'
  | 'completed'
  | 'failed';

export type AbWinnerMetric = 'reply_rate' | 'read_rate' | 'conversion_rate';

export interface AbCampaignVariant {
  id: string;
  campaign_id: string;
  account_id: string;
  variant_key: 'A' | 'B';
  label: string;
  body_text: string;
  template_name: string | null;
  template_language: string | null;
  media_url: string | null;
  coupon_id: string | null;
  compliance_score: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  conversions_count: number;
  revenue_attributed: number;
}

export interface AbCampaign {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  goal: string;
  segment_id: string | null;
  status: AbCampaignStatus;
  split_ratio: number;
  holdout_percent: number;
  winner_variant: 'A' | 'B' | null;
  winner_metric: AbWinnerMetric;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  variants?: AbCampaignVariant[];
}

export interface PromoCoupon {
  id: string;
  account_id: string;
  user_id: string;
  code: string;
  title: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  currency: string;
  min_order_value: number;
  max_uses: number | null;
  uses_count: number;
  attributed_revenue: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketingAnalyticsSnapshot {
  funnel: {
    clicks: number;
    leads: number;
    replied: number;
    hotLeads: number;
    redemptions: number;
    wonRevenue: number;
  };
  channelBreakdown: Array<{
    source: string;
    clicks: number;
    leads: number;
    conversions: number;
    revenue: number;
  }>;
  sendTimeHeatmap: Array<{
    day: number; // 0 = Mon .. 6 = Sun
    hourBlock: number; // 0..5 (4-hour blocks: 0-4, 4-8, 8-12, 12-16, 16-20, 20-24)
    label: string;
    replies: number;
    score: number; // 0..100 normalized intensity
  }>;
  bestSendWindow: {
    dayName: string;
    hourRange: string;
    replyCount: number;
  } | null;
  summary: {
    activeLinks: number;
    activeSequences: number;
    runningExperiments: number;
    activeCoupons: number;
    totalCouponRevenue: number;
    avgLeadScore: number;
    hotLeadCount: number;
  };
}

// ============================================================
// Buffer Omnichannel Digital Presence Types (Migration 051)
// ============================================================

export interface BufferOrganizationSummary {
  id: string;
  name: string;
  ownerEmail?: string | null;
}

export interface BufferIntegrationPublic {
  id: string;
  account_id: string;
  buffer_account_id: string | null;
  buffer_account_email: string | null;
  buffer_account_name: string | null;
  organization_id: string;
  organization_name: string | null;
  organizations: BufferOrganizationSummary[];
  status: 'connected' | 'error' | 'disconnected';
  insights_available: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  ai_audit_summary: DigitalPresenceAudit | null;
  ai_audit_at: string | null;
}

export interface BufferChannelRow {
  id: string;
  account_id: string;
  buffer_channel_id: string;
  organization_id: string;
  service: string;
  name: string;
  display_name: string | null;
  avatar_url: string | null;
  is_queue_paused: boolean;
  sent_posts_count: number;
  scheduled_posts_count: number;
  total_impressions: number;
  total_reach: number;
  total_engagements: number;
  total_clicks: number;
  engagement_rate: number;
  last_post_at: string | null;
  synced_at: string;
}

