import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeEvent } from './protocol';
import { ingestBatch } from './ingest';
import { wacrmFakeDb, type Row } from './testing/fake-supabase';

const h = vi.hoisted(() => {
  type Spy = (...args: unknown[]) => Promise<void>;
  return {
    lifecycle: vi.fn<Spy>(async () => {}),
    webhook: vi.fn<Spy>(async () => {}),
    automations: vi.fn<Spy>(async () => {}),
  };
});

vi.mock('@/lib/whatsapp/inbound/lifecycle', () => ({
  dispatchInboundLifecycle: h.lifecycle,
}));
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.webhook }));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.automations,
}));

const SESSION = '237600000001';
const CUSTOMER = '237699000001';
const LID = '123456789012';
const REF = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const NOW = Date.parse('2026-09-24T10:00:00Z');
const T = NOW / 1000;

let seq = 0;

function ev(type: BridgeEvent['type'], fields: Record<string, unknown>): BridgeEvent {
  seq += 1;
  return {
    eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    type,
    at: NOW,
    ...fields,
  } as unknown as BridgeEvent;
}

function msg(fields: Record<string, unknown> = {}): BridgeEvent {
  return ev('message', {
    id: `3EB0${seq + 1}`,
    direction: 'inbound',
    origin: 'customer',
    chat: { phone: CUSTOMER, pushName: 'Awa' },
    timestamp: T,
    kind: 'text',
    text: 'Bonjour',
    ...fields,
  });
}

function setup(
  opts: { brain?: 'tchuekbot' | 'wacrm'; session?: string | null } = {}
) {
  const db = wacrmFakeDb(() => NOW);
  db.seed('whatsapp_config', [
    {
      id: 'cfg-1',
      account_id: 'acc-1',
      user_id: 'owner-1',
      provider: 'mbowazap',
      mbowazap_session: opts.session === undefined ? SESSION : opts.session,
      mbowazap_pairing_ref: REF,
      mbowazap_brain: opts.brain ?? 'tchuekbot',
      status: 'disconnected',
    },
  ]);
  const tasks: (() => Promise<void>)[] = [];
  const ctx = { db: db.client(), defer: (t: () => Promise<void>) => tasks.push(t), now: () => NOW };
  const run = (...events: BridgeEvent[]) =>
    ingestBatch(ctx, { protocol: '1', session: SESSION, createdAt: NOW, events });
  const flush = async () => {
    for (const task of tasks.splice(0)) await task();
  };
  const one = (table: string): Row => {
    const rows = db.rows(table);
    expect(rows).toHaveLength(1);
    return rows[0];
  };
  return { db, run, flush, one };
}

beforeEach(() => {
  seq = 0;
});

describe('inbound messages', () => {
  it('create the contact, conversation and message, bump unread, and defer the fan-out', async () => {
    const { db, run, flush, one } = setup();
    expect(await run(msg({ id: 'IN1' }))).toEqual({ accepted: 1, rejected: [] });

    const contact = one('contacts');
    expect(contact).toMatchObject({ account_id: 'acc-1', user_id: 'owner-1', phone: CUSTOMER, name: 'Awa' });
    const conversation = one('conversations');
    expect(conversation).toMatchObject({
      account_id: 'acc-1',
      contact_id: contact.id,
      unread_count: 1,
      last_message_text: 'Bonjour',
    });
    expect(one('messages')).toMatchObject({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Bonjour',
      message_id: 'IN1',
      status: 'delivered',
      created_at: new Date(NOW).toISOString(),
      ai_generated: false,
    });
    expect(db.rpcCalls.map((c) => c.name)).toEqual(['bump_conversation_on_inbound']);

    // Nothing reaches the reply engines until the response is sent.
    expect(h.lifecycle).not.toHaveBeenCalled();
    await flush();
    expect(h.lifecycle).toHaveBeenCalledTimes(1);
    expect(h.lifecycle.mock.calls[0]).toEqual([
      expect.anything(),
      expect.objectContaining({
        accountId: 'acc-1',
        conversationId: conversation.id,
        messageId: 'IN1',
        isFirstInboundMessage: true,
        wasContactCreated: true,
        // TchuekBot is the brain: Davila answers, wacrm must not.
        replyEngines: false,
      }),
    ]);
    expect(h.webhook).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      'conversation.created',
      expect.objectContaining({ conversation_id: conversation.id })
    );
  });

  it('are idempotent: a redelivered event stores and fans out nothing new', async () => {
    const { db, run, flush, one } = setup();
    await run(msg({ id: 'IN1' }));
    await run(msg({ id: 'IN1' }));
    expect(db.rows('messages')).toHaveLength(1);
    expect(one('conversations').unread_count).toBe(1);
    await flush();
    expect(h.lifecycle).toHaveBeenCalledTimes(1);
  });

  it('let the wacrm reply engines answer when wacrm is the brain', async () => {
    const { run, flush } = setup({ brain: 'wacrm' });
    await run(msg({ id: 'IN1' }));
    await flush();
    expect(h.lifecycle.mock.calls[0][1]).toMatchObject({ replyEngines: true });
  });

  it('store media, locations and unsupported messages', async () => {
    const { db, run } = setup();
    await run(
      msg({
        id: 'IMG1',
        kind: 'image',
        text: 'Mon logo',
        media: { url: 'https://storage.test/chat-media/a.jpg', mimeType: 'image/jpeg' },
      }),
      msg({
        id: 'LOC1',
        kind: 'location',
        text: undefined,
        location: { latitude: 3.848, longitude: 11.502, name: 'Tchuek-Tech' },
      }),
      msg({ id: 'ODD1', kind: 'unsupported', text: undefined })
    );
    const byId = Object.fromEntries(db.rows('messages').map((m) => [m.message_id, m]));
    expect(byId.IMG1).toMatchObject({
      content_type: 'image',
      content_text: 'Mon logo',
      media_url: 'https://storage.test/chat-media/a.jpg',
      media_type: 'image/jpeg',
    });
    expect(byId.LOC1).toMatchObject({ content_type: 'location', content_text: 'Tchuek-Tech - 3.848,11.502' });
    expect(byId.ODD1).toMatchObject({ content_type: 'text', content_text: '[Unsupported message]' });
  });
});

describe('outbound messages', () => {
  it('record Davila and phone replies without unread or fan-out', async () => {
    const { db, run, flush, one } = setup();
    await run(
      msg({ id: 'IN1' }),
      msg({ id: 'OUT1', direction: 'outbound', origin: 'davila', chat: { phone: CUSTOMER }, text: 'Bonjour Awa !', timestamp: T + 5 }),
      msg({ id: 'OUT2', direction: 'outbound', origin: 'phone', chat: { phone: CUSTOMER }, text: 'Je vous appelle', timestamp: T + 10 })
    );
    const byId = Object.fromEntries(db.rows('messages').map((m) => [m.message_id, m]));
    expect(byId.OUT1).toMatchObject({ sender_type: 'bot', ai_generated: true, status: 'sent' });
    expect(byId.OUT2).toMatchObject({ sender_type: 'agent', ai_generated: false, status: 'sent' });
    expect(one('conversations')).toMatchObject({ unread_count: 1, last_message_text: 'Je vous appelle' });
    await flush();
    expect(h.lifecycle).toHaveBeenCalledTimes(1);
  });

  it('never bury a newer preview under a late event', async () => {
    const { run, one } = setup();
    await run(
      msg({ id: 'IN1', text: 'Latest' }),
      msg({ id: 'OLD', direction: 'outbound', origin: 'phone', chat: { phone: CUSTOMER }, text: 'Earlier', timestamp: T - 60 })
    );
    expect(one('conversations').last_message_text).toBe('Latest');
  });
});

describe('contact identity', () => {
  it('keeps one contact when a LID-only sender later reveals the number', async () => {
    const { db, run, one } = setup();
    await run(msg({ id: 'L1', chat: { lid: LID, pushName: 'Awa' } }));
    expect(one('contacts')).toMatchObject({ phone: '', wa_lid: LID, name: 'Awa' });

    await run(msg({ id: 'L2', chat: { lid: LID, phone: CUSTOMER } }));
    expect(one('contacts')).toMatchObject({ phone: CUSTOMER, wa_lid: LID });
    expect(db.rows('messages')).toHaveLength(2);
    expect(db.rows('conversations')).toHaveLength(1);
  });

  it('stamps the LID onto a contact known by phone', async () => {
    const { run, one } = setup();
    await run(msg({ id: 'P1' }));
    await run(msg({ id: 'P2', chat: { phone: CUSTOMER, lid: LID } }));
    expect(one('contacts')).toMatchObject({ phone: CUSTOMER, wa_lid: LID });
  });

  it('merges existing LID-only and Phone-only contacts when dual identifiers arrive', async () => {
    const { db, run, one } = setup();
    // 1. Existing LID-only contact
    await run(msg({ id: 'L1', chat: { lid: LID, pushName: 'LID Contact' } }));
    expect(one('contacts')).toMatchObject({ phone: '', wa_lid: LID });

    // 2. Existing Phone-only contact seeded into db
    db.seed('contacts', [
      {
        id: 'c-phone',
        account_id: 'acc-1',
        user_id: 'owner-1',
        phone: CUSTOMER,
        name: 'Phone Contact',
        wa_lid: null,
      },
    ]);
    db.seed('conversations', [
      {
        id: 'conv-phone',
        account_id: 'acc-1',
        contact_id: 'c-phone',
        unread_count: 1,
      },
    ]);
    db.seed('messages', [
      {
        id: 'm-phone',
        conversation_id: 'conv-phone',
        message_id: 'PHONE_MSG',
        sender_type: 'customer',
        content_text: 'Pre-existing phone message',
      },
    ]);

    expect(db.rows('contacts')).toHaveLength(2);

    // 3. Message arrives with BOTH LID and Phone
    await run(msg({ id: 'DUAL1', chat: { lid: LID, phone: CUSTOMER } }));

    // Contacts should be merged into one!
    expect(db.rows('contacts')).toHaveLength(1);
    const unified = one('contacts');
    expect(unified).toMatchObject({
      id: 'c-phone',
      phone: CUSTOMER,
      wa_lid: LID,
    });
    // Conversations merged into one!
    expect(db.rows('conversations')).toHaveLength(1);
    // Messages preserved (L1, PHONE_MSG, DUAL1)
    expect(db.rows('messages')).toHaveLength(3);
  });
});

describe('statuses', () => {
  it('move forward only, and only on this account', async () => {
    const { db, run, flush } = setup();
    db.seed('conversations', [{ id: 'other-conv', account_id: 'acc-2', contact_id: 'c-x' }]);
    db.seed('messages', [{ id: 'other-msg', conversation_id: 'other-conv', message_id: 'OUT1', status: 'sent' }]);
    await run(
      msg({ id: 'IN1' }),
      msg({ id: 'OUT1', direction: 'outbound', origin: 'davila', chat: { phone: CUSTOMER }, timestamp: T + 1 })
    );
    const status = (s: string) => ev('status', { id: 'OUT1', chat: { phone: CUSTOMER }, status: s });
    const ours = () => db.rows('messages').find((m) => m.message_id === 'OUT1' && m.conversation_id !== 'other-conv');

    await run(status('delivered'));
    expect(ours()?.status).toBe('delivered');
    await run(status('read'));
    await run(status('delivered'));
    expect(ours()?.status).toBe('read');
    expect(db.rows('messages').find((m) => m.id === 'other-msg')?.status).toBe('sent');

    await flush();
    const updates = h.webhook.mock.calls.filter((c) => c[2] === 'message.status_updated');
    expect(updates.map((c) => (c[3] as { status: string }).status)).toEqual(['delivered', 'read']);
  });
});

describe('connection and pairing', () => {
  it('rejects events for a number no account is paired with', async () => {
    const { db, run } = setup({ session: null });
    const result = await run(msg({ id: 'X1' }));
    expect(result.accepted).toBe(0);
    expect(result.rejected).toEqual([
      expect.objectContaining({ index: 0, error: `no wacrm account is paired with ${SESSION}` }),
    ]);
    expect(db.rows('messages')).toHaveLength(0);
  });

  it('binds the number on the first connect after a QR pairing', async () => {
    const { db, run, one } = setup({ session: null });
    const result = await run(
      ev('connection', { status: 'connected', me: { phone: SESSION, name: 'Tchuek-Tech' }, pairingRef: REF }),
      msg({ id: 'X2' })
    );
    expect(result).toEqual({ accepted: 2, rejected: [] });
    expect(one('whatsapp_config')).toMatchObject({
      mbowazap_session: SESSION,
      mbowazap_state: 'connected',
      status: 'connected',
      mbowazap_display_name: 'Tchuek-Tech',
      mbowazap_last_event_at: new Date(NOW).toISOString(),
    });
    expect(db.rows('messages')).toHaveLength(1);
  });

  it('refuses a pairing ref that belongs to a different number', async () => {
    const { run } = setup({ session: '237611111111' });
    const result = await run(
      ev('connection', { status: 'connected', me: { phone: SESSION }, pairingRef: REF })
    );
    expect(result.rejected[0].error).toMatch(/pairing 237611111111/);
  });

  it('mirrors disconnects and logouts', async () => {
    const { run, one } = setup();
    await run(ev('connection', { status: 'logged_out', reason: 'unlinked from phone' }));
    expect(one('whatsapp_config')).toMatchObject({ mbowazap_state: 'logged_out', status: 'disconnected' });
  });
});

describe('Davila CRM events', () => {
  it('stores facts in custom fields and fills only a placeholder name', async () => {
    const { db, run, one } = setup();
    await run(msg({ id: 'IN1', chat: { phone: CUSTOMER } }));
    expect(one('contacts').name).toBe(CUSTOMER);

    await run(
      ev('contact.facts', {
        chat: { phone: CUSTOMER },
        facts: { name: 'Awa Ndiaye', businessType: 'Restaurant', interestedPack: 'business' },
      })
    );
    expect(one('contacts').name).toBe('Awa Ndiaye');
    const fields = Object.fromEntries(db.rows('custom_fields').map((f) => [f.field_name, f]));
    expect(Object.keys(fields).sort()).toEqual(['Business type', 'Interested pack']);
    expect(fields['Business type']).toMatchObject({ account_id: 'acc-1', field_type: 'text' });

    await run(
      ev('contact.facts', { chat: { phone: CUSTOMER }, facts: { name: 'Someone Else', businessType: 'Bakery' } })
    );
    expect(one('contacts').name).toBe('Awa Ndiaye');
    const values = db.rows('contact_custom_values');
    expect(values).toHaveLength(2);
    expect(values.find((v) => v.custom_field_id === fields['Business type'].id)?.value).toBe('Bakery');
  });

  it('turns a closed deal into one won deal, however often it is redelivered', async () => {
    const { db, run, one } = setup();
    db.seed('accounts', [{ id: 'acc-1', default_currency: 'XAF' }]);
    db.seed('pipelines', [{ id: 'pipe-1', account_id: 'acc-1', created_at: '2026-01-01T00:00:00Z' }]);
    db.seed('pipeline_stages', [
      { id: 'st-lead', pipeline_id: 'pipe-1', position: 0 },
      { id: 'st-won', pipeline_id: 'pipe-1', position: 3 },
    ]);
    await run(msg({ id: 'IN1' }));
    await run(ev('deal.closed', { chat: { phone: CUSTOMER }, pack: 'Elite' }));
    await run(ev('deal.closed', { chat: { phone: CUSTOMER }, pack: 'Elite' }));

    const deal = one('deals');
    expect(deal).toMatchObject({
      account_id: 'acc-1',
      pipeline_id: 'pipe-1',
      stage_id: 'st-won',
      status: 'won',
      currency: 'XAF',
      contact_id: one('contacts').id,
      conversation_id: one('conversations').id,
    });
    expect(deal.title).toContain('Elite');
    expect(one('tags')).toMatchObject({ name: 'Deal closed', account_id: 'acc-1' });
    expect(db.rows('contact_tags')).toHaveLength(1);
    // tag_added automations fire once, for the new tag only.
    expect(h.automations).toHaveBeenCalledTimes(1);
  });

  it('marks an open deal won instead of opening another', async () => {
    const { db, run, one } = setup();
    db.seed('pipelines', [{ id: 'pipe-1', account_id: 'acc-1' }]);
    db.seed('pipeline_stages', [{ id: 'st-won', pipeline_id: 'pipe-1', position: 5 }]);
    await run(msg({ id: 'IN1' }));
    db.seed('deals', [
      {
        id: 'deal-1',
        account_id: 'acc-1',
        contact_id: one('contacts').id,
        pipeline_id: 'pipe-1',
        stage_id: 'st-lead',
        status: 'open',
        updated_at: '2026-09-01T00:00:00Z',
      },
    ]);
    await run(ev('deal.closed', { chat: { phone: CUSTOMER } }));
    expect(one('deals')).toMatchObject({ id: 'deal-1', status: 'won', stage_id: 'st-won' });
  });

  it('records deal closed with custom value, currency and external deal id', async () => {
    const { db, run, one } = setup();
    db.seed('accounts', [{ id: 'acc-1', default_currency: 'USD' }]);
    db.seed('pipelines', [{ id: 'pipe-1', account_id: 'acc-1', created_at: '2026-01-01T00:00:00Z' }]);
    db.seed('pipeline_stages', [
      { id: 'st-lead', pipeline_id: 'pipe-1', position: 0 },
      { id: 'st-won', pipeline_id: 'pipe-1', position: 3 },
    ]);
    await run(msg({ id: 'IN1' }));
    await run(
      ev('deal.closed', {
        chat: { phone: CUSTOMER },
        pack: 'Enterprise',
        value: 250000,
        currency: 'XAF',
        externalDealId: 'ext-999',
      })
    );

    const deal = one('deals');
    expect(deal).toMatchObject({
      status: 'won',
      value: 250000,
      currency: 'XAF',
    });
    expect(deal.notes).toContain('[ID: ext-999]');
  });

  it('tags form submissions and opt-outs, and mirrors pauses onto the AI flag', async () => {
    const { db, run, one } = setup();
    await run(msg({ id: 'IN1' }));
    await run(ev('tally.submitted', { chat: { phone: CUSTOMER } }));
    await run(ev('ai.paused', { chat: { phone: CUSTOMER }, until: NOW + 3_600_000 }));
    expect(one('conversations').ai_autoreply_disabled).toBe(true);
    await run(ev('ai.paused', { chat: { phone: CUSTOMER }, until: null }));
    expect(one('conversations').ai_autoreply_disabled).toBe(false);
    await run(ev('contact.opted_out', { chat: { phone: CUSTOMER } }));
    expect(one('conversations').ai_autoreply_disabled).toBe(true);
    expect(db.rows('tags').map((t) => t.name).sort()).toEqual(['Opted out', 'Tally submitted']);
  });

  it('skips duplicate events via mbowazap_events table on batch replay', async () => {
    const { db, run } = setup();
    const event1 = msg({ id: 'IN1' });
    const res1 = await run(event1);
    expect(res1).toEqual({ accepted: 1, rejected: [] });
    expect(db.rows('messages')).toHaveLength(1);
    expect(db.rows('mbowazap_events')).toHaveLength(1);
    expect(db.rows('mbowazap_events')[0]).toMatchObject({
      event_id: event1.eventId,
      session: SESSION,
      event_type: 'message',
    });

    // Replay the exact same event
    const res2 = await run(event1);
    expect(res2).toEqual({ accepted: 1, rejected: [] });
    // Still exactly 1 message in CRM, zero duplicate records
    expect(db.rows('messages')).toHaveLength(1);
    expect(db.rows('mbowazap_events')).toHaveLength(1);
  });
});

describe('reactions', () => {
  it('records customer reactions and ignores the owner reacting from the phone', async () => {
    const { db, run } = setup();
    await run(
      msg({ id: 'IN1' }),
      msg({ id: 'OUT1', direction: 'outbound', origin: 'davila', chat: { phone: CUSTOMER }, timestamp: T + 1 })
    );
    const target = db.rows('messages').find((m) => m.message_id === 'OUT1')!;
    const reaction = (emoji: string, fromMe = false) =>
      ev('reaction', { id: `R${seq}`, chat: { phone: CUSTOMER }, targetId: 'OUT1', emoji, fromMe });

    await run(reaction('❤️'));
    expect(db.rows('message_reactions')).toEqual([
      expect.objectContaining({ message_id: target.id, actor_type: 'customer', emoji: '❤️' }),
    ]);
    await run(reaction('👍', true));
    expect(db.rows('message_reactions')).toHaveLength(1);
    await run(reaction(''));
    expect(db.rows('message_reactions')).toHaveLength(0);
  });
});

describe('storage failures', () => {
  it('fail the whole batch so the bot retries it', async () => {
    const { db, run } = setup();
    db.failNext = { table: 'messages', op: 'upsert', error: { message: 'connection reset' } };
    await expect(run(msg({ id: 'F1' }))).rejects.toThrow(/message insert failed: connection reset/);
  });
});
