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

  let maxReplies = 0;
  for (const v of counts.values()) {
    if (v > maxReplies) maxReplies = v;
  }

  const heatmap: MarketingAnalyticsSnapshot['sendTimeHeatmap'] = [];
  let best: MarketingAnalyticsSnapshot['bestSendWindow'] = null;

  for (let day = 0; day < 7; day++) {
    for (let block = 0; block < 6; block++) {
      const replies = counts.get(`${day}:${block}`) ?? 0;
      const score = maxReplies > 0 ? Math.round((replies / maxReplies) * 100) : 0;
      heatmap.push({
        day,
        hourBlock: block,
        label: `${DAY_NAMES[day]} ${BLOCK_LABELS[block]}`,
        replies,
        score,
      });
      if (replies > 0 && (!best || replies > best.replyCount)) {
        best = {
          dayName: DAY_NAMES[day]!,
          hourRange: BLOCK_LABELS[block]!,
          replyCount: replies,
        };
      }
    }
  }

  return { heatmap, bestSendWindow: best };
}

export async function loadMarketingAnalytics(
  db: SupabaseClient,
  accountId: string
): Promise<MarketingAnalyticsSnapshot> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    linksRes,
    scoresRes,
    sequencesRes,
    campaignsRes,
    couponsRes,
    wonDealsRes,
    contactsRes,
    customerMsgsRes,
  ] = await Promise.all([
    db
      .from('growth_links')
      .select('utm_source, clicks_count, conversions_count, attributed_revenue, is_active')
      .eq('account_id', accountId),
    db
      .from('contact_lead_scores')
      .select('score, tier')
      .eq('account_id', accountId),
    db
      .from('drip_sequences')
      .select('status, replied_count')
      .eq('account_id', accountId),
    db
      .from('ab_campaigns')
      .select('status')
      .eq('account_id', accountId),
    db
      .from('promo_coupons')
      .select('uses_count, attributed_revenue, is_active')
      .eq('account_id', accountId),
    db
      .from('deals')
      .select('value')
      .eq('account_id', accountId)
      .eq('status', 'won'),
    db
      .from('contacts')
      .select('utm_source')
      .eq('account_id', accountId),
    db
      .from('messages')
      .select('created_at, conversations!inner(account_id)')
      .eq('conversations.account_id', accountId)
      .eq('sender_type', 'customer')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  const links = (linksRes.data ?? []) as Array<{
    utm_source: string | null;
    clicks_count: number;
    conversions_count: number;
    attributed_revenue: number;
    is_active: boolean;
  }>;
  const scores = (scoresRes.data ?? []) as Array<{ score: number; tier: string }>;
  const sequences = (sequencesRes.data ?? []) as Array<{ status: string; replied_count: number }>;
  const campaigns = (campaignsRes.data ?? []) as Array<{ status: string }>;
  const coupons = (couponsRes.data ?? []) as Array<{
    uses_count: number;
    attributed_revenue: number;
    is_active: boolean;
  }>;
  const wonDeals = (wonDealsRes.data ?? []) as Array<{ value: number | null }>;
  const contacts = (contactsRes.data ?? []) as Array<{ utm_source: string | null }>;

  const totalClicks = links.reduce((s, l) => s + Number(l.clicks_count ?? 0), 0);
  const totalLeads = contacts.length;
  const hotLeadCount = scores.filter((s) => s.tier === 'hot').length;
  const avgLeadScore =
    scores.length > 0
      ? Math.round(scores.reduce((s, r) => s + Number(r.score ?? 0), 0) / scores.length)
      : 0;
  const totalRedemptions = coupons.reduce((s, c) => s + Number(c.uses_count ?? 0), 0);
  const totalCouponRevenue = coupons.reduce((s, c) => s + Number(c.attributed_revenue ?? 0), 0);
  const wonRevenue = wonDeals.reduce((s, d) => s + Number(d.value ?? 0), 0);
  const seqReplies = sequences.reduce((s, q) => s + Number(q.replied_count ?? 0), 0);
  const customerTimestamps = ((customerMsgsRes.data ?? []) as Array<{ created_at: string }>).map(
    (m) => m.created_at
  );

  // Channel attribution rollup
  const channelMap = new Map<
    string,
    { clicks: number; leads: number; conversions: number; revenue: number }
  >();
  const ensureChannel = (raw: string | null) => {
    const key = (raw || 'direct').trim().toLowerCase() || 'direct';
    let row = channelMap.get(key);
    if (!row) {
      row = { clicks: 0, leads: 0, conversions: 0, revenue: 0 };
      channelMap.set(key, row);
    }
    return row;
  };

  for (const l of links) {
    const ch = ensureChannel(l.utm_source || 'growth-link');
    ch.clicks += Number(l.clicks_count ?? 0);
    ch.conversions += Number(l.conversions_count ?? 0);
    ch.revenue += Number(l.attributed_revenue ?? 0);
  }
  for (const c of contacts) {
    const ch = ensureChannel(c.utm_source || 'organic');
    ch.leads += 1;
  }

  const channelBreakdown = [...channelMap.entries()]
    .map(([source, stats]) => ({ source, ...stats }))
    .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads || b.clicks - a.clicks)
    .slice(0, 8);

  const { heatmap, bestSendWindow } = buildSendTimeHeatmap(customerTimestamps);

  return {
    funnel: {
      clicks: totalClicks,
      leads: totalLeads,
      replied: Math.max(seqReplies, customerTimestamps.length > 0 ? Math.min(totalLeads, customerTimestamps.length) : 0),
      hotLeads: hotLeadCount,
      redemptions: totalRedemptions,
      wonRevenue: Math.max(wonRevenue, totalCouponRevenue),
    },
    channelBreakdown,
    sendTimeHeatmap: heatmap,
    bestSendWindow,
    summary: {
      activeLinks: links.filter((l) => l.is_active).length,
      activeSequences: sequences.filter((s) => s.status === 'active').length,
      runningExperiments: campaigns.filter((c) => c.status === 'running' || c.status === 'evaluating').length,
      activeCoupons: coupons.filter((c) => c.is_active).length,
      totalCouponRevenue,
      avgLeadScore,
      hotLeadCount,
    },
  };
}
