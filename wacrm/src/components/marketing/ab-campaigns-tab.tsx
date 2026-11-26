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

  const lintA = useMemo(() => (bodyA.trim() ? lintWhatsAppCopy(bodyA) : null), [bodyA]);
  const lintB = useMemo(() => (bodyB.trim() ? lintWhatsAppCopy(bodyB) : null), [bodyB]);

  async function handleGenerateCopy() {
    if (!offer.trim()) {
      toast.error('Describe your offer or product first.');
      return;
    }
    setGenerating(true);
    try {
      const selectedCoupon = coupons.find((c) => c.id === couponId);
      const res = await fetch('/api/marketing/copywriter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal,
          offer,
          tone,
          language,
          coupon_code: selectedCoupon?.code ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLabelA(data.variantA.label);
      setBodyA(data.variantA.body);
      setLabelB(data.variantB.label);
      setBodyB(data.variantB.body);
      if (!name.trim()) setName(`${goal}: ${offer.slice(0, 32)}`);
      toast.success(
        data.usedAi
          ? 'AI generated 2 high-converting A/B variants!'
          : 'Generated 2 proven conversion variants (configure AI key in Settings for custom LLM copy).'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Copywriter failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreateCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !bodyA.trim() || !bodyB.trim()) {
      toast.error('Campaign name and both Variant A & B copy are required.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          goal,
          segment_id: segmentId || undefined,
          split_ratio: splitRatio,
          holdout_percent: holdoutPercent,
          winner_metric: 'reply_rate',
          variant_a: { label: labelA, body_text: bodyA, coupon_id: couponId || undefined },
