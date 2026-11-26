'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Flame,
  Zap,
  Snowflake,
  Sparkles,
  RefreshCw,
  Filter,
  Plus,
  Trash2,
  Users,
  Loader2,
  Eye,
} from 'lucide-react';
import type {
  ContactLeadScore,
  LeadTier,
  MarketingSegment,
  SegmentRules,
  Tag,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LeadSegmentsTabProps {
  leads: ContactLeadScore[];
  segments: MarketingSegment[];
  tags: Tag[];
  canEdit: boolean;
  onRefresh: () => void;
}

const TIER_BADGE: Record<
  LeadTier,
  { label: string; icon: typeof Flame; classes: string }
> = {
  hot: {
    label: 'Hot',
    icon: Flame,
    classes: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
  },
  warm: {
    label: 'Warm',
    icon: Zap,
    classes: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  },
  cold: {
    label: 'Cold',
    icon: Snowflake,
    classes: 'border-sky-500/40 bg-sky-500/10 text-sky-400',
  },
};

