"use client"

import Link from 'next/link'
import { useState } from 'react'
import {
  MessageSquare,
  UserPlus,
  Briefcase,
  Radio,
  Zap,
  Inbox,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { ActivityItem, ActivityKind } from '@/lib/dashboard/types'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ActivityFeedProps {
  items: ActivityItem[] | null
  loading: boolean
}

const PAGE_SIZES = [5, 10, 20, 50] as const
type PageSize = (typeof PAGE_SIZES)[number]

interface KindTheme {
  icon: ComponentType<{ className?: string }>
  /** Tailwind classes for the round icon badge + label color. */
  badge: string
}

const KIND_THEME: Record<ActivityKind, KindTheme> = {
  message: { icon: MessageSquare, badge: 'bg-blue-500/10 text-blue-400' },
  contact: { icon: UserPlus, badge: 'bg-primary/10 text-primary' },
  deal: { icon: Briefcase, badge: 'bg-primary/10 text-primary' },
  broadcast: { icon: Radio, badge: 'bg-amber-500/10 text-amber-400' },
  automation: { icon: Zap, badge: 'bg-rose-500/10 text-rose-400' },
}

import { useTranslations } from 'next-intl'

export function ActivityFeed({ items, loading }: ActivityFeedProps) {
  const t = useTranslations('Dashboard.activityFeed')
  // Start at 5 — a quick scan of the most recent events without
  // dominating vertical real estate. User expands explicitly via the
  // footer control when they want deeper history.
  const [pageSize, setPageSize] = useState<PageSize>(5)
  const [kindFilter, setKindFilter] = useState<'all' | 'message' | 'contact' | 'deal'>('all')

  const filtered = (items ?? []).filter((it) =>
    kindFilter === 'all' ? true : it.kind === kindFilter,
  )
  const totalLoaded = filtered.length
  const visible = filtered.slice(0, pageSize)
  // A size option is "useful" if picking it would reveal rows the
  // smaller option doesn't already show. With PAGE_SIZES=[5,10,20,50]:
  // "10" is useful only once we've loaded ≥6 items, "20" once ≥11, etc.
  // The smallest option is always enabled.
  const isSizeUseful = (size: PageSize, i: number) =>
    i === 0 || totalLoaded > PAGE_SIZES[i - 1]

  const filterPills: Array<{ id: 'all' | 'message' | 'contact' | 'deal'; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'message', label: 'Messages' },
    { id: 'contact', label: 'Leads' },
    { id: 'deal', label: 'Deals' },
  ]

  return (
    <section className="rounded-[24px] border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5 sm:px-5 sm:py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full bg-muted p-0.5">
            {filterPills.map((fp) => (
              <button
                key={fp.id}
                type="button"
                onClick={() => setKindFilter(fp.id)}
                className={cn(
                  'tap-press rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all',
                  kindFilter === fp.id
                    ? 'bg-foreground text-background shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {fp.label}
              </button>
            ))}
          </div>
          <Link
            href="/inbox"
            className="hidden text-xs font-medium text-primary hover:text-primary/80 sm:inline"
          >
            {t('viewAll')}
          </Link>
        </div>
      </header>

      {loading || !items ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={Inbox}
            title={t('noActivity')}
            hint={t('noActivityHint')}
          />
        </div>
      ) : (
        <>
          <ul className="relative px-4 py-2 sm:divide-y sm:divide-border sm:px-0 sm:py-0">
            {visible.map((it, i) => {
              const theme = KIND_THEME[it.kind]
              const Icon = theme.icon
              const isLast = i === visible.length - 1
              // Alternating row background on desktop; clean timeline cards on mobile.
              const stripe = i % 2 === 0 ? 'sm:bg-transparent' : 'sm:bg-muted/40'
              const row = (
                <div className="flex items-center gap-3 py-2.5 sm:px-5">
                  {/* Vertical timeline rail node on mobile (Modern To-Dos reference) */}
                  <div className="relative flex flex-col items-center sm:hidden">
                    <span
                      className={cn(
                        'z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card',
                        theme.badge,
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    {!isLast && (
                      <span
                        aria-hidden
                        className="absolute top-8 h-7 w-[1.5px] bg-border"
                      />
                    )}
                  </div>
                  <span
                    className={cn(
                      'hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-full sm:flex',
                      theme.badge,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {it.text}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
                    {relativeTime(it.at, t)}
                  </span>
                </div>
              )
              return (
                <li key={it.id} className={cn(stripe, 'tap-press rounded-2xl transition-colors hover:bg-muted/40 sm:rounded-none')}>
                  {it.href ? (
                    <Link href={it.href} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              )
            })}
          </ul>
          <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-xs">
            <span className="text-muted-foreground tabular-nums">
              {t('showingOf', { visible: visible.length, totalLoaded, plus: totalLoaded === 50 ? '+' : '' })}
            </span>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-muted-foreground">{t('show')}</span>
              {PAGE_SIZES.map((size, i) => {
                const disabled = !isSizeUseful(size, i)
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setPageSize(size)}
                    disabled={disabled}
                    className={cn(
                      'rounded-md px-2 py-1 font-medium tabular-nums transition-colors',
                      pageSize === size
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
                    )}
                  >
                    {size}
                  </button>
                )
              })}
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

function relativeTime(iso: string, t: ReturnType<typeof useTranslations>): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return t('timeS', { sec: Math.max(1, diffSec) })
  if (diffSec < 3600) return t('timeM', { min: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return t('timeH', { hr: Math.floor(diffSec / 3600) })
  if (diffSec < 2_592_000) return t('timeD', { day: Math.floor(diffSec / 86400) })
  return new Date(iso).toLocaleDateString()
}
