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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="gl-phone" className="text-xs">WhatsApp Number (E.164)</Label>
              <Input
                id="gl-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="237653683174"
                className="mt-1 font-mono text-xs"
                required
              />
            </div>
            <div>
              <Label htmlFor="gl-slug" className="text-xs">Custom Slug (optional)</Label>
              <Input
                id="gl-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="ig-vip-offer"
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="gl-prefill" className="text-xs">Pre-filled WhatsApp Message</Label>
            <Textarea
              id="gl-prefill"
              value={prefill}
              onChange={(e) => setPrefill(e.target.value)}
              rows={2}
              className="mt-1 text-xs"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              A compact [Ref:CODE] tag is appended automatically for 100% attribution.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="gl-source" className="text-xs">UTM Source / Channel</Label>
              <select
                id="gl-source"
                value={utmSource}
                onChange={(e) => setUtmSource(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground"
              >
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="facebook_ads">Facebook Ads</option>
                <option value="google_ads">Google Ads</option>
                <option value="qr_flyer">Print / QR Flyer</option>
                <option value="website">Website Widget</option>
                <option value="youtube">YouTube</option>
              </select>
            </div>
            <div>
              <Label htmlFor="gl-campaign" className="text-xs">UTM Campaign</Label>
              <Input
                id="gl-campaign"
                value={utmCampaign}
                onChange={(e) => setUtmCampaign(e.target.value)}
                placeholder="black-friday-2026"
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="gl-tag" className="text-xs">Auto-Apply Contact Tag on Arrival</Label>
            <select
              id="gl-tag"
              value={autoTagId}
              onChange={(e) => setAutoTagId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground"
            >
              <option value="">None</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button type="submit" disabled={!canEdit || creating} className="w-full">
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Create Growth Link & QR
        </Button>
      </form>

      {/* Links List */}
      <div className="space-y-3 lg:col-span-7">
        {links.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-6 text-center">
            <QrCode className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No Growth Links yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Create tracked /go/ links and scannable QR codes for Instagram, TikTok, ads, and storefronts to capture and attribute WhatsApp leads automatically.
            </p>
          </div>
        ) : (
          links.map((link) => {
            const convRate =
              link.clicks_count > 0
                ? Math.round((link.conversions_count / link.clicks_count) * 100)
                : 0;
            const shortUrl = `${origin}/go/${link.slug}`;
            return (
              <div
                key={link.id}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {link.name}
                      </h3>
                      {link.utm_source && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase text-primary">
                          {link.utm_source}
                        </span>
                      )}
                      {link.ref_code && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          Ref:{link.ref_code}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate font-mono">{shortUrl}</span>
                      <a
                        href={`/go/${link.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                        title="Test redirect"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={link.is_active}
                      disabled={!canEdit}
                      onCheckedChange={() => handleToggle(link)}
                      aria-label={`Toggle ${link.name}`}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(link)}
                    >
                      {copiedId === link.id ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setQrLink(link)}
                    >
                      <QrCode className="mr-1 h-3.5 w-3.5" />
                      QR
                    </Button>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(link.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
