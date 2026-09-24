'use client';

// ============================================================
// MboWazapConfig — Settings → MboWazap (Bot Gateway)
//
// Complete production-grade WhatsApp pairing & companion management
// connecting directly to the real Baileys runtime on TchuekBot.
//
// Explicit 4-state lifecycle:
//   1. Disconnected: "Not connected" → [Connect WhatsApp]
//   2. Pairing: "Connecting..." → Code / QR + live countdown + poll
//      (the QR is re-fetched while on screen: WhatsApp rotates it ~20 s)
//   3. Connected: "Connected" → +237... + Online + Brain selector + [Disconnect]
//      (also while the bot reconnects a linked number)
//   4. Failed: "Connection failed" → Reason + [Try again]
//
// Only this page's own attempt drives the pairing card; a pairing the
// server still has open (e.g. after a reload) shows the connect form with
// a notice, and the page keeps checking whether it completed.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Info,
  Loader2,
  QrCode,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Unplug,
  Zap,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/hooks/use-can';
import { SettingsChip, StatusDot } from './settings-chip';
import { SettingsPanelHead } from './settings-panel-head';

export type MbowazapUIState =
  | 'disconnected'
  | 'pairing'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'expired';

interface StatusResponse {
  ok: boolean;
  status: MbowazapUIState;
  configured: boolean;
  configIssues?: string[];
  provider: 'meta' | 'mbowazap';
  phone: string | null;
  rawPhone?: string | null;
  displayName: string | null;
  brain: 'tchuekbot' | 'wacrm';
  connectedAt: string | null;
  lastSeenAt: string | null;
  pairing?: {
    ref: string;
    expiresAt: string;
  } | null;
  failureReason?: string | null;
  /** Signed ping result; null when the bridge isn't configured. */
  bot?: { reachable: boolean; error: string | null; code: string | null } | null;
}

interface ActivePairingSession {
  method: 'code' | 'qr';
  code?: string;
  qr?: string;
  pairingRef: string;
  expiresAt: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Re-fetch the QR before WhatsApp rotates it (every ~20 s). */
const QR_REFRESH_MS = 15_000;
/** How long a QR pairing keeps refreshing before it gives up. */
const QR_SESSION_MS = 5 * 60_000;
/** Checks for a pairing the server has open that this page didn't start. */
const SERVER_PAIRING_POLL_MS = 4_000;

export function MboWazapConfig() {
  const canEdit = useCan('edit-settings');

  const [loading, setLoading] = useState(true);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);

  // Pairing setup inputs
  const [pairMode, setPairMode] = useState<'code' | 'qr'>('code');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);
  const [activePairing, setActivePairing] = useState<ActivePairingSession | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);

  // Explicit failure / error state
  const [errorState, setErrorState] = useState<{
    failed: boolean;
    reason: string;
  } | null>(null);

  const [qrRefreshing, setQrRefreshing] = useState(false);
  // Pairings the admin cancelled here: the server keeps them open until
  // they expire, but they shouldn't be announced as still pending.
  const [dismissedRefs, setDismissedRefs] = useState<string[]>([]);

  const [copiedCode, setCopiedCode] = useState(false);
  const [switchingBrain, setSwitchingBrain] = useState(false);

  // Disconnect dialog
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Fetch current status from /api/mbowazap/status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/mbowazap/status', { cache: 'no-store' });
      const data: StatusResponse = await res.json();
      if (data.ok) {
        setStatusData(data);
        // A stale or expired pairing on record is not an error to show on
        // arrival; only this page's own attempt reports failures.
        if (data.status === 'connected' || data.status === 'connecting') {
          setActivePairing(null);
          setErrorState(null);
        }
      } else {
        toast.error(
          (data as { error?: string }).error || 'Failed to fetch WhatsApp status'
        );
      }
    } catch (err) {
      console.error('[MboWazapConfig] fetch error:', err);
      toast.error('Network error loading WhatsApp status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [fetchStatus]);

  // 2. Countdown timer for active pairing expiration
  useEffect(() => {
    if (!activePairing?.expiresAt) {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      setSecondsRemaining(0);
      return;
    }

    const targetTime = Date.parse(activePairing.expiresAt);
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((targetTime - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        setErrorState({
          failed: true,
          reason: 'The pairing request expired. WhatsApp links must be confirmed within 2 minutes.',
        });
        setActivePairing(null);
      }
    };

    updateCountdown();
    countdownTimerRef.current = setInterval(updateCountdown, 1000);

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [activePairing]);

  // 3. Real-time short-polling during pairing or connecting state
  useEffect(() => {
    if (!activePairing?.pairingRef) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const ref = activePairing.pairingRef;
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/mbowazap/poll?ref=${encodeURIComponent(ref)}`);
        const json = await res.json();
        const stopPolling = () => {
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        };
        if (json.ok && json.connected) {
          toast.success('WhatsApp connected successfully!');
          setActivePairing(null);
          setErrorState(null);
          stopPolling();
          fetchStatus();
        } else if (json.ok && (json.state === 'failed' || json.state === 'logged_out')) {
          setErrorState({
            failed: true,
            reason: 'WhatsApp connection attempt was rejected or closed by the device.',
          });
          setActivePairing(null);
          stopPolling();
        } else if (json.ok && json.state === 'expired') {
          // The account's pairing ref changed under us: another pairing
          // was started (another tab or admin), or it was disconnected.
          setErrorState({
            failed: true,
            reason: 'This pairing was replaced by a newer one (another tab or admin). Start again here if needed.',
          });
          setActivePairing(null);
          stopPolling();
        }
      } catch {
        // Ignore transient network errors during background polling
      }
    }, 2000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [activePairing, fetchStatus]);

  // 3b. Keep the QR on screen scannable: WhatsApp rotates it every ~20 s.
  useEffect(() => {
    if (activePairing?.method !== 'qr') return;
    const ref = activePairing.pairingRef;
    let cancelled = false;

    const timer = setInterval(async () => {
      setQrRefreshing(true);
      try {
        const res = await fetch('/api/mbowazap/qr', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pairingRef: ref }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.qr) {
          setActivePairing((prev) =>
            prev && prev.pairingRef === ref ? { ...prev, qr: json.qr } : prev
          );
        } else if (json.code === 'pairing_superseded') {
          setErrorState({
            failed: true,
            reason: 'This pairing was replaced by a newer one (another tab or admin). Start again here if needed.',
          });
          setActivePairing(null);
        }
        // Anything else is transient: keep the current QR and retry.
      } catch {
        // Network blip: the next tick retries.
      } finally {
        if (!cancelled) setQrRefreshing(false);
      }
    }, QR_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activePairing?.method, activePairing?.pairingRef]);

  // 3c. A pairing the server has open that this page didn't start (page
  // reloaded while the phone was confirming): notice when it completes.
  const serverPairingRef =
    !activePairing && statusData?.status === 'pairing'
      ? (statusData.pairing?.ref ?? null)
      : null;
  useEffect(() => {
    if (!serverPairingRef) return;
    const timer = setInterval(fetchStatus, SERVER_PAIRING_POLL_MS);
    return () => clearInterval(timer);
  }, [serverPairingRef, fetchStatus]);

  // 4. Initiate Pairing
  async function handleStartPairing() {
    if (!canEdit) return;
    setPairingLoading(true);
    setErrorState(null);

    try {
      const res = await fetch('/api/mbowazap/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: pairMode,
          phone: pairMode === 'code' ? phoneNumber : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to request pairing code');
      }

      if (json.status === 'connected') {
        // The bot still held this account's link; nothing to confirm.
        toast.success('WhatsApp is connected.');
        fetchStatus();
        return;
      }

      setActivePairing({
        method: json.method,
        code: json.code,
        qr: json.qr,
        pairingRef: json.pairingRef,
        // A QR pairing is kept alive by refreshing; give it a fixed budget.
        expiresAt:
          json.method === 'qr'
            ? new Date(Date.now() + QR_SESSION_MS).toISOString()
            : json.expiresAt,
      });

      if (json.method === 'code') {
        toast.info('Pairing code generated! Enter it into WhatsApp on your phone.');
      } else {
        toast.info('QR Code ready! Scan it using WhatsApp on your phone.');
      }
    } catch (err) {
      setErrorState({
        failed: true,
        reason: errorMessage(err, 'Could not communicate with the MboWazap WhatsApp engine.'),
      });
      toast.error(errorMessage(err, 'Pairing request failed'));
    } finally {
      setPairingLoading(false);
    }
  }

  // 5. Brain switch
  async function handleSwitchBrain(newBrain: 'tchuekbot' | 'wacrm') {
    if (!canEdit || switchingBrain || statusData?.brain === newBrain) return;
    setSwitchingBrain(true);
    try {
      const res = await fetch('/api/mbowazap/brain', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brain: newBrain }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to update brain');
      }

      setStatusData((prev) => (prev ? { ...prev, brain: newBrain } : null));
      toast.success(
        newBrain === 'tchuekbot'
          ? 'Davila AI Assistant activated on TchuekBot'
          : 'WACRM Flows & Internal AI Assistant activated'
      );
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to switch brain'));
    } finally {
      setSwitchingBrain(false);
    }
  }

  // 6. Disconnect
  async function handleDisconnect() {
    if (!canEdit || disconnecting) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/mbowazap/disconnect', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to disconnect');
      }

      setShowDisconnectDialog(false);
      setActivePairing(null);
      setErrorState(null);
      if (json.warning) {
        toast.warning(json.warning);
      } else {
        toast.success('WhatsApp session disconnected and credentials purged.');
      }
      fetchStatus();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to disconnect'));
    } finally {
      setDisconnecting(false);
    }
  }

  function handleCopyCode() {
    if (!activePairing?.code) return;
    navigator.clipboard.writeText(activePairing.code);
    setCopiedCode(true);
    toast.success('Pairing code copied to clipboard');
    setTimeout(() => setCopiedCode(false), 2500);
  }

  function handleResetToTryAgain() {
    const refs = [activePairing?.pairingRef, statusData?.pairing?.ref].filter(
      (ref): ref is string => Boolean(ref)
    );
    if (refs.length) setDismissedRefs((prev) => [...prev, ...refs]);
    setActivePairing(null);
    setErrorState(null);
    // Back to the connect form, whatever the last status said.
    setStatusData((prev) =>
      prev && prev.status !== 'connected' && prev.status !== 'connecting'
        ? { ...prev, status: 'disconnected', failureReason: null }
        : prev
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isConfigured = statusData?.configured ?? false;
  const botUnreachable = isConfigured && statusData?.bot?.reachable === false;
  // 'connecting' = linked, and the bot is re-establishing the socket.
  const isReconnecting = statusData?.status === 'connecting';
  const isConnected = statusData?.status === 'connected' || isReconnecting;
  const isPairing = !isConnected && Boolean(activePairing);
  const isFailed = !isConnected && !isPairing && Boolean(errorState?.failed);
  const pendingServerPairing =
    !isConnected &&
    !isPairing &&
    statusData?.status === 'pairing' &&
    Boolean(statusData.pairing?.ref) &&
    !dismissedRefs.includes(statusData.pairing!.ref);

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="MboWazap Gateway (TchuekBot)"
        description="Pair your WhatsApp companion number via Baileys and synchronize chats, contacts, deals, and Davila sales AI with WACRM."
        action={
          <div className="flex items-center gap-2">
            {isReconnecting ? (
              <SettingsChip variant="warn">
                <Loader2 className="size-3 animate-spin text-amber-500" />
                Reconnecting
              </SettingsChip>
            ) : isConnected ? (
              <SettingsChip variant="ok">
                <StatusDot tone="ok" />
                Connected
              </SettingsChip>
            ) : isPairing ? (
              <SettingsChip variant="warn">
                <Loader2 className="size-3 animate-spin text-amber-500" />
                Pairing in progress
              </SettingsChip>
            ) : isFailed ? (
              <SettingsChip variant="warn">
                <StatusDot tone="muted" className="bg-amber-500" />
                Failed
              </SettingsChip>
            ) : (
              <SettingsChip variant="muted">
                <StatusDot tone="muted" />
                Not connected
              </SettingsChip>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchStatus}
              title="Refresh status"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        }
      />

      {/* Bridge Configuration Notice */}
      {!isConfigured && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
          <AlertCircle className="size-5 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="font-semibold">MboWazap Bridge is not configured</AlertTitle>
          <AlertDescription className="mt-2 space-y-2 text-sm leading-relaxed">
            {statusData?.configIssues && statusData.configIssues.length > 0 && (
              <ul className="list-inside list-disc text-xs">
                {statusData.configIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <p>
              Set these variables on the wacrm service (on Railway: the service&apos;s{' '}
              <strong>Variables</strong> tab; locally:{' '}
              <code className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-xs text-foreground">
                .env.local
              </code>
              ), then redeploy:
            </p>
            <div className="rounded-lg bg-background/90 p-3 font-mono text-xs text-foreground border border-border break-all">
              <div>MBOWAZAP_BOT_URL=https://your-tchuekbot.up.railway.app</div>
              <div>MBOWAZAP_SECRET=same_32+_character_secret_as_the_bot</div>
            </div>
            <p className="text-xs text-muted-foreground">
              The bot service needs the same <code className="font-mono">MBOWAZAP_SECRET</code>, plus{' '}
              <code className="font-mono">WACRM_URL</code> set to this CRM&apos;s address so messages
              reach the inbox.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {botUnreachable && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
          <AlertCircle className="size-5 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="font-semibold">TchuekBot is not answering</AlertTitle>
          <AlertDescription className="mt-2 text-sm leading-relaxed">
            {statusData?.bot?.error || 'The bot did not answer a signed ping.'}
          </AlertDescription>
        </Alert>
      )}

      {/* ============================================================ */}
      {/* STATE 1: CONNECTED                                           */}
      {/* ============================================================ */}
      {isConnected && (
        <Card className="border-emerald-500/20 bg-emerald-500/[0.02]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Smartphone className="size-6" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    WhatsApp
                  </div>
                  <CardTitle className="text-xl font-bold tracking-tight text-foreground">
                    {statusData?.phone || 'Connected'}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-0.5">
                    {statusData?.displayName && (
                      <span className="font-medium text-foreground">
                        {statusData.displayName}
                      </span>
                    )}
                    <span>•</span>
                    {isReconnecting ? (
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-amber-500 inline-block animate-pulse" />
                        Status: Reconnecting…
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
                        Status: Online
                      </span>
                    )}
                  </CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                Live Baileys Gateway
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Companion Status</div>
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span
                    className={`size-2 rounded-full ${isReconnecting ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  />
                  {isReconnecting ? 'Linked, reconnecting' : 'Online & Linked'}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Active Brain</div>
                <div className="mt-1 text-sm font-semibold text-foreground capitalize">
                  {statusData?.brain === 'tchuekbot' ? 'Davila AI (TchuekBot)' : 'WACRM AI & Flows'}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Last Telemetry Sync</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {statusData?.lastSeenAt
                    ? new Date(statusData.lastSeenAt).toLocaleTimeString()
                    : 'Active'}
                </div>
              </div>
            </div>

            {/* AI Brain Selection */}
            <div className="mt-6 rounded-xl border border-border bg-card p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-foreground">AI Automation Driver</h3>
                <p className="text-xs text-muted-foreground">
                  Choose whether customer replies are handled by Davila AI on the bot or WACRM Flows.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!canEdit || switchingBrain}
                  onClick={() => handleSwitchBrain('tchuekbot')}
                  className={`flex flex-col rounded-lg border p-3.5 text-left transition-all ${
                    statusData?.brain === 'tchuekbot'
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium text-sm text-foreground">
                      <Bot className="size-4 text-primary" />
                      TchuekBot (Davila AI)
                    </span>
                    {statusData?.brain === 'tchuekbot' && (
                      <CheckCircle2 className="size-4 text-primary" />
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    Davila qualifies leads, handles objections, shares product catalog/Tally forms, and marks deals won automatically.
                  </p>
                </button>

                <button
                  type="button"
                  disabled={!canEdit || switchingBrain}
                  onClick={() => handleSwitchBrain('wacrm')}
                  className={`flex flex-col rounded-lg border p-3.5 text-left transition-all ${
                    statusData?.brain === 'wacrm'
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium text-sm text-foreground">
                      <Zap className="size-4 text-amber-500" />
                      WACRM Flows & AI
                    </span>
                    {statusData?.brain === 'wacrm' && (
                      <CheckCircle2 className="size-4 text-primary" />
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    Davila remains quiet; WACRM custom Flows and the internal AI assistant handle inbound messages.
                  </p>
                </button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t border-border pt-4">
            <div className="text-xs text-muted-foreground">
              Connected at: {statusData?.connectedAt ? new Date(statusData.connectedAt).toLocaleDateString() : 'Active'}
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={!canEdit || disconnecting}
              onClick={() => setShowDisconnectDialog(true)}
            >
              <Unplug className="mr-1.5 size-3.5" />
              Disconnect WhatsApp
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* ============================================================ */}
      {/* STATE 2: PAIRING IN PROGRESS                                 */}
      {/* ============================================================ */}
      {isPairing && activePairing && (
        <Card className="border-primary/30 bg-primary/[0.01]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                  WhatsApp
                </div>
                <CardTitle className="text-xl">Connecting...</CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  <span className="size-2 rounded-full bg-amber-500 inline-block animate-ping" />
                  <span>Waiting for confirmation from your phone</span>
                </CardDescription>
              </div>
              {secondsRemaining > 0 && (
                <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-mono text-muted-foreground">
                  <Clock className="size-3.5" />
                  <span>
                    Expires in {Math.floor(secondsRemaining / 60)}:
                    {(secondsRemaining % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-primary/40 bg-card p-8 text-center shadow-sm">
              {activePairing.method === 'code' && activePairing.code ? (
                <div className="w-full max-w-sm space-y-4">
                  <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Smartphone className="size-6" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-lg text-foreground">Enter this Pairing Code in WhatsApp</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Open WhatsApp → Linked Devices → Link with phone number
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-inner">
                    <span className="font-mono text-3xl font-extrabold tracking-widest text-primary">
                      {activePairing.code}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleCopyCode}
                      className="size-9 hover:bg-primary/10"
                      title="Copy code"
                    >
                      {copiedCode ? (
                        <Check className="size-4 text-emerald-500" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </div>

                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    <span>Waiting for phone handshake...</span>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetToTryAgain}
                    className="mt-2"
                  >
                    Cancel / Change Number
                  </Button>
                </div>
              ) : activePairing.method === 'qr' && activePairing.qr ? (
                <div className="w-full max-w-sm space-y-4">
                  <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <QrCode className="size-6" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-lg text-foreground">Scan QR Code</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Open WhatsApp → Linked Devices → Link a Device
                    </p>
                  </div>

                  <div className="flex justify-center rounded-xl border border-border bg-white p-4 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activePairing.qr}
                      alt="WhatsApp Pairing QR Code"
                      className="size-56"
                    />
                  </div>

                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    <span>
                      {qrRefreshing
                        ? 'Refreshing QR code...'
                        : 'Waiting for QR scan confirmation (the code refreshes automatically)...'}
                    </span>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetToTryAgain}
                    className="mt-2"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 className="size-8 animate-spin text-primary" />
                  <p className="text-sm font-medium text-foreground">Initializing Baileys gateway...</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ============================================================ */}
      {/* STATE 3: ERROR / FAILED / EXPIRED                             */}
      {/* ============================================================ */}
      {isFailed && (
        <Card className="border-red-500/20 bg-red-500/[0.02]">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
                <AlertCircle className="size-6" />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
                  WhatsApp
                </div>
                <CardTitle className="text-xl">Connection failed</CardTitle>
                <CardDescription className="mt-0.5 text-sm text-foreground/80">
                  Reason: {errorState?.reason || statusData?.failureReason || 'Connection attempt timed out or failed.'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              WhatsApp links must be confirmed promptly on your mobile device. If your phone lost internet connection or you mistyped the number, you can retry immediately.
            </p>
          </CardContent>
          <CardFooter className="flex justify-end border-t border-border pt-4">
            <Button
              onClick={handleResetToTryAgain}
              className="flex items-center gap-2"
            >
              <RotateCcw className="size-4" />
              Try again
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* ============================================================ */}
      {/* STATE 4: DISCONNECTED / READY TO CONNECT                     */}
      {/* ============================================================ */}
      {!isConnected && !isPairing && !isFailed && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  WhatsApp
                </div>
                <CardTitle className="text-xl">Not connected</CardTitle>
                <CardDescription className="mt-1">
                  Connect your business WhatsApp number directly via Baileys without Meta verification.
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-muted-foreground">
                Disconnected
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {pendingServerPairing && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
                <span>
                  A pairing started earlier is still open. If you already confirmed it on the phone,
                  this page switches to Connected by itself; otherwise start a new one below.
                </span>
              </div>
            )}
            <Tabs
              value={pairMode}
              onValueChange={(val) => setPairMode(val as 'code' | 'qr')}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="code" className="flex items-center gap-2">
                  <Smartphone className="size-4" />
                  Pairing Code (Recommended)
                </TabsTrigger>
                <TabsTrigger value="qr" className="flex items-center gap-2">
                  <QrCode className="size-4" />
                  QR Code
                </TabsTrigger>
              </TabsList>

              <TabsContent value="code" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber">WhatsApp Phone Number</Label>
                  <div className="flex gap-2">
                    <Input
                      id="phoneNumber"
                      type="tel"
                      placeholder="e.g. 237653683174 (international format with country code)"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      disabled={!canEdit || pairingLoading || !isConfigured}
                      className="max-w-md font-mono"
                    />
                    <Button
                      onClick={handleStartPairing}
                      disabled={!canEdit || pairingLoading || !isConfigured || !phoneNumber.trim()}
                    >
                      {pairingLoading ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        'Connect WhatsApp'
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter digits with country code (no + or spaces). WhatsApp will provide an 8-character pairing code to confirm on your phone.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <h5 className="flex items-center gap-2 font-medium text-xs text-foreground uppercase tracking-wider">
                    <Info className="size-4 text-primary" />
                    How to connect with pairing code:
                  </h5>
                  <ol className="mt-2 list-inside list-decimal space-y-1.5 text-xs text-muted-foreground">
                    <li>Type your WhatsApp number above and click <strong>Connect WhatsApp</strong>.</li>
                    <li>Open WhatsApp on your mobile phone.</li>
                    <li>Go to <strong>Settings</strong> (or ⋮ menu) → <strong>Linked Devices</strong>.</li>
                    <li>Tap <strong>Link a Device</strong>, then tap <strong>Link with phone number instead</strong> at the bottom.</li>
                    <li>Enter the 8-character code shown on screen.</li>
                  </ol>
                </div>
              </TabsContent>

              <TabsContent value="qr" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Generate an instant QR code and scan it with your phone&apos;s camera directly inside WhatsApp.
                  </p>
                  <Button
                    onClick={handleStartPairing}
                    disabled={!canEdit || pairingLoading || !isConfigured}
                  >
                    {pairingLoading ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Generating QR...
                      </>
                    ) : (
                      'Connect WhatsApp with QR'
                    )}
                  </Button>
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <h5 className="flex items-center gap-2 font-medium text-xs text-foreground uppercase tracking-wider">
                    <Info className="size-4 text-primary" />
                    How to connect with QR code:
                  </h5>
                  <ol className="mt-2 list-inside list-decimal space-y-1.5 text-xs text-muted-foreground">
                    <li>Click <strong>Connect WhatsApp with QR</strong>.</li>
                    <li>Open WhatsApp on your phone → <strong>Linked Devices</strong>.</li>
                    <li>Tap <strong>Link a Device</strong> and scan the QR code displayed on screen.</li>
                  </ol>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Disconnect Confirmation Dialog */}
      <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect WhatsApp?</DialogTitle>
            <DialogDescription>
              This will unpair the Baileys companion session on TchuekBot. Inbound WhatsApp messages will no longer be captured in WACRM until you re-link. Existing chat history and deals remain safe.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setShowDisconnectDialog(false)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                'Confirm Disconnect'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
