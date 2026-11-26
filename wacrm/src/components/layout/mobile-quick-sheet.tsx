"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  BookOpen,
  BrainCircuit,
  Briefcase,
  GitBranch,
  Globe,
  Link2,
  Loader2,
  Menu,
  Play,
  Radio,
  Settings,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMobileChrome } from "./mobile-chrome-context";

interface MobileQuickSheetProps {
  onOpenSidebar: () => void;
}

export function MobileQuickSheet({ onOpenSidebar }: MobileQuickSheetProps) {
  const { quickSheetOpen, setQuickSheetOpen } = useMobileChrome();
  const router = useRouter();
  const t = useTranslations("MobileDock");
  const [scanning, setScanning] = useState(false);

  if (!quickSheetOpen) return null;

  const close = () => setQuickSheetOpen(false);

  const handleRunJarvisScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/jarvis/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not start Jarvis scan");
        return;
      }
      toast.success(
        `Jarvis scan complete — Ecosystem Health ${data.run?.health_score ?? "—"}/100`,
      );
      close();
      router.push("/jarvis?tab=actions");
    } catch {
      toast.error("Network error running Jarvis scan");
    } finally {
      setScanning(false);
    }
  };

  const quickTiles = [
    {
      href: "/jarvis",
      label: t("sheetAskJarvis"),
      sub: t("sheetAskJarvisSub"),
      icon: Sparkles,
      featured: true,
    },
    {
      href: "/jarvis?tab=knowledge",
      label: t("sheetKnowledge"),
      sub: t("sheetKnowledgeSub"),
      icon: BookOpen,
      featured: false,
    },
    {
      href: "/contacts",
      label: t("sheetContact"),
      sub: t("sheetContactSub"),
      icon: UserPlus,
      featured: false,
    },
    {
      href: "/pipelines",
      label: t("sheetDeal"),
      sub: t("sheetDealSub"),
      icon: Briefcase,
      featured: false,
    },
    {
      href: "/marketing?tab=links",
      label: t("sheetGrowthLink"),
      sub: t("sheetGrowthLinkSub"),
      icon: Link2,
      featured: false,
    },
    {
      href: "/marketing?tab=presence",
      label: t("sheetOmnichannel"),
      sub: t("sheetOmnichannelSub"),
      icon: Globe,
      featured: false,
    },
    {
      href: "/broadcasts/new",
      label: t("sheetBroadcast"),
      sub: t("sheetBroadcastSub"),
      icon: Radio,
      featured: false,
    },
    {
      href: "/settings",
      label: t("sheetSettings"),
      sub: t("sheetSettingsSub"),
      icon: Settings,
      featured: false,
    },
  ];

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
      {/* Blurred backdrop */}
      <button
        type="button"
        aria-label={t("closeActions")}
        onClick={close}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm animate-in fade-in duration-150"
      />

      {/* Tactile Rounded Sheet */}
      <div
        className="relative z-10 mx-3 mb-24 overflow-hidden rounded-[28px] border border-border bg-card p-5 shadow-2xl animate-in slide-in-from-bottom-6 duration-200"
        style={{ marginBottom: "calc(5.2rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />

        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold tracking-tight text-foreground">
              {t("sheetTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("sheetSubtitle")}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("closeActions")}
            className="tap-press flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 1-Tap Jarvis Autonomous Scan Pill */}
        <button
          type="button"
          onClick={() => void handleRunJarvisScan()}
          disabled={scanning}
          className="tap-press hero-wave-surface mb-3.5 flex w-full items-center justify-between rounded-[20px] border border-primary/30 bg-foreground px-4 py-3.5 text-left text-background shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              {scanning ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <BrainCircuit className="h-5 w-5" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">{t("sheetRunScan")}</p>
              <p className="text-[11px] opacity-75">{t("sheetRunScanSub")}</p>
            </div>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/15">
            <Play className="h-3.5 w-3.5" />
          </span>
        </button>

        {/* 2-Column Tactile Action Grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {quickTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link
                key={tile.href}
                href={tile.href}
                onClick={close}
                className={cn(
                  "tap-press flex items-center gap-2.5 rounded-[18px] border p-3 transition-colors",
                  tile.featured
                    ? "border-primary/30 bg-primary/10 text-foreground"
                    : "border-border bg-muted/35 text-foreground hover:bg-muted/60",
                )}
              >
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    tile.featured
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-foreground shadow-xs",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{tile.label}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {tile.sub}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Footer row to open full sidebar drawer (Automations, Flows, Agents, Pipelines) */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <Link
            href="/pipelines"
            onClick={close}
            className="tap-press inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground"
          >
            <GitBranch className="h-3.5 w-3.5 text-primary" />
            Pipelines
          </Link>
          <button
            type="button"
            onClick={() => {
              close();
              onOpenSidebar();
            }}
            className="tap-press inline-flex items-center gap-1.5 rounded-full bg-muted px-3.5 py-1.5 text-xs font-semibold text-foreground"
          >
            <Menu className="h-3.5 w-3.5" />
            {t("sheetAllMenu")}
          </button>
        </div>
      </div>
    </div>
  );
}
