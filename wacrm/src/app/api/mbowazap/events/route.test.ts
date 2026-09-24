import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signBridgeRequest } from '@/lib/mbowazap/signature';
import { wacrmFakeDb, type FakeDb } from '@/lib/mbowazap/testing/fake-supabase';

const h = vi.hoisted(() => {
  type Spy = (...args: unknown[]) => Promise<void>;
  return {
    db: null as FakeDb | null,
    after: [] as (() => Promise<void>)[],
    lifecycle: vi.fn<Spy>(async () => {}),
  };
});

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => Promise<void>) => h.after.push(cb) };
});
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => h.db!.client() }));
vi.mock('@/lib/whatsapp/inbound/lifecycle', () => ({ dispatchInboundLifecycle: h.lifecycle }));
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: vi.fn(async () => {}) }));

import { POST } from './route';

const SECRET = 'route-test-secret-0123456789abcdefghij';
const SESSION = '237600000001';
const PATH = '/api/mbowazap/events';

function request(
  body: string,
  { secret = SECRET, headers = {} }: { secret?: string; headers?: Record<string, string> } = {}
): Request {
  const signed = signBridgeRequest({
    method: 'POST',
    pathAndQuery: PATH,
    body,
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  return new Request(`https://crm.example.com${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signed, ...headers },
    body,
  });
}

function batch(events: unknown[], session = SESSION): string {
  return JSON.stringify({ protocol: '1', session, createdAt: Date.now(), events });
}

const message = {
  eventId: '00000000-0000-4000-8000-000000000001',
  type: 'message',
  at: Date.now(),
  id: '3EB0AAA',
  direction: 'inbound',
  origin: 'customer',
  chat: { phone: '237699000001', pushName: 'Awa' },
  timestamp: Math.floor(Date.now() / 1000),
  kind: 'text',
  text: 'Bonjour',
};

async function call(req: Request) {
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  vi.stubEnv('MBOWAZAP_SECRET', SECRET);
  h.after = [];
  h.db = wacrmFakeDb();
  h.db.seed('whatsapp_config', [
    {
      id: 'cfg-1',
      account_id: 'acc-1',
      user_id: 'owner-1',
      provider: 'mbowazap',
      mbowazap_session: SESSION,
      mbowazap_brain: 'tchuekbot',
    },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/mbowazap/events', () => {
  it('fails closed while MBOWAZAP_SECRET is unset', async () => {
    vi.stubEnv('MBOWAZAP_SECRET', '');
    const { status, json } = await call(request(batch([message])));
    expect(status).toBe(503);
    expect(json.error.code).toBe('bridge_not_configured');
  });

  it('refuses unsigned, mis-signed and wrong-protocol requests', async () => {
    const body = batch([message]);
    const unsigned = new Request(`https://crm.example.com${PATH}`, { method: 'POST', body });
    expect((await call(unsigned)).status).toBe(401);
    expect((await call(request(body, { secret: 'x'.repeat(40) }))).status).toBe(401);
    const wrongProtocol = await call(request(body, { headers: { 'x-mbowazap-protocol': '2' } }));
    expect(wrongProtocol.status).toBe(400);
    expect(wrongProtocol.json.error.code).toBe('unsupported_protocol');
    expect(h.db!.rows('messages')).toHaveLength(0);
  });

  it('refuses bodies that are not a valid batch', async () => {
    expect((await call(request('{nope'))).json.error.message).toMatch(/valid JSON/);
    const badEnvelope = await call(request(JSON.stringify({ protocol: '9', events: [] })));
    expect(badEnvelope.status).toBe(400);
  });

  it('stores the batch, reports rejects at their sent positions, and fans out afterwards', async () => {
    const { status, json } = await call(
      request(batch([{ ...message, eventId: '00000000-0000-4000-8000-000000000009', type: 'bogus' }, message]))
    );
    expect(status).toBe(200);
    expect(json).toEqual({
      ok: true,
      accepted: 1,
      rejected: [expect.objectContaining({ index: 0, error: expect.stringMatching(/type must be one of/) })],
    });
    expect(h.db!.rows('messages')).toHaveLength(1);

    expect(h.lifecycle).not.toHaveBeenCalled();
    for (const task of h.after) await task();
    expect(h.lifecycle).toHaveBeenCalledTimes(1);
  });

  it('maps ingest rejections back to the positions the bot sent', async () => {
    const { json } = await call(
      request(
        batch(
          [{ ...message, eventId: '00000000-0000-4000-8000-000000000009', type: 'bogus' }, message],
          '237611111111'
        )
      )
    );
    expect(json.accepted).toBe(0);
    expect(json.rejected.map((r: { index: number }) => r.index)).toEqual([0, 1]);
    expect(json.rejected[1].error).toMatch(/no wacrm account is paired with 237611111111/);
  });

  it('answers 503 when storage fails, so the bot retries', async () => {
    h.db!.failNext = { table: 'messages', op: 'upsert', error: { message: 'connection reset' } };
    const { status, json } = await call(request(batch([message])));
    expect(status).toBe(503);
    expect(json.error.code).toBe('internal_error');
  });

  it('refuses oversized bodies', async () => {
    const big = 'x'.repeat(1024 * 1024 + 1);
    const { status } = await call(request(big));
    expect(status).toBe(413);
  });
});
