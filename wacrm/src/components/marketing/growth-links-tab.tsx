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

  async function handleToggle(link: GrowthLink) {
    try {
      const res = await fetch('/api/marketing/links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: link.id, is_active: !link.is_active }),
      });
      if (!res.ok) throw new Error();
      onRefresh();
    } catch {
      toast.error('Could not update link state');
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/marketing/links?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      toast.success('Growth link deleted');
      onRefresh();
    } catch {
      toast.error('Failed to delete link');
    }
  }

  function handleCopy(link: GrowthLink) {
    const url = `${origin}/go/${link.slug}`;
    void navigator.clipboard.writeText(url);
    setCopiedId(link.id);
    toast.success('Short link copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleDownloadQr() {
    if (!qrLink || !qrSvg) return;
    const blob = new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mbowazap-qr-${qrLink.slug}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Create Growth Link Card */}
      <form
        onSubmit={handleCreate}
        className="space-y-4 rounded-xl border border-border bg-card p-5 lg:col-span-5"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Link2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              New Click-to-WhatsApp Link & QR
            </h2>
            <p className="text-xs text-muted-foreground">
              Track ad clicks, auto-tag leads & generate scannable QR codes.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="gl-name" className="text-xs">Campaign Name</Label>
            <Input
              id="gl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Instagram Bio Flash Offer"
              className="mt-1"
              required
            />
          </div>
