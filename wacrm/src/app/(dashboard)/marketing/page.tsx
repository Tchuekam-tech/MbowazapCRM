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
