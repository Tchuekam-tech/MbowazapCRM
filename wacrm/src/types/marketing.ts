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
