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

