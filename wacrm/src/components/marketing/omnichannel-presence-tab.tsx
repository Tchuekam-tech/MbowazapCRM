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
