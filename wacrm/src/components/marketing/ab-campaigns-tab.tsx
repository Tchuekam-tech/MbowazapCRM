'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Sparkles,
  FlaskConical,
  Trophy,
  Send,
  ShieldCheck,
  AlertTriangle,
  Trash2,
  Loader2,
} from 'lucide-react';
import type { AbCampaign, MarketingSegment, PromoCoupon } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { lintWhatsAppCopy, type AbWinnerVerdict } from '@/lib/marketing/copywriter';
