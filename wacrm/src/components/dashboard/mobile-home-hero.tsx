"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowRight,
  BrainCircuit,
  ChevronRight,
  DollarSign,
  Globe,
  Loader2,
  MessageSquare,
  Sparkles,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type {
  ConversationsSeriesPoint,
  MetricsBundle,
} from "@/lib/dashboard/types";
import type {
  DigitalPresenceReport,
  JarvisOverviewPayload,
} from "@/types";

interface MobileHomeHeroProps {
  metrics: MetricsBundle | null;
  series7d: ConversationsSeriesPoint[] | null;
  jarvis: JarvisOverviewPayload | null;
  presence: DigitalPresenceReport | null;
  currency: string;
}

const QUICK_AI_CHIPS = [
  { label: "24h Briefing", prompt: "Give me a crisp 24h executive briefing across inbox, leads, pipeline & social" },
  { label: "Hot Leads", prompt: "Which hot leads haven't we replied to yet? Queue follow-ups" },
  { label: "Stalled Deals", prompt: "Audit our stalled deals and suggest immediate next moves" },
  { label: "Buffer ROI", prompt: "How is our Buffer social presence driving WhatsApp leads?" },
];

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function buildLast7Days(series: ConversationsSeriesPoint[] | null) {
  const byDay = new Map<string, { incoming: number; outgoing: number }>();
  for (const pt of series ?? []) {
    byDay.set(pt.day, { incoming: pt.incoming, outgoing: pt.outgoing });
  }
  const today = new Date();
  const days: Array<{
    key: string;
    weekday: string;
    dayNum: string;
    incoming: number;
    outgoing: number;
    isToday: boolean;
  }> = [];
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(today);
    d.setDate(today.getDate() - offset);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const match = byDay.get(key) ?? { incoming: 0, outgoing: 0 };
    days.push({
      key,
      weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
      dayNum: String(d.getDate()),
      incoming: match.incoming,
      outgoing: match.outgoing,
      isToday: offset === 0,
    });
  }
  return days;
}

/**
 * Reference-inspired mobile-first executive home hero:
 *  1. Sculptural dark wave command header + floating "Ask Jarvis Anything..."
 *     capsule bar with instant inline executive answer & scrollable prompt pills.
 *  2. 7-day interactive conversation pulse strip (high-contrast active vertical pill).
 *  3. Horizontal snap-scroll showcase carousel cards (featured obsidian Jarvis card
 *     + soft elevated Inbox, Pipeline & Omnichannel Buffer cards).
 */
export function MobileHomeHero({
  metrics,
  series7d,
  jarvis,
  presence,
  currency,
}: MobileHomeHeroProps) {
  const t = useTranslations("Dashboard.mobileHero");
  const { profile } = useAuth();
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState(6);

  const firstName =
    profile?.full_name?.trim().split(/\s+/)[0] ||
    profile?.email?.split("@")[0] ||
    "there";

  const days = useMemo(() => buildLast7Days(series7d), [series7d]);
  const activeDay = days[selectedDayIndex] ?? days[days.length - 1];

  const askJarvis = async (promptOverride?: string) => {
    const text = (promptOverride ?? query).trim();
    if (!text || asking) return;
    setAsking(true);
    setQuery("");
    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Jarvis could not answer right now");
        return;
      }
      setAnswer(String(json.assistantMessage?.content ?? ""));
      if (Array.isArray(json.proposedActions) && json.proposedActions.length > 0) {
        toast.success(
          `Jarvis queued ${json.proposedActions.length} action(s) for approval`,
        );
      }
    } catch {
      toast.error("Network error talking to Jarvis");
    } finally {
      setAsking(false);
    }
  };

  const agentName = jarvis?.config?.agent_name || "Jarvis";
  const healthScore = jarvis?.ecosystem?.healthScore ?? null;

  return (
    <section className="space-y-4">
      {/* 1. Sculptural Wave Hero + Floating Ask-Jarvis Pill Bar */}
      <div className="hero-wave-surface relative overflow-hidden rounded-[28px] border border-border/80 bg-[#14161f] p-5 text-white shadow-[0_18px_45px_-16px_rgba(0,0,0,0.55)]">
        {/* Topographic wave SVG accent (inspired by Modern To-Dos reference) */}
        <svg
          aria-hidden
          viewBox="0 0 400 180"
          className="pointer-events-none absolute -right-10 -top-6 h-48 w-80 opacity-20"
          fill="none"
        >
          <path
            d="M10 140 C 80 60, 180 180, 260 80 C 310 20, 360 50, 410 10"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M0 160 C 90 80, 190 190, 275 95 C 325 40, 370 70, 415 35"
            stroke="currentColor"
            strokeWidth="1"
          />
          <path
            d="M25 180 C 110 100, 200 200, 290 115 C 340 65, 385 95, 420 65"
            stroke="currentColor"
            strokeWidth="0.8"
          />
        </svg>

        <div className="relative z-10 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-white/65">
              {getTimeGreeting()}, {firstName}
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
              {t("headline")}
            </h2>
          </div>
          <Link
            href="/jarvis"
            className="tap-press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold backdrop-blur-md hover:bg-white/15"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            {healthScore !== null ? `${agentName} · ${healthScore}/100` : `${agentName} 24/7`}
          </Link>
        </div>

        {/* Floating Capsule "Ask Jarvis Anything..." Bar (App Design reference) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void askJarvis();
          }}
          className="relative z-10 mt-4 flex items-center gap-2 rounded-full border border-white/15 bg-white/95 p-1.5 pl-4 text-zinc-900 shadow-lg dark:bg-zinc-900/95 dark:text-white"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("askPlaceholder", { name: agentName })}
            disabled={asking}
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-zinc-500 focus:outline-none dark:placeholder:text-zinc-400"
          />
          <button
            type="submit"
            disabled={asking || !query.trim()}
            aria-label={t("askSubmit")}
            className="tap-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-opacity disabled:opacity-45"
          >
            {asking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
          </button>
        </form>

        {/* Horizontally Scrollable Quick-Prompt Pills */}
        <div className="no-scrollbar relative z-10 mt-3 flex gap-2 overflow-x-auto pb-0.5">
          {QUICK_AI_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={asking}
              onClick={() => void askJarvis(chip.prompt)}
              className="tap-press shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm transition-colors hover:bg-white/20 disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Instant Inline Jarvis Executive Reply */}
        {answer && (
          <div className="relative z-10 mt-3.5 rounded-2xl border border-white/15 bg-black/35 p-3.5 text-xs leading-relaxed text-white/95 backdrop-blur-md">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
                <BrainCircuit className="h-3.5 w-3.5" />
                {agentName}
              </span>
              <div className="flex items-center gap-2">
                <Link
                  href="/jarvis"
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Open Console →
                </Link>
                <button
                  type="button"
                  onClick={() => setAnswer(null)}
                  aria-label="Dismiss reply"
                  className="rounded-full p-0.5 text-white/60 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <p className="whitespace-pre-wrap">{answer}</p>
          </div>
        )}
      </div>

      {/* 2. 7-Day Interactive Conversation Pulse Strip (Mobile-Focused, Modern To-Dos / DailyLoop style) */}
      <div className="rounded-[24px] border border-border bg-card p-3.5 shadow-xs lg:hidden">
        <div className="mb-2.5 flex items-center justify-between px-1">
          <p className="text-xs font-semibold text-foreground">
            {t("weeklyPulse")}
          </p>
          {activeDay && (
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {activeDay.incoming} in · {activeDay.outgoing} out
            </span>
          )}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d, idx) => {
            const active = idx === selectedDayIndex;
            const total = d.incoming + d.outgoing;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelectedDayIndex(idx)}
                className={cn(
                  "tap-press flex flex-col items-center justify-center rounded-[18px] py-2 transition-all",
                  active
                    ? "bg-foreground text-background shadow-md"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                <span className="text-[10px] font-medium opacity-75">
                  {d.weekday.slice(0, 3)}
                </span>
                <span className="mt-0.5 text-sm font-bold tabular-nums">
                  {d.dayNum}
                </span>
                <span
                  className={cn(
                    "mt-1 h-1.5 w-1.5 rounded-full",
                    active
                      ? "bg-primary"
                      : total > 0
                        ? "bg-primary/60"
                        : "bg-transparent",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Horizontal Snap-Scroll Showcase Cards on Mobile (Modern To-Dos reference) */}
      <div className="lg:hidden">
        <div className="mb-2.5 flex items-center justify-between px-0.5">
          <h3 className="text-sm font-bold tracking-tight text-foreground">
            {t("liveWorkspaces")}
          </h3>
          <Link
            href="/marketing"
            className="text-xs font-medium text-primary hover:underline"
          >
            {t("exploreAll")}
          </Link>
        </div>

        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
          {/* Card 1: Featured High-Contrast Dark Jarvis Card */}
          <Link
            href="/jarvis"
            className="tap-press hero-wave-surface flex w-[76vw] max-w-[270px] shrink-0 snap-start flex-col justify-between rounded-[24px] border border-primary/30 bg-[#181b26] p-4 text-white shadow-md"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-zinc-900">
                <BrainCircuit className="h-5 w-5" />
              </div>
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                {jarvis?.config?.is_enabled ? "24/7 ONLINE" : "STANDBY"}
              </span>
            </div>
            <div className="mt-5">
              <p className="text-base font-bold tracking-tight">
                {agentName} AI
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/70">
                {jarvis?.ecosystem
                  ? `Health ${jarvis.ecosystem.healthScore}/100 · ${jarvis.todayStats?.pendingApprovals ?? 0} pending approvals`
                  : "Autonomous 24/7 ecosystem employee & Knowledge Hub"}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[11px] font-medium text-white/60">
                Typing Sim {jarvis?.config?.typing_simulation_enabled ? "ON" : "OFF"}
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-900">
                <ChevronRight className="h-4 w-4" />
              </span>
            </div>
          </Link>

          {/* Card 2: Soft Tinted WhatsApp Inbox Card */}
          <Link
            href="/inbox"
            className="tap-press flex w-[72vw] max-w-[255px] shrink-0 snap-start flex-col justify-between rounded-[24px] border border-border bg-card p-4 shadow-xs"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                Live Inbox
              </span>
            </div>
            <div className="mt-5">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {metrics?.activeConversations.current.toLocaleString() ?? "—"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Active conversations · {metrics?.messagesSentToday.current ?? 0} sent today
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-primary">
                Open WhatsApp
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
                <ChevronRight className="h-4 w-4" />
              </span>
            </div>
          </Link>

          {/* Card 3: Sales Pipeline Revenue Card */}
          <Link
            href="/pipelines"
            className="tap-press flex w-[72vw] max-w-[255px] shrink-0 snap-start flex-col justify-between rounded-[24px] border border-border bg-card p-4 shadow-xs"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-500">
                <DollarSign className="h-5 w-5" />
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-500">
                {metrics?.openDealsCount ?? 0} open
              </span>
            </div>
            <div className="mt-5">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {metrics ? formatCurrency(metrics.openDealsValue, currency) : "—"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Open pipeline value across active stages
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-foreground">
                Manage Deals
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
                <ChevronRight className="h-4 w-4" />
              </span>
            </div>
          </Link>

          {/* Card 4: Omnichannel Buffer Presence Card */}
          <Link
            href="/marketing?tab=presence"
            className="tap-press flex w-[72vw] max-w-[255px] shrink-0 snap-start flex-col justify-between rounded-[24px] border border-border bg-card p-4 shadow-xs"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-400">
                <Globe className="h-5 w-5" />
              </div>
              <span className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-sky-400">
                {presence?.connected
                  ? `${presence.totals.connectedChannels} channels`
                  : "Buffer API"}
              </span>
            </div>
            <div className="mt-5">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {presence?.connected ? `${presence.presenceScore}/100` : "Connect"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {presence?.connected
                  ? `${presence.totals.impressions.toLocaleString()} impressions · ${presence.totals.socialDrivenWaLeads} WA leads`
                  : "Unify IG, LinkedIn, FB, X & TikTok with WhatsApp"}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-sky-400">
                Omnichannel Studio
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
                <ChevronRight className="h-4 w-4" />
              </span>
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
}
