'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Globe,
  RefreshCw,
  Sparkles,
  Send,
  KeyRound,
  Unplug,
  CheckCircle2,
  AlertTriangle,
  PauseCircle,
  Link2,
  TicketPercent,
  BarChart3,
  Clock,
  ArrowUpRight,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import type {
  DigitalPresenceReport,
  GrowthLink,
  PromoCoupon,
} from '@/types';
import { formatCurrency } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
