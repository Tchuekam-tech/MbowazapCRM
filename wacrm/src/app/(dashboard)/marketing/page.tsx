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
