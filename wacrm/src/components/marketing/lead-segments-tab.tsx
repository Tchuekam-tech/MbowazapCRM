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

  async function handleAnalyzeLead(contactId: string) {
    setAnalyzingId(contactId);
    try {
      const res = await fetch('/api/marketing/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze', contact_id: contactId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        data.insight?.usedAi
          ? 'AI deep buyer analysis ready!'
          : 'Behavioral intent summary updated!'
      );
      onRefresh();
    } catch {
      toast.error('Analysis failed');
    } finally {
      setAnalyzingId(null);
    }
  }

  async function handlePreviewSegment() {
    try {
      const res = await fetch('/api/marketing/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true, rules: buildRules() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreviewCount(data.count ?? 0);
    } catch {
      toast.error('Could not preview segment');
    }
  }

  async function handleSaveSegment(e: React.FormEvent) {
    e.preventDefault();
    if (!segName.trim()) {
      toast.error('Segment name is required');
      return;
    }
    setSavingSeg(true);
    try {
      const res = await fetch('/api/marketing/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: segName, rules: buildRules() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Smart segment "${segName}" saved (${data.segment?.cached_count ?? 0} contacts)`);
      setSegName('');
      setPreviewCount(null);
      onRefresh();
    } catch {
      toast.error('Failed to save segment');
    } finally {
      setSavingSeg(false);
    }
  }

  async function handleDeleteSegment(id: string) {
    try {
      const res = await fetch(`/api/marketing/segments?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      toast.success('Segment removed');
      onRefresh();
    } catch {
      toast.error('Failed to delete segment');
    }
  }

  function toggleSegTier(tier: LeadTier) {
    setSegTiers((prev) =>
      prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: AI Lead Intelligence Leaderboard */}
      <div className="space-y-4 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'hot', 'warm', 'cold'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setTierFilter(tier)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  tierFilter === tier
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {tier} (
                {tier === 'all'
                  ? leads.length
                  : leads.filter((l) => l.tier === tier).length}
                )
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit || recomputing}
            onClick={handleRecomputeAll}
          >
            {recomputing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Score All Contacts
          </Button>
        </div>

        <div className="space-y-3">
          {filteredLeads.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-6 text-center">
              <Flame className="mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">No scored leads in this tier yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click &ldquo;Score All Contacts&rdquo; to evaluate buying intent, recency, and deal signals across your CRM.
              </p>
            </div>
          ) : (
            filteredLeads.slice(0, 30).map((lead) => {
              const meta = TIER_BADGE[lead.tier];
              const Icon = meta.icon;
              return (
                <div
                  key={lead.contact_id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">
                          {lead.contact?.name || lead.contact?.phone || 'Contact'}
                        </p>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${meta.classes}`}
                        >
                          <Icon className="h-3 w-3" />
                          {meta.label} · {lead.score}/100
                        </span>
                        {lead.intent_label && (
                          <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {lead.intent_label}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {lead.contact?.phone}
                        {lead.contact?.utm_source ? ` · via ${lead.contact.utm_source}` : ''}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEdit || analyzingId === lead.contact_id}
                      onClick={() => handleAnalyzeLead(lead.contact_id)}
                    >
                      {analyzingId === lead.contact_id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />
                      )}
                      AI Analyze
                    </Button>
                  </div>

                  {/* Score progress bar */}
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        lead.tier === 'hot'
                          ? 'bg-orange-500'
                          : lead.tier === 'warm'
                            ? 'bg-amber-400'
                            : 'bg-sky-500'
                      }`}
                      style={{ width: `${lead.score}%` }}
                    />
                  </div>

                  {lead.ai_summary && (
                    <p className="mt-2.5 rounded-lg bg-primary/5 px-3 py-2 text-xs text-foreground">
                      <span className="font-semibold text-primary">AI Insight: </span>
                      {lead.ai_summary}
                    </p>
                  )}

                  {lead.next_best_action && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Next Best Action: </span>
                      {lead.next_best_action}
                    </p>
                  )}

                  {Array.isArray(lead.signals) && lead.signals.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {lead.signals.slice(0, 4).map((sig, i) => (
                        <span
                          key={i}
                          className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {sig.label} ({sig.points > 0 ? `+${sig.points}` : sig.points})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right: Smart Dynamic Segments Builder & Saved List */}
      <div className="space-y-4 lg:col-span-5">
        <form
          onSubmit={handleSaveSegment}
          className="space-y-4 rounded-xl border border-border bg-card p-5"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Filter className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Smart Audience Segment Builder
              </h2>
              <p className="text-xs text-muted-foreground">
                Target high-intent or dormant leads for Drip Sequences & A/B Tests.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="seg-name" className="text-xs">Segment Name</Label>
              <Input
                id="seg-name"
                value={segName}
                onChange={(e) => setSegName(e.target.value)}
                placeholder="e.g. Hot Instagram Buyers"
                className="mt-1"
                required
              />
            </div>

            <div>
              <Label className="text-xs">Lead Temperature</Label>
              <div className="mt-1.5 flex gap-2">
                {(['hot', 'warm', 'cold'] as const).map((tier) => {
                  const active = segTiers.includes(tier);
                  return (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => toggleSegTier(tier)}
                      className={`flex-1 rounded-lg border py-1.5 text-xs font-medium capitalize transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-muted/40 text-muted-foreground'
                      }`}
                    >
                      {tier}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="seg-min" className="text-xs">Min Score (0–100)</Label>
                <Input
                  id="seg-min"
                  type="number"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(e) => setMinScore(e.target.value)}
                  placeholder="60"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <Label htmlFor="seg-utm" className="text-xs">UTM Source</Label>
                <Input
                  id="seg-utm"
                  value={utmSource}
                  onChange={(e) => setUtmSource(e.target.value)}
                  placeholder="instagram"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="seg-active" className="text-xs">Active Within (days)</Label>
                <Input
                  id="seg-active"
                  type="number"
                  min={1}
                  value={activeWithinDays}
                  onChange={(e) => setActiveWithinDays(e.target.value)}
                  placeholder="7"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <Label htmlFor="seg-inactive" className="text-xs">Dormant Over (days)</Label>
                <Input
                  id="seg-inactive"
                  type="number"
                  min={1}
                  value={inactiveDays}
                  onChange={(e) => setInactiveDays(e.target.value)}
                  placeholder="14 (win-back)"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="seg-tag" className="text-xs">Has Tag</Label>
              <select
                id="seg-tag"
                value={selectedTagId}
                onChange={(e) => setSelectedTagId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground"
              >
                <option value="">Any tag</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {previewCount !== null && (
            <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
              <span className="font-medium">Live Audience Match</span>
              <span className="font-bold tabular-nums">{previewCount} contacts</span>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handlePreviewSegment}
              className="flex-1"
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Preview Count
            </Button>
            <Button type="submit" disabled={!canEdit || savingSeg} className="flex-1">
              {savingSeg ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save Segment
            </Button>
          </div>
        </form>

        {/* Saved Segments */}
        <div className="space-y-2">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Saved Smart Segments ({segments.length})
          </h3>
          {segments.map((seg) => (
            <div
              key={seg.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{seg.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
