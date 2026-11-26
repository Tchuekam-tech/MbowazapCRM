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

