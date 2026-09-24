import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkAutomationAllowed,
  takeoverConversation,
  resumeConversation,
  registerInFlightAi,
  unregisterInFlightAi,
  getInFlightAi,
  abortInFlightAi,
} from './reply-control';
import {
  withTypingIndicator,
  TYPING_HEARTBEAT_MS,
} from './typing-controller';
import type { WhatsAppTransport } from '@/lib/whatsapp/transport';
import { engineSendText } from '@/lib/flows/meta-send';

// Mock meta-send dependencies so we can test the real engineSendText
const hoisted = vi.hoisted(() => ({
  getClient: () => null as any,
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => hoisted.getClient(),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => hoisted.getClient(),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (t: string) => t,
}));

describe('Reply Engine Control & Concurrency System', () => {
  let mockDbState: {
    conversations: Map<string, any>;
    flowRuns: Map<string, any>;
    messages: any[];
    contacts: Map<string, any>;
    whatsappConfig: Map<string, any>;
  };

  let mockClient: any;

  beforeEach(() => {
    mockDbState = {
      conversations: new Map(),
      flowRuns: new Map(),
      messages: [],
      contacts: new Map(),
      whatsappConfig: new Map(),
    };

    // Default mock conversation
    mockDbState.conversations.set('conv-1', {
      id: 'conv-1',
      account_id: 'acc-1',
      automation_state: 'active',
      automation_version: 1,
      ai_autoreply_disabled: false,
      ai_paused_until: null,
      assigned_agent_id: null,
    });

    mockDbState.contacts.set('ct-1', {
      id: 'ct-1',
      account_id: 'acc-1',
      phone: '+237690000000',
    });

    mockClient = {
      from: (table: string) => {
        return {
          select: (fields?: string) => ({
            eq: (col: string, val: any) => ({
              eq: (col2: string, val2: any) => ({
                maybeSingle: async () => {
                  if (table === 'conversations') return { data: mockDbState.conversations.get(val), error: null };
                  if (table === 'contacts') return { data: mockDbState.contacts.get(val), error: null };
                  return { data: null, error: null };
                },
                single: async () => {
                  if (table === 'contacts') return { data: mockDbState.contacts.get(val), error: null };
                  return { data: null, error: null };
                },
              }),
              maybeSingle: async () => {
                if (table === 'conversations') return { data: mockDbState.conversations.get(val), error: null };
                if (table === 'contacts') return { data: mockDbState.contacts.get(val), error: null };
                return { data: null, error: null };
              },
              single: async () => {
                if (table === 'conversations') return { data: mockDbState.conversations.get(val), error: null };
                return { data: null, error: null };
              },
            }),
          }),
          update: (payload: any) => ({
            eq: (col: string, val: any) => {
              if (table === 'conversations') {
                const existing = mockDbState.conversations.get(val) || {};
                mockDbState.conversations.set(val, { ...existing, ...payload });
              }
              if (table === 'flow_runs') {
                for (const [id, r] of mockDbState.flowRuns.entries()) {
                  if (r[col] === val) {
                    mockDbState.flowRuns.set(id, { ...r, ...payload });
                  }
                }
              }
              return {
                eq: (col2: string, val2: any) => {
                  return Promise.resolve({ error: null });
                },
                then: (resolve: any) => resolve({ error: null }),
              };
            },
          }),
          insert: (row: any) => {
            mockDbState.messages.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
      rpc: (name: string, args: any) => {
        if (name === 'takeover_conversation_automation') {
          const conv = mockDbState.conversations.get(args.p_conversation_id);
          if (conv) {
            conv.automation_state = 'human_handling';
            conv.automation_version = (conv.automation_version || 1) + 1;
            conv.human_handled_at = new Date().toISOString();
            conv.human_handling_reason = args.p_reason;
            conv.ai_autoreply_disabled = true;
            conv.ai_paused_until = args.p_pause_until || null;
            return Promise.resolve({
              data: [{ new_state: conv.automation_state, new_version: conv.automation_version }],
              error: null,
            });
          }
        }
        if (name === 'resume_conversation_automation') {
          const conv = mockDbState.conversations.get(args.p_conversation_id);
          if (conv) {
            conv.automation_state = 'active';
            conv.automation_version = (conv.automation_version || 1) + 1;
            conv.ai_autoreply_disabled = false;
            conv.ai_paused_until = null;
            return Promise.resolve({
              data: [{ new_state: conv.automation_state, new_version: conv.automation_version }],
              error: null,
            });
          }
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    hoisted.getClient = () => mockClient;
  });

  afterEach(() => {
    unregisterInFlightAi('conv-1');
  });

  describe('1. Authoritative State & Versioning', () => {
    it('allows automation when conversation is active', async () => {
      const res = await checkAutomationAllowed(mockClient, 'conv-1');
      expect(res.allowed).toBe(true);
      expect(res.state).toBe('active');
      expect(res.version).toBe(1);
    });

    it('blocks automation with human_agent_assigned reason if assigned to an agent', async () => {
      mockDbState.conversations.set('conv-1', {
        ...mockDbState.conversations.get('conv-1'),
        assigned_agent_id: 'agent-123',
      });
      const res = await checkAutomationAllowed(mockClient, 'conv-1');
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('human_agent_assigned');
      expect(res.state).toBe('human_handling');
    });

    it('increments automation_version monotonically and sets state to human_handling on takeover', async () => {
      const result = await takeoverConversation(mockClient, 'conv-1', {
        reason: 'davila_replied_on_phone',
        accountId: 'acc-1',
      });

      expect(result.state).toBe('human_handling');
      expect(result.version).toBe(2);

      const check = await checkAutomationAllowed(mockClient, 'conv-1');
      expect(check.allowed).toBe(false);
      expect(check.state).toBe('human_handling');
      expect(check.version).toBe(2);
    });

    it('detects version mismatch when an automation job captures an older version', async () => {
      // Job captured version 1
      const capturedVersion = 1;

      // Human takes over → version becomes 2
      await takeoverConversation(mockClient, 'conv-1', {
        reason: 'agent_takeover',
        accountId: 'acc-1',
      });

      // Job checks before side effect
      const check = await checkAutomationAllowed(mockClient, 'conv-1', capturedVersion);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('version_mismatch: expected 1, got 2');
    });

    it('resumes automation cleanly with a new incremented version', async () => {
      await takeoverConversation(mockClient, 'conv-1', { reason: 'manual_takeover' });
      const resumed = await resumeConversation(mockClient, 'conv-1', { accountId: 'acc-1' });

      expect(resumed.state).toBe('active');
      expect(resumed.version).toBe(3);

      const check = await checkAutomationAllowed(mockClient, 'conv-1');
      expect(check.allowed).toBe(true);
      expect(check.state).toBe('active');
      expect(check.version).toBe(3);
    });

    it('is idempotent on duplicate takeover calls', async () => {
      await takeoverConversation(mockClient, 'conv-1', { reason: 'first_call' });
      await takeoverConversation(mockClient, 'conv-1', { reason: 'duplicate_call' });

      const check = await checkAutomationAllowed(mockClient, 'conv-1');
      expect(check.allowed).toBe(false);
      expect(check.state).toBe('human_handling');
      expect(check.version).toBe(3);
    });
  });

  describe('2. In-Flight AI Cancellation & Abort Handling', () => {
    it('immediately signals abort on in-flight AI run upon human takeover', async () => {
      const abortController = new AbortController();
      let aborted = false;
      abortController.signal.addEventListener('abort', () => {
        aborted = true;
      });

      registerInFlightAi({
        conversationId: 'conv-1',
        abortController,
        capturedVersion: 1,
        startedAt: Date.now(),
      });

      expect(getInFlightAi('conv-1')).toBeDefined();

      // Davila sends a message / takes over
      await takeoverConversation(mockClient, 'conv-1', {
        reason: 'davila_replied',
      });

      expect(aborted).toBe(true);
      expect(abortController.signal.aborted).toBe(true);
      expect(getInFlightAi('conv-1')).toBeUndefined();
    });

    it('discards stale AI response when version changed during generation', async () => {
      const baselineVersion = 1;

      // Simulate AI generation takes 500ms
      const generateFakeReply = async () => {
        // Halfway through generation, Davila replies
        await takeoverConversation(mockClient, 'conv-1', {
          reason: 'davila_replied_during_gen',
        });
        return { text: 'Automated AI reply' };
      };

      const result = await generateFakeReply();

      // Gate 4 check after generation
      const gate4 = await checkAutomationAllowed(mockClient, 'conv-1', baselineVersion);
      expect(gate4.allowed).toBe(false);

      // Invariant 2: Output MUST be discarded
      let sent = false;
      if (gate4.allowed) {
        sent = true;
      }

      expect(sent).toBe(false);
      expect(result.text).toBe('Automated AI reply'); // Output was discarded, never sent
    });
  });

  describe('3. AI Typing Indicator Lifecycle & Heartbeat', () => {
    it('starts typing presence on generation start and stops in finally', async () => {
      const presenceCalls: { typing: boolean; to: string }[] = [];
      const fakeTransport = {
        provider: 'mbowazap',
        setTyping: vi.fn(async ({ typing, to }: any) => {
          presenceCalls.push({ typing, to });
        }),
        sendText: vi.fn() as any,
        sendMedia: vi.fn() as any,
        sendInteractive: vi.fn() as any,
        sendTemplate: vi.fn() as any,
        resolveTarget: vi.fn() as any,
      } as unknown as WhatsAppTransport;

      const res = await withTypingIndicator({
        transport: fakeTransport,
        conversationId: 'conv-1',
        recipient: '+237690000000',
        fn: async () => {
          expect(presenceCalls).toEqual([{ typing: true, to: '+237690000000' }]);
          return 'done';
        },
      });

      expect(res).toBe('done');
      // Cleaned up in finally
      expect(presenceCalls).toEqual([
        { typing: true, to: '+237690000000' },
        { typing: false, to: '+237690000000' },
      ]);
    });

    it('immediately stops typing if abort signal fires during generation', async () => {
      const presenceCalls: { typing: boolean }[] = [];
      const fakeTransport = {
        provider: 'mbowazap',
        setTyping: vi.fn(async ({ typing }: any) => {
          presenceCalls.push({ typing });
        }),
        sendText: vi.fn() as any,
        sendMedia: vi.fn() as any,
        sendInteractive: vi.fn() as any,
        sendTemplate: vi.fn() as any,
        resolveTarget: vi.fn() as any,
      } as unknown as WhatsAppTransport;

      const abortController = new AbortController();

      const typingPromise = withTypingIndicator({
        transport: fakeTransport,
        conversationId: 'conv-1',
        recipient: '+237690000000',
        signal: abortController.signal,
        fn: async () => {
          // Trigger takeover abort while inside fn
          abortController.abort(new Error('davila_takeover'));
          await new Promise((r) => setTimeout(r, 20));
          return 'should_not_reach';
        },
      });

      await expect(typingPromise).rejects.toThrow('davila_takeover');

      // Invariant 4: Typing must never remain active after cancellation
      expect(presenceCalls[0]).toEqual({ typing: true });
      expect(presenceCalls[presenceCalls.length - 1]).toEqual({ typing: false });
    });
  });

  describe('4. Final Outbound Send Gate (Gate 5)', () => {
    it('blocks outbound send when conversation is marked human_handling', async () => {
      // Mark conversation human_handling
      await takeoverConversation(mockClient, 'conv-1', { reason: 'agent_replied' });

      // Outbound engine send must fail and NOT reach transport
      await expect(
        engineSendText({
          accountId: 'acc-1',
          userId: 'user-1',
          conversationId: 'conv-1',
          contactId: 'ct-1',
          text: 'Stale automated reply',
        })
      ).rejects.toThrow(/automated send blocked/);
    });

    it('blocks outbound send when expectedVersion does not match current version', async () => {
      // Automation was started at version 1
      const initialVersion = 1;

      // Human took over and bumped version
      await takeoverConversation(mockClient, 'conv-1', { reason: 'agent_active' });

      await expect(
        engineSendText({
          accountId: 'acc-1',
          userId: 'user-1',
          conversationId: 'conv-1',
          contactId: 'ct-1',
          text: 'Stale version reply',
          expectedVersion: initialVersion,
        })
      ).rejects.toThrow(/automated send blocked: version_mismatch/);
    });
  });
});
