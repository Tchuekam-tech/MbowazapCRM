'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Clock,
  Plus,
  Trash2,
  Play,
  Pause,
  Users,
  Moon,
  MessageSquareReply,
  Loader2,
  GitBranchPlus,
} from 'lucide-react';
import type {
  DripSequence,
  DripSequenceStep,
  MarketingSegment,
  PromoCoupon,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

interface DripSequencesTabProps {
  sequences: DripSequence[];
  segments: MarketingSegment[];
  coupons: PromoCoupon[];
  canEdit: boolean;
  onRefresh: () => void;
}

const DEFAULT_STEPS: DripSequenceStep[] = [
  {
    step_order: 1,
    delay_minutes: 0,
    message_type: 'text',
    content_text:
      'Hi {{first_name}} 👋 Thanks for reaching out! Are you still exploring our plans? Reply YES for a quick custom quote.',
  },
  {
    step_order: 2,
    delay_minutes: 1440,
    message_type: 'text',
    content_text:
      'Hey {{first_name}} ✨ Just following up — our clients typically see results in week 1. Want me to hold a spot for you?',
  },
  {
    step_order: 3,
    delay_minutes: 4320,
    message_type: 'text',
    content_text:
      'Final reminder {{first_name}}: use promo code *{{coupon}}* before it expires to lock in your special discount!',
  },
];
