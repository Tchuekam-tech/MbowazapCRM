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
