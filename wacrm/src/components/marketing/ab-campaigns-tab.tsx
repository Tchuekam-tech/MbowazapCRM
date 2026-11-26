'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Sparkles,
  FlaskConical,
  Trophy,
  Send,
  ShieldCheck,
  AlertTriangle,
  Trash2,
  Loader2,
} from 'lucide-react';
import type { AbCampaign, MarketingSegment, PromoCoupon } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { lintWhatsAppCopy, type AbWinnerVerdict } from '@/lib/marketing/copywriter';

interface EnrichedAbCampaign extends AbCampaign {
  verdict?: AbWinnerVerdict | null;
}

interface AbCampaignsTabProps {
  campaigns: EnrichedAbCampaign[];
  segments: MarketingSegment[];
  coupons: PromoCoupon[];
  canEdit: boolean;
  onRefresh: () => void;
}

export function AbCampaignsTab({
  campaigns,
  segments,
  coupons,
  canEdit,
  onRefresh,
}: AbCampaignsTabProps) {
  // AI Copywriter state
  const [goal, setGoal] = useState('Flash Promotion');
  const [offer, setOffer] = useState('');
  const [tone, setTone] = useState('Friendly & Urgent');
  const [language, setLanguage] = useState('English');
  const [couponId, setCouponId] = useState('');
  const [generating, setGenerating] = useState(false);

  // Campaign Builder state
  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [splitRatio, setSplitRatio] = useState(50);
  const [holdoutPercent, setHoldoutPercent] = useState(40);
  const [labelA, setLabelA] = useState('Variant A — Hook');
  const [bodyA, setBodyA] = useState('');
  const [labelB, setLabelB] = useState('Variant B — Urgency');
  const [bodyB, setBodyB] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);
