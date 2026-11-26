'use client';

import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Activity,
  Brain,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Play,
  Send,
  Sparkles,
  Trash2,
  AlertTriangle,
  Globe,
  BookOpen,
  DollarSign,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type {
  JarvisActionRecord,
  JarvisChatMessage,
  JarvisOverviewPayload,
} from '@/types/jarvis';

interface JarvisCommandTabProps {
  data: JarvisOverviewPayload;
  onRefresh: () => Promise<void>;
  onOpenTab: (tab: 'command' | 'actions' | 'knowledge' | 'autonomy') => void;
}

const QUICK_PROMPTS = [
  'Give me a 24h executive briefing across inbox, leads, pipeline & social',
  'Which hot leads need an immediate WhatsApp follow-up? Queue drafts for me',
  'Audit our stalled deals and suggest next best moves',
  'How ready is our Knowledge Base and Buffer omnichannel bridge?',
];

export function JarvisCommandTab({
  data,
  onRefresh,
  onOpenTab,
}: JarvisCommandTabProps) {
  const [runningCycle, setRunningCycle] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [messages, setMessages] = useState<JarvisChatMessage[]>(data.chatMessages);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages(data.chatMessages);
  }, [data.chatMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sendingChat]);

  const { ecosystem, config, recentRuns, todayStats } = data;
  const latestRun = recentRuns[0] ?? null;

  const handleRunCycle = async () => {
    setRunningCycle(true);
    try {
      const res = await fetch('/api/jarvis/run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Failed to run Jarvis brain cycle');
        return;
      }
      const proposed = Array.isArray(json.actions) ? json.actions.length : 0;
      toast.success(
        `${config.agent_name} scanned the entire ecosystem — Health ${json.run?.health_score ?? ecosystem.healthScore}/100 (${proposed} action(s))`
      );
      await onRefresh();
    } catch {
      toast.error('Network error triggering Jarvis scan');
    } finally {
      setRunningCycle(false);
    }
  };

  const handleSendCommand = async (promptOverride?: string) => {
    const text = (promptOverride ?? chatInput).trim();
    if (!text || sendingChat) return;
    setChatInput('');
    setSendingChat(true);

    const optimistic: JarvisChatMessage = {
      id: `temp-${Date.now()}`,
      account_id: config.account_id,
      user_id: null,
      role: 'user',
      content: text,
      proposed_action_ids: [],
      metadata: {},
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const res = await fetch('/api/jarvis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Jarvis failed to respond');
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        return;
      }
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        json.userMessage as JarvisChatMessage,
        json.assistantMessage as JarvisChatMessage,
      ]);
      const queued = (json.proposedActions ?? []) as JarvisActionRecord[];
      if (queued.length > 0) {
        toast.success(`${config.agent_name} queued ${queued.length} action(s) for approval`);
        await onRefresh();
      }
    } catch {
      toast.error('Network error talking to Jarvis');
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setSendingChat(false);
    }
  };

  const handleClearChat = async () => {
    try {
      const res = await fetch('/api/jarvis/chat', { method: 'DELETE' });
      if (res.ok) {
        setMessages([]);
        toast.success('Command console cleared');
      }
    } catch {
      toast.error('Failed to clear chat');
    }
  };

  const pillars = [
    {
      label: 'Inbox SLA',
      score: ecosystem.pillars.inboxSla,
      max: 20,
      icon: MessageSquare,
      detail: `${ecosystem.inbox.openConversations} open · ${ecosystem.inbox.unansweredOver15m} waiting >15m`,
    },
    {
      label: 'Pipeline',
      score: ecosystem.pillars.pipelineVelocity,
      max: 20,
      icon: DollarSign,
      detail: `${ecosystem.pipeline.openDealsCount} open · ${ecosystem.pipeline.stalledDealsCount} stalled`,
    },
    {
      label: 'Leads',
      score: ecosystem.pillars.leadConversion,
      max: 20,
      icon: Users,
      detail: `${ecosystem.leads.hotCount} Hot · ${ecosystem.leads.hotWithoutDeal.length} without deal`,
    },
    {
      label: 'Omnichannel',
      score: ecosystem.pillars.omnichannelPresence,
      max: 20,
      icon: Globe,
      detail: ecosystem.omnichannel.bufferConnected
        ? `${ecosystem.omnichannel.connectedChannels} channels · ${ecosystem.omnichannel.presenceScore}/100`
        : 'Buffer not connected',
    },
    {
      label: 'Knowledge DNA',
      score: ecosystem.pillars.knowledgeReadiness,
      max: 20,
      icon: BookOpen,
      detail: `${ecosystem.knowledge.companyProfileCompleteness}% bio · ${ecosystem.knowledge.totalDocuments} docs`,
    },
  ];

  const healthColor =
    ecosystem.healthScore >= 75
      ? 'text-emerald-400'
      : ecosystem.healthScore >= 50
        ? 'text-amber-400'
        : 'text-rose-400';

  return (
    <div className="space-y-5">
      {/* Top Ecosystem Health + Brain Control Banner */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-primary" />
                360° Ecosystem Health Score
              </CardTitle>
              <CardDescription>
                Live telemetry across WhatsApp Inbox, Leads, Pipeline, Buffer Omnichannel & Knowledge Base
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className={`text-3xl font-bold leading-none ${healthColor}`}>
                  {ecosystem.healthScore}
                  <span className="text-sm font-normal text-muted-foreground">/100</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {config.is_enabled ? '24/7 Loop Active' : 'Manual Mode'}
                </p>
              </div>
              <Button onClick={handleRunCycle} disabled={runningCycle} size="sm">
                {runningCycle ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Run Brain Cycle
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              {pillars.map((p) => {
                const Icon = p.icon;
                const pct = Math.round((p.score / p.max) * 100);
                return (
                  <div
                    key={p.label}
                    className="rounded-lg border border-border bg-muted/30 p-3"
                  >
                    <div className="flex items-center justify-between text-xs font-medium text-foreground">
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 text-primary" />
                        {p.label}
                      </span>
                      <span className="font-semibold">
                        {p.score}/{p.max}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={p.detail}>
                      {p.detail}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Latest Executive Briefing */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  Latest {config.agent_name} Executive Briefing
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {config.last_cycle_at
                    ? `Last scan: ${new Date(config.last_cycle_at).toLocaleString()}`
                    : 'Not scanned yet — click Run Brain Cycle'}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-foreground">
                {config.last_cycle_summary ||
                  latestRun?.executive_summary ||
                  `${config.agent_name} is ready to analyze your entire CRM ecosystem, score leads, monitor inbox SLAs, check Buffer social channels, and execute or propose high-impact actions 24/7.`}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Employee Telemetry + Quick Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4 text-primary" />
              {config.agent_name} Status
            </CardTitle>
            <CardDescription>{config.agent_role}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">Autonomy Mode</span>
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold capitalize text-primary">
                {config.autonomy_mode}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">Human Typing Sim</span>
              <span
                className={`text-xs font-semibold ${
                  config.typing_simulation_enabled ? 'text-emerald-400' : 'text-muted-foreground'
                }`}
              >
                {config.typing_simulation_enabled
                  ? `ON (${config.typing_speed_profile})`
                  : 'OFF'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">Pending Approvals</span>
              <button
                type="button"
                onClick={() => onOpenTab('actions')}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {todayStats.pendingApprovals} waiting →
              </button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">Executed Today</span>
              <span className="text-xs font-semibold text-foreground">
                {todayStats.actionsExecutedToday} / {config.max_autonomous_actions_per_day}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">Knowledge Base</span>
              <button
                type="button"
                onClick={() => onOpenTab('knowledge')}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {ecosystem.knowledge.totalDocuments} docs ({ecosystem.knowledge.totalChunks} chunks) →
              </button>
            </div>

            {ecosystem.knowledge.companyProfileCompleteness < 50 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  Connect your Company Bio, website links, or business docs so {config.agent_name} speaks accurately for your brand.
                  <button
                    type="button"
                    onClick={() => onOpenTab('knowledge')}
                    className="ml-1 font-semibold underline"
                  >
                    Open Knowledge Hub
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Direct Jarvis Command Console */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Talk to {config.agent_name} — Live Ecosystem Command Console
            </CardTitle>
            <CardDescription>
              Ask anything about your leads, inbox, revenue, Buffer channels, or knowledge base — or command {config.agent_name} to draft & queue actions.
            </CardDescription>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearChat}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp}
                type="button"
                disabled={sendingChat}
                onClick={() => void handleSendCommand(qp)}
                className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground disabled:opacity-50"
              >
                {qp}
              </button>
            ))}
          </div>

          <div
            ref={scrollRef}
            className="h-[46dvh] min-h-[260px] space-y-3 overflow-y-auto rounded-[20px] border border-border bg-muted/20 p-4 sm:h-80"
          >
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <Brain className="mb-2 h-8 w-8 text-primary/60" />
                <p className="font-medium text-foreground">
                  {config.agent_name} is online and monitoring your ecosystem
                </p>
                <p className="mt-1 max-w-md text-xs">
                  Ask for an executive briefing, inspect unanswered VIP threads, audit stalled deals, or tell {config.agent_name} to queue personalized WhatsApp follow-ups.
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-card text-foreground'
                    }`}
                  >
                    {m.content}
                    {m.role === 'assistant' && m.proposed_action_ids?.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <button
                          type="button"
                          onClick={() => onOpenTab('actions')}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Review {m.proposed_action_ids.length} queued action(s) in Action Queue →
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {sendingChat && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  {config.agent_name} is analyzing your live ecosystem…
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendCommand();
            }}
            className="flex gap-2"
          >
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={`Ask ${config.agent_name} anything or give an order (e.g. "Follow up with our unanswered hot leads")…`}
              disabled={sendingChat}
            />
            <Button type="submit" disabled={sendingChat || !chatInput.trim()}>
              {sendingChat ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
