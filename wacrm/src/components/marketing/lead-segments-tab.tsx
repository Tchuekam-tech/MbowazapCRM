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

