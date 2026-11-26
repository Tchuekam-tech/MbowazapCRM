'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Clock,
  Plus,
  Trash2,
  Play,
  Pause,
  Users,
  Moon,
  MessageSquareReply,
  Loader2,
  GitBranchPlus,
} from 'lucide-react';
import type {
  DripSequence,
  DripSequenceStep,
  MarketingSegment,
  PromoCoupon,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

interface DripSequencesTabProps {
  sequences: DripSequence[];
  segments: MarketingSegment[];
  coupons: PromoCoupon[];
  canEdit: boolean;
  onRefresh: () => void;
}

const DEFAULT_STEPS: DripSequenceStep[] = [
  {
    step_order: 1,
    delay_minutes: 0,
    message_type: 'text',
    content_text:
      'Hi {{first_name}} 👋 Thanks for reaching out! Are you still exploring our plans? Reply YES for a quick custom quote.',
  },
  {
    step_order: 2,
    delay_minutes: 1440,
    message_type: 'text',
    content_text:
      'Hey {{first_name}} ✨ Just following up — our clients typically see results in week 1. Want me to hold a spot for you?',
  },
  {
    step_order: 3,
    delay_minutes: 4320,
    message_type: 'text',
    content_text:
      'Final reminder {{first_name}}: use promo code *{{coupon}}* before it expires to lock in your special discount!',
  },
];

export function DripSequencesTab({
  sequences,
  segments,
  coupons,
  canEdit,
  onRefresh,
}: DripSequencesTabProps) {
  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [stopOnReply, setStopOnReply] = useState(true);
  const [quietStart, setQuietStart] = useState('21:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [steps, setSteps] = useState<DripSequenceStep[]>(DEFAULT_STEPS);
  const [saving, setSaving] = useState(false);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);

  function addStep() {
    setSteps((prev) => [
      ...prev,
      {
        step_order: prev.length + 1,
        delay_minutes: 1440,
        message_type: 'text',
        content_text: '',
      },
    ]);
  }

  function updateStep(index: number, patch: Partial<DripSequenceStep>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  }

  function removeStep(index: number) {
    setSteps((prev) =>
      prev.filter((_, i) => i !== index).map((s, idx) => ({ ...s, step_order: idx + 1 }))
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || steps.some((s) => !s.content_text.trim())) {
      toast.error('Please enter a sequence name and message for every step.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/marketing/sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          status: 'active',
          segment_id: segmentId || undefined,
          stop_on_reply: stopOnReply,
          quiet_hours_start: quietStart,
          quiet_hours_end: quietEnd,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          steps,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Automated Drip Sequence created!');
      setName('');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create sequence');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(seq: DripSequence) {
    const next = seq.status === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch('/api/marketing/sequences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: seq.id, status: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Sequence ${next}`);
      onRefresh();
    } catch {
      toast.error('Failed to update sequence');
    }
  }

  async function handleEnrollSegment(seq: DripSequence) {
    if (!seq.segment_id && segments.length === 0) {
      toast.error('Create a Smart Segment first to enroll an audience.');
      return;
    }
    const targetSegId = seq.segment_id || segments[0]?.id;
    setEnrollingId(seq.id);
    try {
      const res = await fetch('/api/marketing/sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enroll',
          sequence_id: seq.id,
          segment_id: targetSegId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        `Enrolled ${data.enrolled} contacts (${data.skippedDuplicates} already enrolled).`
      );
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enrollment failed');
    } finally {
      setEnrollingId(null);
    }
  }
