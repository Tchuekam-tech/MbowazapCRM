'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  Eye,
  Keyboard,
  Loader2,
  Play,
  Save,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type {
  JarvisAutonomyMode,
  JarvisConfig,
  JarvisOverviewPayload,
  JarvisTypingSpeedProfile,
} from '@/types/jarvis';

interface JarvisAutonomyTabProps {
  data: JarvisOverviewPayload;
  canEdit: boolean;
  onRefresh: () => Promise<void>;
}

const SPEED_RATES: Record<JarvisTypingSpeedProfile, { cps: number; base: number; label: string }> = {
  fast: { cps: 17, base: 450, label: 'Fast (~95 WPM)' },
  natural: { cps: 10, base: 750, label: 'Natural Human (~55 WPM)' },
  thoughtful: { cps: 6.5, base: 1100, label: 'Thoughtful Concierge (~35 WPM)' },
};

export function JarvisAutonomyTab({
  data,
  canEdit,
  onRefresh,
}: JarvisAutonomyTabProps) {
  const [cfg, setCfg] = useState<JarvisConfig>(data.config);
  const [saving, setSaving] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCfg(data.config);
  }, [data.config]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, []);

  // Live typing preview sandbox
  const [sampleMsg, setSampleMsg] = useState(
    'Hi! Thanks for messaging us — our Pro package is available today with same-day onboarding. Would you like me to reserve a spot for you?'
  );
  const [simPreviewActive, setSimPreviewActive] = useState(false);
  const [simDelivered, setSimDelivered] = useState(false);

  const estimatedTypingMs = useMemo(() => {
    if (!cfg.typing_simulation_enabled || !sampleMsg.trim()) return 0;
    const rate = SPEED_RATES[cfg.typing_speed_profile] ?? SPEED_RATES.natural;
    const raw = rate.base + (sampleMsg.trim().length / rate.cps) * 1000;
    return Math.round(Math.max(cfg.typing_min_ms, Math.min(cfg.typing_max_ms, raw)));
  }, [cfg, sampleMsg]);

  const setField = <K extends keyof JarvisConfig>(key: K, val: JarvisConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: val }));
  };

  const handlePreviewTyping = () => {
    if (!cfg.typing_simulation_enabled) {
      toast.info('Enable Typing Simulation above to preview');
      return;
    }
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    setSimDelivered(false);
    setSimPreviewActive(true);
    const ms = Math.min(4500, Math.max(800, estimatedTypingMs));
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      setSimPreviewActive(false);
      setSimDelivered(true);
    }, ms);
  };

  const handleSave = async () => {
    setSaving(true);
    const clampedMin = Math.max(0, Math.min(15000, Number(cfg.typing_min_ms) || 0));
    const clampedMax = Math.max(
      Math.max(500, clampedMin),
      Math.min(20000, Number(cfg.typing_max_ms) || 500),
    );
    const payload = {
      ...cfg,
      typing_min_ms: clampedMin,
      typing_max_ms: clampedMax,
    };
    try {
      const res = await fetch('/api/jarvis', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Failed to save Jarvis settings');
        return;
      }
      if (json.config) setCfg(json.config);
      toast.success(`${cfg.agent_name} autonomy & typing settings saved!`);
      await onRefresh();
    } catch {
      toast.error('Network error saving Jarvis settings');
    } finally {
      setSaving(false);
    }
  };

  const modes: Array<{
    id: JarvisAutonomyMode;
    title: string;
    desc: string;
    icon: typeof Eye;
  }> = [
    {
      id: 'observer',
      title: 'Observer Only',
      desc: 'Monitors the entire ecosystem 24/7 and writes executive briefings without queuing or executing actions.',
      icon: Eye,
    },
    {
      id: 'copilot',
      title: 'Co-Pilot (Recommended)',
      desc: 'Analyzes 24/7 and prepares ready-to-send WhatsApp follow-ups, deals & social posts for your 1-click approval.',
      icon: Sparkles,
    },
    {
      id: 'autonomous',
      title: 'Full Autonomous 24/7',
      desc: 'Operates as a live 24/7 employee executing enabled capabilities automatically inside your safety guardrails.',
      icon: Zap,
    },
  ];

  const capabilities: Array<{
    key: keyof JarvisConfig;
    label: string;
    desc: string;
  }> = [
    {
      key: 'can_reply_inbound',
      label: '24/7 Inbound Customer Replies',
      desc: 'Answers WhatsApp customers grounded in Company DNA & Knowledge Hub with realistic typing.',
    },
    {
      key: 'can_followup_stale_leads',
      label: 'Proactive Unanswered Lead Follow-ups',
      desc: 'Re-engages unanswered hot & warm leads automatically (respecting quiet hours & human takeovers).',
    },
    {
      key: 'can_manage_deals',
      label: 'Pipeline Deal Creation & Tracking',
      desc: 'Creates open opportunities for Hot leads lacking a deal and monitors stalled pipeline deals.',
    },
    {
      key: 'can_score_and_tag',
      label: 'Behavioral Lead Scoring & Tagging',
      desc: 'Continuously updates 0–100 lead scores and tags priority prospects.',
    },
    {
      key: 'can_publish_social',
      label: 'Omnichannel Buffer Social Publishing',
      desc: 'Queues WhatsApp Growth-Link bridge posts across your connected Buffer social channels.',
    },
    {
      key: 'can_enroll_drips',
      label: 'Drip Sequence Enrollment',
      desc: 'Enrolls qualified leads into your active WhatsApp nurture sequences.',
    },
    {
      key: 'can_alert_team',
      label: 'Team Escalations & SLA Alerts',
      desc: 'Sends real CRM notifications to admins when VIPs wait too long or high-value deals stall.',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Identity & Master 24/7 Toggle */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-primary" />
              24/7 AI Employee Identity & Autonomy Mode
            </CardTitle>
            <CardDescription>
              Name your autonomous employee, toggle 24/7 background cycles, and choose how much freedom it has.
            </CardDescription>
          </div>
          {canEdit && (
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              Save Controls
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Enable 24/7 Autonomous Brain Loop
              </p>
              <p className="text-xs text-muted-foreground">
                When ON, {cfg.agent_name} automatically scans your entire ecosystem every {cfg.cycle_interval_minutes} minutes via the always-on server ticker.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={cfg.is_enabled}
                onChange={(e) => setField('is_enabled', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 accent-primary"
              />
              {cfg.is_enabled ? 'ONLINE 24/7' : 'PAUSED'}
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Employee Name</Label>
              <Input
                value={cfg.agent_name}
                onChange={(e) => setField('agent_name', e.target.value)}
                placeholder="Jarvis"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label>Role / Title</Label>
              <Input
                value={cfg.agent_role}
                onChange={(e) => setField('agent_role', e.target.value)}
                placeholder="24/7 Autonomous Growth & Operations Director"
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {modes.map((m) => {
              const Icon = m.icon;
              const active = cfg.autonomy_mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setField('autonomy_mode', m.id)}
                  className={`rounded-xl border p-3.5 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                    {m.title}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Human Typing Simulation Studio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Keyboard className="h-4 w-4 text-emerald-400" />
            Human-Like Typing Simulation (WhatsApp Presence)
          </CardTitle>
          <CardDescription>
            Shows real WhatsApp &ldquo;typing…&rdquo; presence paced to the actual message length before every AI reply, Jarvis follow-up, and drip step — aborting instantly if a human takes over.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                Simulate Realistic Typing Before Sending Messages
              </p>
              <p className="text-xs text-muted-foreground">
                Sends live <code>composing</code> presence with heartbeat refreshes, waits a natural human duration, then sends <code>paused</code> right as the message lands.
              </p>
            </div>
            <input
              type="checkbox"
              checked={cfg.typing_simulation_enabled}
              onChange={(e) => setField('typing_simulation_enabled', e.target.checked)}
              disabled={!canEdit}
              className="h-4 w-4 accent-primary"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Typing Speed Profile</Label>
              <select
                value={cfg.typing_speed_profile}
                onChange={(e) =>
                  setField('typing_speed_profile', e.target.value as JarvisTypingSpeedProfile)
                }
                disabled={!canEdit || !cfg.typing_simulation_enabled}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="fast">{SPEED_RATES.fast.label}</option>
                <option value="natural">{SPEED_RATES.natural.label}</option>
                <option value="thoughtful">{SPEED_RATES.thoughtful.label}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Minimum Typing Duration (ms)</Label>
              <Input
                type="number"
                min={0}
                max={15000}
                step={200}
                value={cfg.typing_min_ms}
                onChange={(e) => setField('typing_min_ms', Number(e.target.value))}
                disabled={!canEdit || !cfg.typing_simulation_enabled}
              />
            </div>
            <div className="space-y-1">
              <Label>Maximum Typing Duration (ms)</Label>
              <Input
                type="number"
                min={500}
                max={20000}
                step={500}
                value={cfg.typing_max_ms}
                onChange={(e) => setField('typing_max_ms', Number(e.target.value))}
                disabled={!canEdit || !cfg.typing_simulation_enabled}
              />
            </div>
          </div>

          {/* Interactive Live Preview */}
          <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">
                Live Typing Cadence Simulator
              </span>
              <span className="text-xs text-emerald-400">
                Estimated typing time: <strong>{(estimatedTypingMs / 1000).toFixed(1)}s</strong> (
                {sampleMsg.trim().length} chars)
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                value={sampleMsg}
                onChange={(e) => {
                  setSampleMsg(e.target.value);
                  setSimDelivered(false);
                }}
                placeholder="Type a sample WhatsApp reply to preview its typing duration…"
              />
              <Button variant="outline" size="sm" onClick={handlePreviewTyping}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Preview
              </Button>
            </div>
            {simPreviewActive && (
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300">
                <span>{cfg.agent_name} is typing</span>
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:300ms]" />
                </span>
              </div>
            )}
            {simDelivered && !simPreviewActive && (
              <div className="max-w-lg rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2 text-xs text-foreground">
                {sampleMsg}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Capabilities + Guardrails */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-primary" />
              Autonomous Capabilities
            </CardTitle>
            <CardDescription>Choose exactly which actions {cfg.agent_name} can run</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {capabilities.map((cap) => (
              <label
                key={cap.key}
                className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{cap.label}</p>
                  <p className="text-xs text-muted-foreground">{cap.desc}</p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(cfg[cap.key])}
                  onChange={(e) => setField(cap.key, e.target.checked as never)}
                  disabled={!canEdit}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              24/7 Safety Guardrails & Quiet Hours
            </CardTitle>
            <CardDescription>Hard caps that keep automation respectful and brand-safe</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Brain Scan Interval (min)</Label>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={cfg.cycle_interval_minutes}
                  onChange={(e) => setField('cycle_interval_minutes', Number(e.target.value))}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1">
                <Label>Contact Cooldown (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={336}
                  value={cfg.contact_cooldown_hours}
                  onChange={(e) => setField('contact_cooldown_hours', Number(e.target.value))}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1">
                <Label>Max Actions / Day</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={cfg.max_autonomous_actions_per_day}
                  onChange={(e) =>
                    setField('max_autonomous_actions_per_day', Number(e.target.value))
                  }
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1">
                <Label>Max Proactive Messages / Day</Label>
                <Input
                  type="number"
                  min={0}
                  max={200}
                  value={cfg.max_proactive_messages_per_day}
                  onChange={(e) =>
                    setField('max_proactive_messages_per_day', Number(e.target.value))
                  }
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1">
                <Label>Quiet Hours Start (HH:MM)</Label>
                <Input
                  value={cfg.quiet_hours_start}
                  onChange={(e) => setField('quiet_hours_start', e.target.value)}
                  placeholder="21:00"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1">
                <Label>Quiet Hours End (HH:MM)</Label>
                <Input
                  value={cfg.quiet_hours_end}
                  onChange={(e) => setField('quiet_hours_end', e.target.value)}
                  placeholder="08:00"
                  disabled={!canEdit}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Timezone (IANA)</Label>
              <Input
                value={cfg.timezone}
                onChange={(e) => setField('timezone', e.target.value)}
                placeholder="UTC, Africa/Douala, America/New_York, Europe/Paris"
                disabled={!canEdit}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
