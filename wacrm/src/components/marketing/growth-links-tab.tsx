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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { renderQrSvg } from '@/lib/marketing/qr-svg';

interface GrowthLinksTabProps {
  links: GrowthLink[];
  tags: Tag[];
  canEdit: boolean;
  onRefresh: () => void;
}

export function GrowthLinksTab({
  links,
  tags,
  canEdit,
  onRefresh,
}: GrowthLinksTabProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [phone, setPhone] = useState('');
  const [prefill, setPrefill] = useState('Hi! I saw your offer and would like to know more.');
  const [utmSource, setUtmSource] = useState('instagram');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [autoTagId, setAutoTagId] = useState('');
  const [creating, setCreating] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState<GrowthLink | null>(null);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';
