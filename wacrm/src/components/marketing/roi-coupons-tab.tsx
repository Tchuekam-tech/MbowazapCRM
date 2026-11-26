'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  TicketPercent,
  Plus,
  Trash2,
  Copy,
  Check,
  TrendingUp,
  Activity,
  Server,
  Database,
  Bot,
  RefreshCw,
  Clock,
  DollarSign,
  Loader2,
} from 'lucide-react';
import type { MarketingAnalyticsSnapshot, PromoCoupon } from '@/types';
import { formatCurrency } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface SystemHealthSnapshot {
  status: 'optimal' | 'degraded' | 'incident';
  checkedAt: string;
  crm: {
    uptimeSeconds: number;
    memoryMb: { rss: number; heapUsed: number; heapTotal: number };
    cache: { size: number; hitRate: number; coalesced: number };
  };
  database: {
    ok: boolean;
    latencyMs: number;
    error: string | null;
  };
  bot: {
    configured: boolean;
    reachable: boolean;
    latencyMs: number | null;
    metrics: {
      uptimeSeconds: number;
      memoryMb: { rss: number; heapUsed: number };
      eventLoopLagMs: { mean: number; p95: number; max: number };
      activeSockets: number;
      connectedSockets: number;
      outboxPendingBatches: number;
    } | null;
    error: string | null;
  };
}

interface RoiCouponsTabProps {
  analytics: MarketingAnalyticsSnapshot | null;
  coupons: PromoCoupon[];
  systemHealth: SystemHealthSnapshot | null;
  currency: string;
  canEdit: boolean;
  onRefresh: () => void;
  onRefreshHealth: () => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BLOCK_SHORT = ['0-4h', '4-8h', '8-12h', '12-16h', '16-20h', '20-24h'];

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec % 60}s`;
}

export function RoiCouponsTab({
  analytics,
  coupons,
  systemHealth,
  currency,
  canEdit,
  onRefresh,
  onRefreshHealth,
}: RoiCouponsTabProps) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('20');
  const [maxUses, setMaxUses] = useState('100');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [redeemValues, setRedeemValues] = useState<Record<string, string>>({});
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  async function handleCreateCoupon(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !title.trim()) {
      toast.error('Enter promo code and title.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/marketing/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          title,
          discount_type: discountType,
          discount_value: Number(discountValue),
          currency,
          max_uses: maxUses ? Number(maxUses) : null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Promo coupon ${data.coupon.code} created!`);
      setCode('');
      setTitle('');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create coupon');
    } finally {
      setCreating(false);
    }
  }

  async function handleRedeem(coupon: PromoCoupon) {
    const orderVal = Number(redeemValues[coupon.id] ?? 0);
    if (!Number.isFinite(orderVal) || orderVal <= 0) {
      toast.error('Enter an order value > 0 to log a redemption.');
      return;
    }
    setRedeemingId(coupon.id);
    try {
      const res = await fetch('/api/marketing/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'redeem',
          coupon_id: coupon.id,
          order_value: orderVal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        `Redeemed ${coupon.code}! Attributed ${formatCurrency(data.netRevenue, coupon.currency)} net revenue.`
      );
      setRedeemValues((prev) => ({ ...prev, [coupon.id]: '' }));
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Redemption failed');
    } finally {
      setRedeemingId(null);
    }
  }

  async function handleDeleteCoupon(id: string) {
    try {
      const res = await fetch(`/api/marketing/coupons?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      toast.success('Coupon removed');
      onRefresh();
    } catch {
      toast.error('Failed to delete coupon');
    }
  }

  const funnel = analytics?.funnel ?? {
    clicks: 0,
    leads: 0,
    replied: 0,
    hotLeads: 0,
    redemptions: 0,
    wonRevenue: 0,
  };

  return (
    <div className="space-y-6">
      {/* Funnel Strip */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              End-to-End WhatsApp Marketing ROI Funnel
            </h2>
          </div>
          {analytics?.bestSendWindow && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Clock className="h-3.5 w-3.5" />
              Best Send Window: {analytics.bestSendWindow.dayName} {analytics.bestSendWindow.hourRange} UTC
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Link Clicks', value: funnel.clicks.toLocaleString() },
            { label: 'Total Leads', value: funnel.leads.toLocaleString() },
            { label: 'Engaged Replies', value: funnel.replied.toLocaleString() },
            { label: 'Hot Leads (70+)', value: funnel.hotLeads.toLocaleString() },
            { label: 'Coupon Uses', value: funnel.redemptions.toLocaleString() },
            {
              label: 'Attributed Revenue',
              value: formatCurrency(funnel.wonRevenue, currency),
              highlight: true,
            },
          ].map((stage) => (
            <div
              key={stage.label}
              className={`rounded-lg border p-3 ${
                stage.highlight
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-border bg-muted/30'
              }`}
            >
              <p className="text-[11px] text-muted-foreground">{stage.label}</p>
              <p
                className={`mt-1 text-lg font-bold tabular-nums ${
                  stage.highlight ? 'text-primary' : 'text-foreground'
                }`}
              >
                {stage.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Channel Attribution + Optimal Send-Time Heatmap */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-5">
          <h3 className="text-sm font-semibold text-foreground">
            Channel Attribution & UTM ROI
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Performance across Instagram, TikTok, Ads, QR Flyers, and Organic WhatsApp.
          </p>
          <div className="mt-4 space-y-2.5">
            {(analytics?.channelBreakdown ?? []).length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Create Growth Links to track channel-by-channel ROI.
              </p>
            ) : (
              analytics!.channelBreakdown.map((ch) => (
                <div
                  key={ch.source}
                  className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs"
                >
                  <div>
                    <p className="font-semibold capitalize text-foreground">
                      {ch.source.replace(/_/g, ' ')}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {ch.clicks} clicks · {ch.leads} leads · {ch.conversions} conversions
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums text-primary">
                    {formatCurrency(ch.revenue, currency)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-7">
          <h3 className="text-sm font-semibold text-foreground">
            Optimal Send-Time Heatmap (30-Day Customer Replies, UTC)
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Brighter cells indicate peak customer responsiveness — schedule broadcasts & drips here for maximum reply rate.
          </p>
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[420px] space-y-1.5">
              <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] text-muted-foreground">
                <div />
                {BLOCK_SHORT.map((b) => (
                  <div key={b}>{b}</div>
                ))}
              </div>
              {DAY_LABELS.map((dayName, dayIdx) => (
                <div key={dayName} className="grid grid-cols-7 items-center gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {dayName}
                  </span>
                  {BLOCK_SHORT.map((_, blockIdx) => {
                    const cell = analytics?.sendTimeHeatmap.find(
                      (c) => c.day === dayIdx && c.hourBlock === blockIdx
                    );
                    const score = cell?.score ?? 0;
                    const bgClass =
                      score >= 75
                        ? 'bg-primary text-primary-foreground'
                        : score >= 45
                          ? 'bg-primary/60 text-foreground'
                          : score >= 15
                            ? 'bg-primary/25 text-foreground'
                            : 'bg-muted/60 text-muted-foreground';
                    return (
                      <div
                        key={blockIdx}
                        title={cell ? `${cell.label}: ${cell.replies} customer replies` : ''}
                        className={`flex h-7 items-center justify-center rounded text-[10px] font-medium tabular-nums ${bgClass}`}
                      >
                        {cell?.replies || '·'}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
