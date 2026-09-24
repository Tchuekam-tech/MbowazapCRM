'use client';

// ============================================================
// MboWazapConfig — Settings → MboWazap (Bot Gateway)
//
// Manages the Baileys companion socket connection to TchuekBot.
// Supports:
//   1. 8-digit pairing code & QR code linking
//   2. Real-time Baileys companion socket status
//   3. AI Brain selection (Davila on TchuekBot vs WACRM Flows)
//   4. Clean session disconnection & logout
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  QrCode,
  Radio,
  RefreshCw,
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

interface SessionData {
  configured: boolean;
  configIssues?: string[];
  provider: 'meta' | 'mbowazap';
  session: string | null;
  pairingRef: string | null;
  state: 'pairing' | 'connected' | 'disconnected' | 'logged_out';
  displayName: string | null;
  brain: 'tchuekbot' | 'wacrm';
  lastEventAt: string | null;
  connectedAt: string | null;
  live?: {
    session: string;
    status: string;
    davila: boolean;
  } | null;
}

export function MboWazapConfig() {
  const canEdit = useCan('edit-settings');

  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);

  // Pairing state
  const [pairMode, setPairMode] = useState<'code' | 'qr'>('code');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingResult, setPairingResult] = useState<{
    method: 'code' | 'qr';
    code?: string;
    qr?: string;
    pairingRef: string;
  } | null>(null);

  const [copiedCode, setCopiedCode] = useState(false);
  const [switchingBrain, setSwitchingBrain] = useState(false);

  // Disconnect dialog
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch('/api/mbowazap/session', { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) {
        setSessionData(data);
      } else {
        toast.error(data.error || 'Failed to fetch MboWazap status');
      }
    } catch (err) {
      console.error('Error fetching session:', err);
      toast.error('Network error loading MboWazap status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [loadSession]);

  // Polling while pairing is active
  useEffect(() => {
    if (!pairingResult?.pairingRef) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const ref = pairingResult.pairingRef;
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/mbowazap/poll?ref=${encodeURIComponent(ref)}`);
        const json = await res.json();
        if (json.ok && json.connected) {
          toast.success('WhatsApp connected successfully!');
          setPairingResult(null);
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          loadSession();
        }
      } catch {
        // Ignore transient poll glitches
      }
    }, 2500);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [pairingResult, loadSession]);

  async function handleStartPairing() {
    if (!canEdit) return;
    setPairingLoading(true);
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
        throw new Error(json.error || 'Failed to start pairing');
      }

      setPairingResult({
        method: json.method,
        code: json.code,
        qr: json.qr,
        pairingRef: json.pairingRef,
      });

      if (json.method === 'code') {
        toast.info('Pairing code generated. Enter it in WhatsApp.');
      } else {
        toast.info('QR code ready. Scan it with WhatsApp.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Pairing request failed');
    } finally {
      setPairingLoading(false);
    }
  }

  async function handleSwitchBrain(newBrain: 'tchuekbot' | 'wacrm') {
    if (!canEdit || switchingBrain || sessionData?.brain === newBrain) return;
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

      setSessionData((prev) => (prev ? { ...prev, brain: newBrain } : null));
      toast.success(
        newBrain === 'tchuekbot'
          ? 'Davila AI Assistant activated on TchuekBot'
          : 'WACRM Flows & Internal AI activated'
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to switch brain');
    } finally {
      setSwitchingBrain(false);
    }
  }

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
      setPairingResult(null);
      toast.success('MboWazap session unlinked');
      loadSession();
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  function handleCopyCode() {
    if (!pairingResult?.code) return;
    navigator.clipboard.writeText(pairingResult.code);
    setCopiedCode(true);
    toast.success('Pairing code copied to clipboard');
    setTimeout(() => setCopiedCode(false), 2500);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isConfigured = sessionData?.configured ?? false;
  const isConnected = sessionData?.state === 'connected';
  const isPairing = sessionData?.state === 'pairing' || Boolean(pairingResult);

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="MboWazap Gateway (TchuekBot)"
        description="Pair your WhatsApp companion number via Baileys and synchronize chats, contacts, deals, and Davila sales AI with WACRM."
        action={
          <div className="flex items-center gap-2">
            {isConnected ? (
              <SettingsChip variant="ok">
                <StatusDot tone="ok" />
                Connected
              </SettingsChip>
            ) : isPairing ? (
              <SettingsChip variant="warn">
                <Loader2 className="size-3 animate-spin text-amber-500" />
                Pairing in progress
              </SettingsChip>
            ) : (
              <SettingsChip variant="muted">
                <StatusDot tone="muted" />
                Not paired
              </SettingsChip>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={loadSession}
              title="Refresh status"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        }
      />

      {/* Environment Setup Notice if not configured */}
      {!isConfigured && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
          <AlertCircle className="size-5 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="font-semibold">MboWazap Bridge is not configured</AlertTitle>
          <AlertDescription className="mt-2 space-y-2 text-sm leading-relaxed">
            <p>
              To link WACRM to TchuekBot, set the following environment variables in your{' '}
              <code className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-xs text-foreground">
                .env.local
              </code>{' '}
              file:
            </p>
            <div className="rounded-lg bg-background/90 p-3 font-mono text-xs text-foreground border border-border">
              <div>MBOWAZAP_BOT_URL=https://tchuekbot.up.railway.app</div>
              <div>MBOWAZAP_SECRET=your_secure_shared_hmac_secret_at_least_32_chars</div>
            </div>
            <p className="text-xs text-muted-foreground">
              Ensure <code className="font-mono">MBOWAZAP_SECRET</code> matches the one defined in your TchuekBot{' '}
              <code className="font-mono">.env</code>.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Active Connected State */}
      {isConnected && (
        <Card className="border-emerald-500/20 bg-emerald-500/[0.02]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Smartphone className="size-6" />
                </div>
                <div>
                  <CardTitle className="text-lg">
                    {sessionData?.session ? `+${sessionData.session}` : 'Paired WhatsApp Number'}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    {sessionData?.displayName && (
                      <span className="font-medium text-foreground">
                        {sessionData.displayName}
                      </span>
                    )}
                    <span>•</span>
                    <span>Baileys Gateway Connected</span>
                  </CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                Active Provider
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Socket Health</div>
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  Live & Ready
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Active Brain</div>
                <div className="mt-1 text-sm font-semibold text-foreground capitalize">
                  {sessionData?.brain === 'tchuekbot' ? 'Davila AI (TchuekBot)' : 'WACRM AI & Flows'}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Last Event Synced</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {sessionData?.lastEventAt
                    ? new Date(sessionData.lastEventAt).toLocaleTimeString()
                    : 'Awaiting events'}
                </div>
              </div>
            </div>

            {/* Brain Selector Card */}
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
                    sessionData?.brain === 'tchuekbot'
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium text-sm text-foreground">
                      <Bot className="size-4 text-primary" />
                      TchuekBot (Davila AI)
                    </span>
                    {sessionData?.brain === 'tchuekbot' && (
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
                    sessionData?.brain === 'wacrm'
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium text-sm text-foreground">
                      <Zap className="size-4 text-amber-500" />
                      WACRM Flows & AI
                    </span>
                    {sessionData?.brain === 'wacrm' && (
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
              To switch back to Meta Cloud API, disconnect MboWazap first.
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={!canEdit || disconnecting}
              onClick={() => setShowDisconnectDialog(true)}
            >
              <Unplug className="mr-1.5 size-3.5" />
              Disconnect Bot
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Disconnected / Pairing Card */}
      {!isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>Connect WhatsApp via Baileys</CardTitle>
            <CardDescription>
              Link a WhatsApp phone number with TchuekBot companion pairing. No Meta verification or business registration required.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {pairingResult ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-primary/40 bg-primary/[0.02] p-8 text-center">
                {pairingResult.method === 'code' && pairingResult.code ? (
                  <div className="w-full max-w-sm space-y-4">
                    <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Smartphone className="size-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">Enter this code in WhatsApp</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Open WhatsApp → Linked Devices → Link with phone number
                      </p>
                    </div>

                    <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-4 shadow-inner">
                      <span className="font-mono text-3xl font-extrabold tracking-widest text-primary">
                        {pairingResult.code}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleCopyCode}
                        className="size-9"
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
                      <span>Waiting for device confirmation...</span>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPairingResult(null)}
                      className="mt-2"
                    >
                      Cancel / Try Again
                    </Button>
                  </div>
                ) : pairingResult.method === 'qr' && pairingResult.qr ? (
                  <div className="w-full max-w-sm space-y-4">
                    <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <QrCode className="size-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">Scan QR Code</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Open WhatsApp → Linked Devices → Link a Device
                      </p>
                    </div>

                    <div className="flex justify-center rounded-xl border border-border bg-white p-4 shadow-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pairingResult.qr}
                        alt="WhatsApp Pairing QR Code"
                        className="size-56"
                      />
                    </div>

                    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                      <span>Waiting for QR scan...</span>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPairingResult(null)}
                      className="mt-2"
                    >
                      Cancel / Try Again
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
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
                        placeholder="e.g. 237653683174 (with country code)"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        disabled={!canEdit || pairingLoading || !isConfigured}
                        className="max-w-md"
                      />
                      <Button
                        onClick={handleStartPairing}
                        disabled={!canEdit || pairingLoading || !isConfigured || !phoneNumber.trim()}
                      >
                        {pairingLoading ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Requesting Code...
                          </>
                        ) : (
                          'Get Pairing Code'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter digits with international country code (no + or spaces). WhatsApp will prompt you to enter the 8-character pairing code.
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-muted/40 p-4">
                    <h5 className="flex items-center gap-2 font-medium text-xs text-foreground uppercase tracking-wider">
                      <Info className="size-4 text-primary" />
                      How pairing code works:
                    </h5>
                    <ol className="mt-2 list-inside list-decimal space-y-1.5 text-xs text-muted-foreground">
                      <li>Open WhatsApp on your mobile device.</li>
                      <li>Go to <strong>Settings</strong> (or the ⋮ menu) → <strong>Linked Devices</strong>.</li>
                      <li>Tap <strong>Link a Device</strong>, then tap <strong>Link with phone number instead</strong> at the bottom.</li>
                      <li>Type in the 8-character code shown on screen.</li>
                    </ol>
                  </div>
                </TabsContent>

                <TabsContent value="qr" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Generate a live QR code and scan it with your phone's camera in WhatsApp.
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
                        'Generate QR Code'
                      )}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      )}

      {/* Disconnect Confirmation Dialog */}
      <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect MboWazap WhatsApp?</DialogTitle>
            <DialogDescription>
              This will log out the Baileys companion session on TchuekBot. Inbound WhatsApp messages will no longer be captured in WACRM until you re-link. Existing chat history and deals remain safe.
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
