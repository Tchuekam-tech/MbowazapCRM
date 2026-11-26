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

interface OmnichannelPresenceTabProps {
  report: DigitalPresenceReport | null;
  links: GrowthLink[];
  coupons: PromoCoupon[];
  currency: string;
  canEdit: boolean;
  canAdmin: boolean;
  onRefresh: () => void;
  onJumpToLinks: () => void;
}

const SERVICE_STYLE: Record<string, { label: string; badge: string }> = {
  instagram: { label: 'Instagram', badge: 'bg-pink-500/15 text-pink-400 border-pink-500/30' },
  linkedin: { label: 'LinkedIn', badge: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  facebook: { label: 'Facebook', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  twitter: { label: 'X / Twitter', badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  tiktok: { label: 'TikTok', badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  youtube: { label: 'YouTube', badge: 'bg-red-500/15 text-red-400 border-red-500/30' },
  threads: { label: 'Threads', badge: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
  pinterest: { label: 'Pinterest', badge: 'bg-red-500/15 text-red-400 border-red-500/30' },
  bluesky: { label: 'Bluesky', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
};

function serviceMeta(service: string) {
  return (
    SERVICE_STYLE[service.toLowerCase()] ?? {
      label: service.charAt(0).toUpperCase() + service.slice(1),
      badge: 'bg-primary/10 text-primary border-primary/30',
    }
  );
}

export function OmnichannelPresenceTab({
  report,
  links,
  coupons,
  currency,
  canEdit,
  canAdmin,
  onRefresh,
  onJumpToLinks,
}: OmnichannelPresenceTabProps) {
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Cross-channel Composer state
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [postText, setPostText] = useState('');
  const [publishMode, setPublishMode] = useState<'addToQueue' | 'shareNow'>('addToQueue');
  const [publishing, setPublishing] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) {
      toast.error('Paste your Buffer Personal API Key first.');
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch('/api/marketing/buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not connect Buffer');
      toast.success(
        `Buffer connected! Synced ${data.sync?.channelsSynced ?? 0} channel(s) and ${data.sync?.postsSynced ?? 0} post(s).`
      );
      setApiKey('');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Buffer connection failed');
    } finally {
      setConnecting(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await fetch('/api/marketing/buffer/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      toast.success(
        `Synced ${data.sync?.channelsSynced ?? 0} channel(s) & ${data.sync?.postsSynced ?? 0} post(s) from Buffer.`
      );
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSwitchOrg(orgId: string) {
    setSyncing(true);
    try {
      const res = await fetch('/api/marketing/buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch_org', organization_id: orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Switched Buffer workspace to ${data.sync?.organizationName || orgId}`);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not switch workspace');
    } finally {
      setSyncing(false);
    }
  }

  async function handleRunAudit() {
    setAuditing(true);
    try {
      const res = await fetch('/api/marketing/buffer/audit', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Audit failed');
      toast.success(
        data.audit?.usedAi
          ? 'AI Digital Presence Audit complete!'
          : 'Omnichannel Digital Presence Audit updated!'
      );
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setAuditing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/marketing/buffer', { method: 'DELETE' });
      if (!res.ok) throw new Error('Disconnect failed');
      toast.success('Buffer disconnected and cached social data removed.');
      onRefresh();
    } catch {
      toast.error('Could not disconnect Buffer');
    } finally {
      setDisconnecting(false);
    }
  }

  function toggleChannel(channelId: string) {
    setSelectedChannels((prev) =>
      prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId]
    );
  }

  function injectGrowthLink(link: GrowthLink) {
    const snippet = `\n\n💬 Chat with us on WhatsApp: ${origin}/go/${link.slug}`;
    setPostText((prev) => (prev.trim() ? `${prev.trim()}${snippet}` : snippet.trim()));
  }

  function injectCoupon(coupon: PromoCoupon) {
    const snippet = ` Use code ${coupon.code} for ${
      coupon.discount_type === 'percent'
        ? `${coupon.discount_value}% OFF`
        : `${formatCurrency(coupon.discount_value, coupon.currency)} OFF`
    }!`;
    setPostText((prev) => `${prev}${snippet}`);
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (selectedChannels.length === 0 || !postText.trim()) {
      toast.error('Select at least one social channel and write your post.');
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch('/api/marketing/buffer/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_ids: selectedChannels,
          text: postText.trim(),
          mode: publishMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');
      toast.success(
        publishMode === 'shareNow'
          ? `Published immediately to ${data.succeeded} channel(s)!`
          : `Queued to ${data.succeeded} Buffer channel(s)!`
      );
      setPostText('');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publishing failed');
    } finally {
      setPublishing(false);
    }
  }

  // ============================================================
  // State 1: Not yet connected — 1-Paste Buffer Onboarding
  // ============================================================
  if (!report?.connected || !report.integration) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleConnect}
          className="space-y-4 rounded-xl border border-primary/30 bg-card p-6 lg:col-span-6"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Connect Your Buffer API Key
              </h2>
              <p className="text-xs text-muted-foreground">
                Instantly unlock unified analytics & publishing across all your social channels.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">How to get your Buffer API key (15 seconds):</p>
            <ol className="list-inside list-decimal space-y-1">
              <li>Sign in to Buffer and open <strong>Settings → API</strong> (or <span className="font-mono">publish.buffer.com/settings/api</span>).</li>
              <li>Click <strong>Generate API Key</strong> and copy your Personal API Key.</li>
              <li>Paste it below — MboWazapCRM encrypts it with AES-256-GCM and syncs every connected channel automatically.</li>
            </ol>
          </div>

          <div>
            <Label htmlFor="buffer-api-key" className="text-xs">
              Buffer Personal API Key
            </Label>
            <div className="relative mt-1">
              <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="buffer-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your Buffer API token..."
                className="pl-9 font-mono text-xs"
                required
              />
            </div>
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Encrypted at rest with AES-256-GCM. Never exposed to the browser.
            </p>
          </div>

          <Button
            type="submit"
            disabled={!canAdmin || connecting}
            className="w-full"
          >
            {connecting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Globe className="mr-2 h-4 w-4" />
            )}
            {canAdmin
              ? 'Connect Buffer & Sync All Channels'
              : 'Admin Role Required to Connect Buffer'}
          </Button>
        </form>

        <div className="space-y-4 rounded-xl border border-border bg-card p-6 lg:col-span-6">
          <h3 className="text-sm font-semibold text-foreground">
            What Unlocks Instantly Once Connected
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              {
                title: '360° Digital Presence Score',
                desc: 'Live 0–100 score unifying Channel Coverage, Consistency, Engagement, and WhatsApp Conversion Bridge.',
              },
              {
                title: 'Social → WhatsApp Attribution',
                desc: 'See exactly how Instagram, LinkedIn, TikTok, Facebook & X drive WhatsApp clicks, hot leads & revenue.',
              },
              {
                title: 'AI Digital Strategist Audit',
                desc: '1-click deep analysis across all your social posts + CRM funnel spotting blind spots & top wins.',
              },
              {
                title: '1-Click Cross-Channel Publishing',
                desc: 'Queue posts directly to Buffer with your MboWazap /go/ Growth Links & promo coupons embedded.',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-border bg-muted/30 p-3.5"
              >
                <p className="text-xs font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {['Instagram', 'LinkedIn', 'Facebook', 'X / Twitter', 'TikTok', 'YouTube', 'Threads', 'Pinterest', 'Bluesky'].map(
              (net) => (
                <span
                  key={net}
                  className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {net}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // State 2: Connected — Full Omnichannel Command Center
  // ============================================================
  const { integration, totals, scoreBreakdown } = report;

  return (
    <div className="space-y-6">
      {/* Connected Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                Buffer Connected · {integration.organization_name || 'Workspace'}
              </p>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">
                {totals.connectedChannels} channels live
              </span>
              {!integration.insights_available && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                  Post insights scope limited
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {integration.buffer_account_email || integration.buffer_account_name || 'Connected Account'}
              {integration.last_synced_at
                ? ` · Last synced ${new Date(integration.last_synced_at).toLocaleString()}`
                : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {integration.organizations.length > 1 && canAdmin && (
            <select
              value={integration.organization_id}
              onChange={(e) => handleSwitchOrg(e.target.value)}
              disabled={syncing}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              {integration.organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit || syncing}
            onClick={handleSyncNow}
          >
            {syncing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Sync Buffer
          </Button>
          <Button
            size="sm"
            disabled={!canEdit || auditing}
            onClick={handleRunAudit}
          >
            {auditing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            AI Full Presence Audit
          </Button>
          {canAdmin && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disconnecting}
              onClick={handleDisconnect}
              className="text-muted-foreground hover:text-destructive"
              title="Disconnect Buffer"
            >
              <Unplug className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Digital Presence Score + 4 Pillars + Totals */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 rounded-xl border border-border bg-card p-5 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Unified Digital Presence Score
              </p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums text-primary">
                {report.presenceScore}
                <span className="text-sm font-normal text-muted-foreground"> / 100</span>
              </p>
            </div>
            <BarChart3 className="h-8 w-8 text-primary/60" />
          </div>

          <div className="space-y-2.5">
            {[
              { label: 'Channel Coverage', val: scoreBreakdown.channelCoverage },
              { label: 'Publishing Consistency', val: scoreBreakdown.publishingConsistency },
              { label: 'Audience Engagement', val: scoreBreakdown.audienceEngagement },
              { label: 'WhatsApp Conversion Bridge', val: scoreBreakdown.whatsappConversionBridge },
            ].map((p) => (
              <div key={p.label} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{p.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {p.val}/25
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${(p.val / 25) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-7">
          {[
            {
              label: 'Total Impressions',
              value: totals.impressions.toLocaleString(),
              sub: `Reach: ${totals.reach.toLocaleString()}`,
            },
            {
              label: 'Total Engagements',
              value: totals.engagements.toLocaleString(),
              sub: `Avg rate: ${totals.avgEngagementRate}%`,
            },
            {
              label: 'Posts Published (30d)',
              value: totals.sentPosts30d.toLocaleString(),
              sub: `${totals.scheduledQueueTotal} queued next`,
            },
            {
              label: 'Social → WA Clicks',
              value: totals.socialDrivenWaClicks.toLocaleString(),
              sub: `${totals.postsWithGrowthLinks} posts carry /go/ links`,
            },
            {
              label: 'Social → WA Leads',
              value: totals.socialDrivenWaLeads.toLocaleString(),
              sub: 'Attributed across channels',
            },
            {
              label: 'Social-Driven Revenue',
              value: formatCurrency(totals.socialDrivenRevenue, currency),
              sub: 'Via tracked Growth Links',
              highlight: true,
            },
          ].map((card) => (
            <div
              key={card.label}
              className={`rounded-xl border p-4 ${
                card.highlight
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card'
              }`}
            >
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p
                className={`mt-1 text-xl font-bold tabular-nums ${
                  card.highlight ? 'text-primary' : 'text-foreground'
                }`}
              >
                {card.value}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{card.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* AI Digital Presence Audit Panel */}
      {report.audit && (
        <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                {report.audit.headline}
              </h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {report.audit.usedAi ? 'AI Strategist' : 'Omnichannel Diagnostic'} ·{' '}
              {new Date(report.audit.generatedAt).toLocaleString()}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-foreground/90">
            {report.audit.executiveSummary}
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5 rounded-lg bg-card/80 p-3">
              <p className="text-xs font-semibold text-emerald-400">Strengths</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {report.audit.strengths.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1.5 rounded-lg bg-card/80 p-3">
              <p className="text-xs font-semibold text-amber-400">Blind Spots & Leaks</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {report.audit.blindSpots.map((b, i) => (
                  <li key={i}>• {b}</li>
                ))}
              </ul>
            </div>
          </div>
          {report.audit.actionPlan.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
              {report.audit.actionPlan.map((act, i) => (
                <div key={i} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">{act.title}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        act.impact === 'high'
                          ? 'bg-orange-500/15 text-orange-400'
                          : 'bg-primary/15 text-primary'
                      }`}
                    >
                      {act.impact}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{act.step}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Connected Channels Grid — Cross-Channel to WhatsApp Bridge */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Connected Social Channels & WhatsApp Conversion Bridge ({report.channels.length})
          </h3>
          <Button size="sm" variant="ghost" onClick={onJumpToLinks} className="text-xs text-primary">
            Create Growth Link Bridge <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {report.channels.map((ch) => {
            const meta = serviceMeta(ch.service);
            return (
              <div
                key={ch.channelId}
                className="space-y-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {ch.avatarUrl ? (
                      <img
                        src={ch.avatarUrl}
                        alt={ch.name}
                        className="h-9 w-9 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">
                        {meta.label.charAt(0)}
                      </div>
