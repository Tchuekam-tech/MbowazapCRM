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
