'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Globe,
  RefreshCw,
  Sparkles,
  Send,
  KeyRound,
  Unplug,
  CheckCircle2,
  AlertTriangle,
  PauseCircle,
  Link2,
  TicketPercent,
  BarChart3,
  Clock,
  ArrowUpRight,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import type {
  DigitalPresenceReport,
  GrowthLink,
  PromoCoupon,
} from '@/types';
import { formatCurrency } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface OmnichannelPresenceTabProps {
  report: DigitalPresenceReport | null;
  links: GrowthLink[];
  coupons: PromoCoupon[];
  currency: string;
  canEdit: boolean;
  canAdmin: boolean;
  onRefresh: () => void;
  onJumpToLinks: () => void;
}

const SERVICE_STYLE: Record<string, { label: string; badge: string }> = {
  instagram: { label: 'Instagram', badge: 'bg-pink-500/15 text-pink-400 border-pink-500/30' },
  linkedin: { label: 'LinkedIn', badge: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  facebook: { label: 'Facebook', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  twitter: { label: 'X / Twitter', badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  tiktok: { label: 'TikTok', badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  youtube: { label: 'YouTube', badge: 'bg-red-500/15 text-red-400 border-red-500/30' },
  threads: { label: 'Threads', badge: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
  pinterest: { label: 'Pinterest', badge: 'bg-red-500/15 text-red-400 border-red-500/30' },
  bluesky: { label: 'Bluesky', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
};

function serviceMeta(service: string) {
  return (
    SERVICE_STYLE[service.toLowerCase()] ?? {
      label: service.charAt(0).toUpperCase() + service.slice(1),
      badge: 'bg-primary/10 text-primary border-primary/30',
    }
  );
}

export function OmnichannelPresenceTab({
  report,
  links,
  coupons,
  currency,
  canEdit,
  canAdmin,
  onRefresh,
  onJumpToLinks,
}: OmnichannelPresenceTabProps) {
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Cross-channel Composer state
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [postText, setPostText] = useState('');
  const [publishMode, setPublishMode] = useState<'addToQueue' | 'shareNow'>('addToQueue');
  const [publishing, setPublishing] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) {
      toast.error('Paste your Buffer Personal API Key first.');
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch('/api/marketing/buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not connect Buffer');
      toast.success(
        `Buffer connected! Synced ${data.sync?.channelsSynced ?? 0} channel(s) and ${data.sync?.postsSynced ?? 0} post(s).`
      );
      setApiKey('');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Buffer connection failed');
    } finally {
      setConnecting(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await fetch('/api/marketing/buffer/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      toast.success(
        `Synced ${data.sync?.channelsSynced ?? 0} channel(s) & ${data.sync?.postsSynced ?? 0} post(s) from Buffer.`
      );
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSwitchOrg(orgId: string) {
    setSyncing(true);
    try {
      const res = await fetch('/api/marketing/buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch_org', organization_id: orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Switched Buffer workspace to ${data.sync?.organizationName || orgId}`);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not switch workspace');
    } finally {
      setSyncing(false);
    }
  }

  async function handleRunAudit() {
    setAuditing(true);
    try {
      const res = await fetch('/api/marketing/buffer/audit', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Audit failed');
      toast.success(
        data.audit?.usedAi
          ? 'AI Digital Presence Audit complete!'
          : 'Omnichannel Digital Presence Audit updated!'
      );
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setAuditing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/marketing/buffer', { method: 'DELETE' });
      if (!res.ok) throw new Error('Disconnect failed');
      toast.success('Buffer disconnected and cached social data removed.');
      onRefresh();
    } catch {
      toast.error('Could not disconnect Buffer');
    } finally {
      setDisconnecting(false);
    }
  }

  function toggleChannel(channelId: string) {
    setSelectedChannels((prev) =>
      prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId]
    );
  }

  function injectGrowthLink(link: GrowthLink) {
    const snippet = `\n\n💬 Chat with us on WhatsApp: ${origin}/go/${link.slug}`;
    setPostText((prev) => (prev.trim() ? `${prev.trim()}${snippet}` : snippet.trim()));
  }

  function injectCoupon(coupon: PromoCoupon) {
    const snippet = ` Use code ${coupon.code} for ${
      coupon.discount_type === 'percent'
        ? `${coupon.discount_value}% OFF`
        : `${formatCurrency(coupon.discount_value, coupon.currency)} OFF`
    }!`;
    setPostText((prev) => `${prev}${snippet}`);
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (selectedChannels.length === 0 || !postText.trim()) {
      toast.error('Select at least one social channel and write your post.');
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch('/api/marketing/buffer/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_ids: selectedChannels,
          text: postText.trim(),
          mode: publishMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');
      toast.success(
        publishMode === 'shareNow'
          ? `Published immediately to ${data.succeeded} channel(s)!`
          : `Queued to ${data.succeeded} Buffer channel(s)!`
      );
      setPostText('');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publishing failed');
    } finally {
      setPublishing(false);
    }
  }
