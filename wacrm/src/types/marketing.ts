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

