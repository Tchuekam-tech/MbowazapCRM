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
