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
