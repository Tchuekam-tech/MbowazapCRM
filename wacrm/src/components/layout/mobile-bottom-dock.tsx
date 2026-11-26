"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BrainCircuit,
  Home,
  MessageSquare,
  Plus,
  Rocket,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useMobileChrome } from "./mobile-chrome-context";

interface DockItem {
  href: string;
  labelKey: string;
  icon: typeof Home;
}

const DOCK_ITEMS: DockItem[] = [
  { href: "/dashboard", labelKey: "home", icon: Home },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
  { href: "/jarvis", labelKey: "jarvis", icon: BrainCircuit },
  { href: "/marketing", labelKey: "growth", icon: Rocket },
];

/**
 * Floating pill navigation dock + detached circular `+` action orb
 * for mobile viewports (<lg).
 *
 * Design principles:
 *  - Floating frosted capsule anchored above the bottom safe-area inset
 *  - Active tab smoothly expands into a high-contrast solid pill with
 *    both icon & label; inactive tabs remain sleek compact icon targets
 *  - Standalone circular `+` FAB beside the capsule opens the thumb-zone
 *    Quick Action Sheet (Ask Jarvis, Run Scan, New Contact/Deal/Link/etc.)
 *  - Automatically hides when an Inbox conversation thread is open so
 *    the composer sits flush above the mobile keyboard.
 */
export function MobileBottomDock() {
  const pathname = usePathname();
  const t = useTranslations("MobileDock");
  const totalUnread = useTotalUnread();
  const { hideMobileDock, quickSheetOpen, toggleQuickSheet } = useMobileChrome();

  if (hideMobileDock) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex items-center justify-center gap-2.5 px-4 lg:hidden"
      style={{ bottom: "max(0.85rem, env(safe-area-inset-bottom))" }}
    >
      {/* Floating Capsule Navigation Pill */}
      <nav
        aria-label={t("navLabel")}
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/80 bg-card/90 p-1.5 shadow-[0_14px_38px_-10px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      >
        {DOCK_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          const Icon = item.icon;
          const showUnread = item.href === "/inbox" && totalUnread > 0;
          const isJarvis = item.href === "/jarvis";

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "tap-press relative flex h-11 items-center justify-center gap-1.5 rounded-full transition-all duration-200",
                isActive
                  ? "bg-foreground px-4 text-background shadow-sm"
                  : "w-11 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              <span className="relative flex items-center justify-center">
                <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.25 : 2} />
                {showUnread && (
                  <span
                    className={cn(
                      "absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary text-primary-foreground ring-2 ring-card",
                    )}
                  >
                    {totalUnread > 9 ? "9+" : totalUnread}
                  </span>
                )}
                {isJarvis && !isActive && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                )}
              </span>
              {isActive && (
                <span className="text-xs font-semibold tracking-tight">
                  {t(item.labelKey)}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Detached Circular Quick-Action Orb (+) */}
      <button
        type="button"
        onClick={toggleQuickSheet}
        aria-expanded={quickSheetOpen}
        aria-label={quickSheetOpen ? t("closeActions") : t("quickActions")}
        className={cn(
          "tap-press pointer-events-auto flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full shadow-[0_14px_34px_-8px_rgba(0,0,0,0.5)] transition-all duration-200",
          quickSheetOpen
            ? "rotate-45 bg-primary text-primary-foreground"
            : "bg-foreground text-background hover:opacity-95",
        )}
      >
        {quickSheetOpen ? (
          <X className="h-5 w-5 -rotate-45" />
        ) : (
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        )}
      </button>
    </div>
  );
}
