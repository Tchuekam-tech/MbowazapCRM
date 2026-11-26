'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Clock,
  Loader2,
  MessageSquare,
  X,
  Briefcase,
  Globe,
  Bell,
  Sparkles,
  Tag,
  AlertCircle,
  CheckCircle2,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type {
  JarvisActionRecord,
  JarvisActionType,
  JarvisOverviewPayload,
} from '@/types/jarvis';

interface JarvisActionsTabProps {
  data: JarvisOverviewPayload;
  onRefresh: () => Promise<void>;
}

const ACTION_META: Record<
  JarvisActionType,
  { label: string; icon: typeof MessageSquare }
> = {
  send_whatsapp_followup: { label: 'WhatsApp Follow-up (Typing Sim)', icon: MessageSquare },
  create_or_advance_deal: { label: 'Pipeline Deal', icon: Briefcase },
  tag_contact: { label: 'Tag Contact', icon: Tag },
  enroll_drip: { label: 'Drip Enrollment', icon: Sparkles },
  queue_buffer_post: { label: 'Buffer Social Post', icon: Globe },
  recompute_lead_scores: { label: 'Lead Scoring', icon: Sparkles },
  create_team_alert: { label: 'Team Alert', icon: Bell },
  escalate_conversation: { label: 'Human Escalation', icon: AlertCircle },
};

const PRIORITY_STYLE: Record<string, string> = {
  critical: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  high: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  medium: 'border-blue-500/40 bg-blue-500/15 text-blue-300',
  low: 'border-border bg-muted text-muted-foreground',
};

export function JarvisActionsTab({ data, onRefresh }: JarvisActionsTabProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});

  const decide = async (
    action: JarvisActionRecord,
    decision: 'approve' | 'reject'
  ) => {
    setBusyId(action.id);
    try {
      const editedText = editedTexts[action.id];
      let editedPayload: Record<string, unknown> | undefined;
      if (decision === 'approve' && editedText !== undefined) {
        if (action.action_type === 'send_whatsapp_followup') {
          editedPayload = { messageText: editedText };
        } else if (action.action_type === 'queue_buffer_post') {
          editedPayload = { text: editedText };
        }
      }

      const res = await fetch('/api/jarvis/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: action.id,
          decision,
          editedPayload,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Action decision failed');
        return;
      }
      if (decision === 'reject') {
        toast.success('Action dismissed');
      } else if (json.action?.status === 'executed') {
        toast.success(`Executed: ${action.title}`);
      } else {
        toast.error(json.action?.error_message || 'Action execution failed');
      }
      await onRefresh();
    } catch {
      toast.error('Network error processing action');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Pending Approvals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-amber-400" />
            Pending Approvals ({data.pendingActions.length})
          </CardTitle>
          <CardDescription>
            Review and approve actions proposed by {data.config.agent_name}. WhatsApp follow-ups automatically simulate realistic human typing before sending.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.pendingActions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              No pending approvals right now. Run a Brain Cycle or switch Autonomy Mode to Co-Pilot to queue new actions.
            </div>
          ) : (
            data.pendingActions.map((act) => {
              const meta = ACTION_META[act.action_type] ?? {
                label: act.action_type,
                icon: Sparkles,
              };
              const Icon = meta.icon;
              const isBusy = busyId === act.id;
              const editableField =
                act.action_type === 'send_whatsapp_followup'
                  ? String(act.payload?.messageText ?? '')
                  : act.action_type === 'queue_buffer_post'
                    ? String(act.payload?.text ?? '')
                    : null;

              return (
                <div
                  key={act.id}
                  className="space-y-3 rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            PRIORITY_STYLE[act.priority] ?? PRIORITY_STYLE.medium
                          }`}
                        >
                          {act.priority}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(act.created_at).toLocaleString()}
                        </span>
                      </div>
                      <h4 className="text-sm font-semibold text-foreground">{act.title}</h4>
                      <p className="text-xs text-muted-foreground">{act.reasoning}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => void decide(act, 'reject')}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void decide(act, 'approve')}
                      >
                        {isBusy ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Approve & Execute
                      </Button>
                    </div>
                  </div>

                  {editableField !== null && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        Message Draft (editable before sending):
                      </p>
                      <Textarea
                        rows={3}
                        value={editedTexts[act.id] ?? editableField}
                        onChange={(e) =>
                          setEditedTexts((prev) => ({ ...prev, [act.id]: e.target.value }))
                        }
                        disabled={isBusy}
                        className="text-xs"
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Execution History + Brain Runs */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Autonomous Execution Audit Log
            </CardTitle>
            <CardDescription>Recent completed, dismissed, and failed actions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {data.recentActions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No action history yet.</p>
            ) : (
              data.recentActions.slice(0, 15).map((act) => (
                <div
                  key={act.id}
                  className="rounded-lg border border-border bg-muted/20 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{act.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        act.status === 'executed'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : act.status === 'failed'
                            ? 'bg-rose-500/15 text-rose-400'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {act.status}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{act.reasoning}</p>
                  {act.result && Boolean(act.result.typingSimulated) && (
                    <p className="mt-1 text-[11px] text-emerald-400">
                      Human typing indicator simulated before delivery ✓
                    </p>
                  )}
                  {act.error_message && (
                    <p className="mt-1 text-[11px] text-rose-400">{act.error_message}</p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              24/7 Brain Cycle Runs
            </CardTitle>
            <CardDescription>Automated cron heartbeats & manual scans</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {data.recentRuns.length === 0 ? (
              <p className="text-xs text-muted-foreground">No brain runs recorded yet.</p>
            ) : (
              data.recentRuns.map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-border bg-muted/20 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">
                      Health {run.health_score}/100 · {run.trigger}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(run.started_at).toLocaleString()} ({run.duration_ms}ms)
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground line-clamp-2">
                    {run.executive_summary || run.error_message || 'Completed'}
                  </p>
                  <p className="mt-1 text-[11px] text-primary">
                    Proposed: {run.actions_proposed} · Executed: {run.actions_executed}
                    {run.actions_failed > 0 ? ` · Failed: ${run.actions_failed}` : ''}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
