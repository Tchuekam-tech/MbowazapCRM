"use client"

import Link from 'next/link'
import { UserPlus, Briefcase, Radio, Rocket } from 'lucide-react'
import type { ComponentType } from 'react'

import { useTranslations } from 'next-intl'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  labelKey: string
  href: string
  icon: ComponentType<{ className?: string }>
  tint: string
}

const ACTIONS: Action[] = [
  { labelKey: 'newContact', href: '/contacts', icon: UserPlus, tint: 'text-primary' },
  { labelKey: 'newDeal', href: '/pipelines', icon: Briefcase, tint: 'text-blue-400' },
  { labelKey: 'newBroadcast', href: '/broadcasts/new', icon: Radio, tint: 'text-amber-400' },
  { labelKey: 'marketingStudio', href: '/marketing', icon: Rocket, tint: 'text-primary' },
]

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions')
  
  return (
    <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:px-0">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="tap-press group flex shrink-0 items-center gap-2.5 rounded-full border border-border bg-card py-2 pl-2 pr-4 shadow-xs transition-colors hover:bg-muted/60 sm:rounded-[20px] sm:px-4 sm:py-3"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-muted sm:h-9 sm:w-9 sm:rounded-xl ${a.tint}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="whitespace-nowrap text-xs font-semibold text-foreground sm:text-sm sm:font-medium">
              {t(a.labelKey as string)}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
