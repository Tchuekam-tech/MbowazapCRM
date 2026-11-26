'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Link2,
  QrCode,
  Copy,
  Check,
  Plus,
  Trash2,
  Download,
  ExternalLink,
  MousePointerClick,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import type { GrowthLink, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
