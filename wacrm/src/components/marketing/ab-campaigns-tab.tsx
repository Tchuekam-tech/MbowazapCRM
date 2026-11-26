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
          variant_b: { label: labelB, body_text: bodyB, coupon_id: couponId || undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('A/B Split-Test Campaign saved as draft!');
      setName('');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setCreating(false);
    }
  }

  async function handleLaunch(campaignId: string) {
    setBusyCampaignId(campaignId);
    try {
      const res = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'launch', campaign_id: campaignId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        `Launched! Sent ${data.sentA} (A) & ${data.sentB} (B)${data.holdoutQueued ? `, ${data.holdoutQueued} reserved in holdout` : ''}.`
      );
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Launch failed');
    } finally {
      setBusyCampaignId(null);
    }
  }

  async function handlePromoteWinner(campaignId: string, winner?: 'A' | 'B') {
    setBusyCampaignId(campaignId);
    try {
      const res = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promote_winner',
          campaign_id: campaignId,
          winner,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        `Variant ${data.winner} declared winner & sent to ${data.sentHoldout} remaining contacts!`
      );
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not promote winner');
    } finally {
      setBusyCampaignId(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/marketing/campaigns?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      toast.success('Experiment deleted');
      onRefresh();
    } catch {
      toast.error('Failed to delete campaign');
    }
  }

  return (
    <div className="space-y-6">
      {/* AI Copywriter + A/B Builder */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* AI Copywriter Box */}
        <div className="space-y-4 rounded-xl border border-primary/30 bg-card p-5 lg:col-span-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                AI WhatsApp Copywriter
              </h2>
              <p className="text-xs text-muted-foreground">
                Generates high-reply A/B variants with automatic anti-spam compliance checks.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label className="text-xs">Campaign Goal</Label>
                <select
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                >
                  <option>Flash Promotion</option>
                  <option>Product Launch</option>
                  <option>Win-Back Dormant Leads</option>
                  <option>VIP Exclusive Offer</option>
                  <option>Abandoned Checkout</option>
                  <option>Event / Webinar Invite</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Language</Label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                >
                  <option>English</option>
                  <option>French</option>
                  <option>Spanish</option>
                  <option>Portuguese</option>
                  <option>Korean</option>
                </select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Product / Offer Details</Label>
              <Textarea
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                rows={3}
                placeholder="e.g. 25% off our Business WhatsApp Automation pack for the next 48 hours + free setup call"
                className="mt-1 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label className="text-xs">Tone</Label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                >
                  <option>Friendly & Urgent</option>
                  <option>Direct & Concise</option>
                  <option>Luxury & Exclusive</option>
                  <option>Consultative</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Inject Promo Code</Label>
                <select
                  value={couponId}
                  onChange={(e) => setCouponId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                >
                  <option value="">None</option>
                  {coupons.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} ({c.discount_type === 'percent' ? `${c.discount_value}%` : `${c.currency} ${c.discount_value}`})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button
              type="button"
              disabled={!canEdit || generating}
              onClick={handleGenerateCopy}
              className="w-full"
            >
              {generating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Generate Variant A & B Copy
            </Button>
          </div>
        </div>

        {/* A/B Split-Test Configuration */}
        <form
          onSubmit={handleCreateCampaign}
          className="space-y-4 rounded-xl border border-border bg-card p-5 lg:col-span-7"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FlaskConical className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                A/B Split-Test Experiment Setup
              </h2>
              <p className="text-xs text-muted-foreground">
                Test two hooks on a sample audience, then send the winner to the holdout group.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Experiment Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Weekend Flash Sale Hook Test"
                className="mt-1 text-xs"
                required
              />
            </div>
            <div>
              <Label className="text-xs">Target Segment</Label>
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
              >
                <option value="">All Contacts (up to 200)</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.cached_count})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-xs">
            <div>
              <Label className="text-[11px] text-muted-foreground">
                A/B Split Ratio ({splitRatio}% A / {100 - splitRatio}% B)
              </Label>
              <input
                type="range"
                min={20}
                max={80}
                step={10}
                value={splitRatio}
                onChange={(e) => setSplitRatio(Number(e.target.value))}
                className="mt-1 w-full accent-primary"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">
                Winner Holdout Pool ({holdoutPercent}% reserved)
              </Label>
              <input
                type="range"
                min={0}
                max={80}
                step={10}
                value={holdoutPercent}
                onChange={(e) => setHoldoutPercent(Number(e.target.value))}
                className="mt-1 w-full accent-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Variant A */}
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-primary">Variant A</span>
                {lintA && (
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      lintA.grade === 'A'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-amber-500/15 text-amber-400'
                    }`}
                  >
                    {lintA.grade === 'A' ? (
                      <ShieldCheck className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    Safe {lintA.score}%
                  </span>
                )}
              </div>
              <Textarea
                value={bodyA}
                onChange={(e) => setBodyA(e.target.value)}
                rows={4}
                placeholder="Variant A WhatsApp message..."
                className="text-xs"
                required
              />
              {lintA && lintA.warnings.length > 0 && (
                <p className="text-[10px] text-amber-400">{lintA.warnings[0]}</p>
              )}
            </div>

            {/* Variant B */}
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-400">Variant B</span>
                {lintB && (
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      lintB.grade === 'A'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-amber-500/15 text-amber-400'
                    }`}
                  >
                    {lintB.grade === 'A' ? (
                      <ShieldCheck className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    Safe {lintB.score}%
                  </span>
                )}
              </div>
              <Textarea
                value={bodyB}
                onChange={(e) => setBodyB(e.target.value)}
                rows={4}
                placeholder="Variant B WhatsApp message..."
                className="text-xs"
                required
              />
              {lintB && lintB.warnings.length > 0 && (
                <p className="text-[10px] text-amber-400">{lintB.warnings[0]}</p>
              )}
            </div>
          </div>

          <Button type="submit" disabled={!canEdit || creating} className="w-full">
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
            Create A/B Split-Test Campaign
          </Button>
        </form>
      </div>

      {/* Existing Experiments */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          A/B Split-Test Experiments ({campaigns.length})
        </h3>
        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
            No A/B experiments yet. Use the AI Copywriter above to generate and launch your first split test.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {campaigns.map((camp) => {
              const vA = camp.variants?.find((v) => v.variant_key === 'A');
              const vB = camp.variants?.find((v) => v.variant_key === 'B');
              const isBusy = busyCampaignId === camp.id;
              return (
                <div
                  key={camp.id}
                  className="space-y-3 rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">
                          {camp.name}
                        </h4>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          {camp.status}
                        </span>
                        {camp.winner_variant && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                            <Trophy className="h-3 w-3" /> Winner: {camp.winner_variant}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Split {camp.split_ratio}/{100 - camp.split_ratio} · Holdout {camp.holdout_percent}%
                      </p>
                    </div>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(camp.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    {[vA, vB].map((v) =>
                      v ? (
                        <div
                          key={v.id}
                          className={`rounded-lg border p-2.5 text-xs ${
                            camp.verdict?.winner === v.variant_key
                              ? 'border-primary/50 bg-primary/5'
                              : 'border-border bg-muted/30'
                          }`}
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span>Variant {v.variant_key}</span>
                            <span className="text-primary">
                              {v.sent_count > 0
                                ? `${Math.round((v.replied_count / v.sent_count) * 100)}% reply`
                                : '0%'}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                            {v.body_text}
                          </p>
                          <p className="mt-1.5 text-[10px] text-muted-foreground">
                            Sent {v.sent_count} · Replies {v.replied_count} · Safe {v.compliance_score}%
                          </p>
                        </div>
                      ) : null
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {camp.status === 'draft' && (
                      <Button
                        size="sm"
                        disabled={!canEdit || isBusy}
                        onClick={() => handleLaunch(camp.id)}
                      >
                        {isBusy ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Launch Split Test
                      </Button>
                    )}
                    {camp.status === 'evaluating' &&
                      (camp.verdict?.winner ? (
                        <Button
                          size="sm"
                          disabled={!canEdit || isBusy}
                          onClick={() =>
                            handlePromoteWinner(camp.id, camp.verdict!.winner!)
                          }
                        >
                          {isBusy ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trophy className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Send Winner ({camp.verdict.winner}) to Holdout
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canEdit || isBusy}
                            onClick={() => handlePromoteWinner(camp.id, 'A')}
                          >
                            {isBusy ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trophy className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Pick Variant A
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canEdit || isBusy}
                            onClick={() => handlePromoteWinner(camp.id, 'B')}
                          >
                            {isBusy ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trophy className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Pick Variant B
                          </Button>
                        </>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
