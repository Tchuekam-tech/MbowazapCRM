// ============================================================
// Feature 5: Marketing Attribution, Revenue ROI & Optimal
// Send-Time Heatmap Analytics
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketingAnalyticsSnapshot } from '@/types/marketing';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const BLOCK_LABELS = [
  '00:00–04:00',
  '04:00–08:00',
  '08:00–12:00',
  '12:00–16:00',
  '16:00–20:00',
  '20:00–24:00',
] as const;

export function buildSendTimeHeatmap(
  customerMessageTimestamps: string[]
): {
  heatmap: MarketingAnalyticsSnapshot['sendTimeHeatmap'];
  bestSendWindow: MarketingAnalyticsSnapshot['bestSendWindow'];
} {
  const counts = new Map<string, number>();
  for (const iso of customerMessageTimestamps) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const day = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
    const block = Math.floor(d.getUTCHours() / 4); // 0..5
    const key = `${day}:${block}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
