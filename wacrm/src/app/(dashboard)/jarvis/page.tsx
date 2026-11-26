'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BookOpen,
  BrainCircuit,
  ListChecks,
  Loader2,
  RefreshCw,
  Sliders,
  Sparkles,
  Keyboard,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { JarvisCommandTab } from '@/components/jarvis/jarvis-command-tab';
import { JarvisActionsTab } from '@/components/jarvis/jarvis-actions-tab';
import { JarvisKnowledgeHubTab } from '@/components/jarvis/jarvis-knowledge-hub-tab';
import { JarvisAutonomyTab } from '@/components/jarvis/jarvis-autonomy-tab';
import type { JarvisOverviewPayload } from '@/types/jarvis';

type JarvisTab = 'command' | 'actions' | 'knowledge' | 'autonomy';

const VALID_TABS: ReadonlySet<JarvisTab> = new Set([
  'command',
  'actions',
  'knowledge',
  'autonomy',
]);

function JarvisPageInner() {
  const t = useTranslations('Jarvis');
  const searchParams = useSearchParams();
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const initialTabParam = searchParams.get('tab') as JarvisTab | null;
  const [tab, setTab] = useState<JarvisTab>(
    initialTabParam && VALID_TABS.has(initialTabParam) ? initialTabParam : 'command'
  );
  const [data, setData] = useState<JarvisOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/jarvis', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load Jarvis Command Center');
        return;
      }
      setData(json as JarvisOverviewPayload);
      setError(null);
    } catch {
      setError('Could not reach Jarvis API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const param = searchParams.get('tab') as JarvisTab | null;
    if (param && VALID_TABS.has(param)) {
      setTab(param);
    }
  }, [searchParams]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {data?.config.agent_name ? `${data.config.agent_name} — ${t('title')}` : t('title')}
            </h1>
            {data && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                  data.config.is_enabled
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-border bg-muted text-muted-foreground'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    data.config.is_enabled ? 'animate-pulse bg-emerald-400' : 'bg-muted-foreground'
                  }`}
                />
                {data.config.is_enabled ? '24/7 ONLINE' : 'STANDBY'}
              </span>
            )}
            {data?.config.typing_simulation_enabled && (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                <Keyboard className="h-3 w-3" />
                Typing Sim ON
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadOverview()}
          disabled={loading}
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
          Initializing Jarvis 360° Ecosystem Brain…
        </div>
      ) : error && !data ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive">
          {error}
        </div>
      ) : data ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as JarvisTab)}>
          <TabsList className="no-scrollbar flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto rounded-full border border-border/70 bg-muted/60 p-1 sm:w-fit">
            <TabsTrigger value="command" className="tap-press shrink-0 rounded-full px-3.5 py-2 text-xs data-active:bg-foreground data-active:text-background">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {t('tabs.command')}
            </TabsTrigger>
            <TabsTrigger value="actions" className="tap-press shrink-0 rounded-full px-3.5 py-2 text-xs data-active:bg-foreground data-active:text-background">
              <ListChecks className="mr-1.5 h-3.5 w-3.5" />
              {t('tabs.actions')}
              {data.todayStats.pendingApprovals > 0 && (
                <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {data.todayStats.pendingApprovals}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="tap-press shrink-0 rounded-full px-3.5 py-2 text-xs data-active:bg-foreground data-active:text-background">
              <BookOpen className="mr-1.5 h-3.5 w-3.5" />
              {t('tabs.knowledge')}
            </TabsTrigger>
            <TabsTrigger value="autonomy" className="tap-press shrink-0 rounded-full px-3.5 py-2 text-xs data-active:bg-foreground data-active:text-background">
              <Sliders className="mr-1.5 h-3.5 w-3.5" />
              {t('tabs.autonomy')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="command" className="mt-4">
            <JarvisCommandTab
              data={data}
              onRefresh={loadOverview}
              onOpenTab={setTab}
            />
          </TabsContent>

          <TabsContent value="actions" className="mt-4">
            <JarvisActionsTab data={data} onRefresh={loadOverview} />
          </TabsContent>

          <TabsContent value="knowledge" className="mt-4">
            <JarvisKnowledgeHubTab
              data={data}
              canEdit={canEdit}
              onRefresh={loadOverview}
            />
          </TabsContent>

          <TabsContent value="autonomy" className="mt-4">
            <JarvisAutonomyTab
              data={data}
              canEdit={canEdit}
              onRefresh={loadOverview}
            />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}

export default function JarvisPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
          Loading Jarvis Command Center…
        </div>
      }
    >
      <JarvisPageInner />
    </Suspense>
  );
}
