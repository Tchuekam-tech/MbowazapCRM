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

export function LeadSegmentsTab({
  leads,
  segments,
  tags,
  canEdit,
  onRefresh,
}: LeadSegmentsTabProps) {
  const [tierFilter, setTierFilter] = useState<'all' | LeadTier>('all');
  const [recomputing, setRecomputing] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  // Segment Builder state
  const [segName, setSegName] = useState('');
  const [segTiers, setSegTiers] = useState<LeadTier[]>(['hot']);
  const [minScore, setMinScore] = useState('');
  const [inactiveDays, setInactiveDays] = useState('');
  const [activeWithinDays, setActiveWithinDays] = useState('');
  const [selectedTagId, setSelectedTagId] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [savingSeg, setSavingSeg] = useState(false);

  const filteredLeads =
    tierFilter === 'all' ? leads : leads.filter((l) => l.tier === tierFilter);

  function buildRules(): SegmentRules {
    const rules: SegmentRules = { excludeOptedOut: true };
    if (segTiers.length > 0) rules.tiers = segTiers;
    if (minScore.trim()) rules.minScore = Number(minScore);
    if (inactiveDays.trim()) rules.inactiveDays = Number(inactiveDays);
    if (activeWithinDays.trim()) rules.activeWithinDays = Number(activeWithinDays);
    if (selectedTagId) rules.tagIds = [selectedTagId];
    if (utmSource.trim()) rules.utmSource = utmSource.trim();
    return rules;
  }

  async function handleRecomputeAll() {
    setRecomputing(true);
    try {
      const res = await fetch('/api/marketing/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recompute' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Scored ${data.updated ?? 0} contacts in real time!`);
      onRefresh();
    } catch {
      toast.error('Failed to recompute lead scores');
    } finally {
      setRecomputing(false);
    }
  }

