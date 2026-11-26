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

  const qrSvg = useMemo(() => {
    if (!qrLink) return '';
    try {
      return renderQrSvg(`${origin}/go/${qrLink.slug}`, { sizePx: 240 });
    } catch {
      return '';
    }
  }, [qrLink, origin]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error('Please enter a campaign name and destination WhatsApp number.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/marketing/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: slug || undefined,
          destination_phone: phone,
          prefill_message: prefill,
          utm_source: utmSource || undefined,
          utm_medium: 'whatsapp',
          utm_campaign: utmCampaign || undefined,
          auto_tag_id: autoTagId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create growth link');
        return;
      }
      toast.success('Click-to-WhatsApp Growth Link created!');
      setName('');
      setSlug('');
      setUtmCampaign('');
      onRefresh();
    } catch {
      toast.error('Network error while creating link');
    } finally {
      setCreating(false);
    }
  }
