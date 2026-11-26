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
