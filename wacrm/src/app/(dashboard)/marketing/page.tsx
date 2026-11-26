'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useTranslations } from 'next-intl';
import {
  Rocket,
  Link2,
  Flame,
  GitBranchPlus,
  FlaskConical,
  TrendingUp,
  Globe,
  Loader2,
  Activity,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  AbCampaign,
  ContactLeadScore,
  DigitalPresenceReport,
  DripSequence,
  GrowthLink,
  MarketingAnalyticsSnapshot,
  MarketingSegment,
  PromoCoupon,
  Tag,
} from '@/types';
import { GrowthLinksTab } from '@/components/marketing/growth-links-tab';
import { LeadSegmentsTab } from '@/components/marketing/lead-segments-tab';
import { DripSequencesTab } from '@/components/marketing/drip-sequences-tab';
import { AbCampaignsTab } from '@/components/marketing/ab-campaigns-tab';
import {
  RoiCouponsTab,
  type SystemHealthSnapshot,
} from '@/components/marketing/roi-coupons-tab';
import { OmnichannelPresenceTab } from '@/components/marketing/omnichannel-presence-tab';
import { formatCurrency } from '@/lib/currency';

const VALID_TABS = new Set(['links', 'leads', 'drips', 'campaigns', 'roi', 'presence']);

export default function MarketingStudioPage() {
  return (
    <Suspense fallback={null}>
      <MarketingStudioInner />
    </Suspense>
  );
}

function MarketingStudioInner() {
  const t = useTranslations('Marketing');
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    initialTab && VALID_TABS.has(initialTab) ? initialTab : 'links'
  );

  const { defaultCurrency } = useAuth();
  const canEdit = useCan('send-messages');
  const canAdmin = useCan('edit-settings');

  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<GrowthLink[]>([]);
  const [leads, setLeads] = useState<ContactLeadScore[]>([]);
  const [segments, setSegments] = useState<MarketingSegment[]>([]);
  const [sequences, setSequences] = useState<DripSequence[]>([]);
  const [campaigns, setCampaigns] = useState<AbCampaign[]>([]);
  const [coupons, setCoupons] = useState<PromoCoupon[]>([]);
  const [analytics, setAnalytics] = useState<MarketingAnalyticsSnapshot | null>(null);
  const [presence, setPresence] = useState<DigitalPresenceReport | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealthSnapshot | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/system/status');
      if (res.ok) setSystemHealth(await res.json());
    } catch {
      // Non-fatal
    }
  }, []);

  const loadAll = useCallback(async () => {
    const supabase = createClient();
    const [
      linksRes,
      leadsRes,
      segmentsRes,
      seqRes,
      campRes,
      couponsRes,
      analyticsRes,
      presenceRes,
      tagsRes,
    ] = await Promise.all([
      fetch('/api/marketing/links').then((r) => (r.ok ? r.json() : { links: [] })).catch(() => ({ links: [] })),
      fetch('/api/marketing/leads').then((r) => (r.ok ? r.json() : { leads: [] })).catch(() => ({ leads: [] })),
      fetch('/api/marketing/segments').then((r) => (r.ok ? r.json() : { segments: [] })).catch(() => ({ segments: [] })),
      fetch('/api/marketing/sequences').then((r) => (r.ok ? r.json() : { sequences: [] })).catch(() => ({ sequences: [] })),
      fetch('/api/marketing/campaigns').then((r) => (r.ok ? r.json() : { campaigns: [] })).catch(() => ({ campaigns: [] })),
      fetch('/api/marketing/coupons').then((r) => (r.ok ? r.json() : { coupons: [] })).catch(() => ({ coupons: [] })),
      fetch('/api/marketing/analytics').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/marketing/buffer').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      supabase.from('tags').select('*').order('name'),
    ]);

    setLinks(linksRes.links ?? []);
    setLeads(leadsRes.leads ?? []);
    setSegments(segmentsRes.segments ?? []);
    setSequences(seqRes.sequences ?? []);
    setCampaigns(campRes.campaigns ?? []);
    setCoupons(couponsRes.coupons ?? []);
    setAnalytics(analyticsRes);
    setPresence(presenceRes);
    setTags((tagsRes.data ?? []) as Tag[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
    void loadHealth();
  }, [loadAll, loadHealth]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {presence?.connected && (
            <button
              type="button"
              onClick={() => setActiveTab('presence')}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
            >
              <Globe className="h-3.5 w-3.5" />
              Presence {presence.presenceScore}/100 · {presence.totals.connectedChannels} channels
            </button>
          )}
          {systemHealth && (
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <Activity
                className={`h-3.5 w-3.5 ${
                  systemHealth.status === 'optimal'
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              />
              <span className="font-medium text-foreground">
                DB {systemHealth.database.latencyMs}ms
              </span>
              {systemHealth.bot.reachable && systemHealth.bot.latencyMs !== null && (
                <span className="text-muted-foreground">
                  · Bot {systemHealth.bot.latencyMs}ms
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top Marketing KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('kpiLinks')}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
            {analytics?.funnel.clicks.toLocaleString() ?? 0}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {links.length} tracked links
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('kpiHotLeads')}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-orange-400">
            {analytics?.summary.hotLeadCount ?? 0}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Avg score {analytics?.summary.avgLeadScore ?? 0}/100
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('kpiDrips')}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
            {analytics?.summary.activeSequences ?? 0}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {segments.length} smart segments
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('kpiExperiments')}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
            {campaigns.length}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {analytics?.summary.runningExperiments ?? 0} live tests
          </p>
        </div>
        <div className="col-span-2 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:col-span-1">
          <p className="text-xs text-muted-foreground">{t('kpiRevenue')}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-primary">
            {formatCurrency(analytics?.funnel.wonRevenue ?? 0, defaultCurrency)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {analytics?.funnel.redemptions ?? 0} coupon sales
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-border bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
            <TabsTrigger value="presence" className="gap-1.5 text-xs">
              <Globe className="h-3.5 w-3.5" />
              {t('tabs.presence')}
            </TabsTrigger>
            <TabsTrigger value="links" className="gap-1.5 text-xs">
              <Link2 className="h-3.5 w-3.5" />
              {t('tabs.links')}
            </TabsTrigger>
            <TabsTrigger value="leads" className="gap-1.5 text-xs">
              <Flame className="h-3.5 w-3.5" />
              {t('tabs.leads')}
            </TabsTrigger>
            <TabsTrigger value="drips" className="gap-1.5 text-xs">
              <GitBranchPlus className="h-3.5 w-3.5" />
              {t('tabs.drips')}
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="gap-1.5 text-xs">
              <FlaskConical className="h-3.5 w-3.5" />
              {t('tabs.campaigns')}
            </TabsTrigger>
            <TabsTrigger value="roi" className="gap-1.5 text-xs">
              <TrendingUp className="h-3.5 w-3.5" />
              {t('tabs.roi')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="presence">
            <OmnichannelPresenceTab
              report={presence}
              links={links}
              coupons={coupons}
              currency={defaultCurrency}
              canEdit={canEdit}
              canAdmin={canAdmin}
              onRefresh={loadAll}
              onJumpToLinks={() => setActiveTab('links')}
            />
          </TabsContent>

          <TabsContent value="links">
            <GrowthLinksTab
              links={links}
              tags={tags}
              canEdit={canEdit}
              onRefresh={loadAll}
            />
          </TabsContent>

          <TabsContent value="leads">
            <LeadSegmentsTab
              leads={leads}
              segments={segments}
              tags={tags}
              canEdit={canEdit}
              onRefresh={loadAll}
            />
          </TabsContent>
