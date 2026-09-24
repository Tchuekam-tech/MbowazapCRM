import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signBridgeRequest } from '@/lib/mbowazap/signature';
import { wacrmFakeDb, type FakeDb } from '@/lib/mbowazap/testing/fake-supabase';

const h = vi.hoisted(() => ({ db: null as FakeDb | null }));

vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => h.db!.client() }));

import { POST } from './route';

const SECRET = 'route-test-secret-0123456789abcdefghij';
const SESSION = '237600000001';

function request(
  query: string,
  body: Uint8Array,
  { contentType = 'image/jpeg', signedQuery = query }: { contentType?: string; signedQuery?: string } = {}
): Request {
  const signed = signBridgeRequest({
    method: 'POST',
    pathAndQuery: `/api/mbowazap/media?${signedQuery}`,
    body,
    secret: SECRET,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  return new Request(`https://crm.example.com/api/mbowazap/media?${query}`, {
    method: 'POST',
    headers: { 'content-type': contentType, ...signed },
    body: Buffer.from(body),
  });
}

async function call(req: Request) {
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
}

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeEach(() => {
  vi.stubEnv('MBOWAZAP_SECRET', SECRET);
  h.db = wacrmFakeDb();
  h.db.seed('whatsapp_config', [
    { id: 'cfg-1', account_id: 'acc-1', user_id: 'owner-1', provider: 'mbowazap', mbowazap_session: SESSION },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/mbowazap/media', () => {
  it("stores the file in the account's chat-media folder and returns its URL", async () => {
    const { status, json } = await call(
      request(`session=${SESSION}&filename=voice%20note.ogg`, bytes, {
        contentType: 'audio/ogg; codecs=opus',
      })
    );
    expect(status).toBe(200);
    const [upload] = h.db!.uploads;
    expect(upload).toMatchObject({ bucket: 'chat-media', contentType: 'audio/ogg', size: bytes.length });
    expect(upload.path).toMatch(/^account-acc-1\/mbowazap\/\d+-voice_note\.ogg$/);
    expect(json).toEqual({
      ok: true,
      url: `https://storage.test/chat-media/${upload.path}`,
      mimeType: 'audio/ogg',
      sizeBytes: bytes.length,
    });
  });

  it('refuses a query changed after signing', async () => {
    const { status } = await call(
      request(`session=${SESSION}&filename=b.jpg`, bytes, { signedQuery: `session=${SESSION}&filename=a.jpg` })
    );
    expect(status).toBe(401);
    expect(h.db!.uploads).toHaveLength(0);
  });

  it('refuses bad sessions, unknown numbers and empty bodies', async () => {
    expect((await call(request('session=temp_qr', bytes))).status).toBe(400);
    const unknown = await call(request('session=237611111111', bytes));
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe('not_found');
    expect((await call(request(`session=${SESSION}`, new Uint8Array()))).status).toBe(400);
  });

  it('answers 415 when the bucket rejects the type', async () => {
    h.db!.failNextUpload = { message: 'mime type application/x-msdownload is not supported' };
    const { status, json } = await call(
      request(`session=${SESSION}&filename=setup.exe`, bytes, { contentType: 'application/x-msdownload' })
    );
    expect(status).toBe(415);
    expect(json.error.code).toBe('unsupported_media');
  });

  it('rejects bodies larger than 16 MB with 413', async () => {
    const req = request(`session=${SESSION}&filename=large.jpg`, bytes);
    // Mock declared content-length exceeding 16 MB
    const largeReq = new Request(req.url, {
      method: req.method,
      headers: {
        ...Object.fromEntries(req.headers.entries()),
        'content-length': String(17 * 1024 * 1024),
      },
      body: bytes,
    });
    const { status, json } = await call(largeReq);
    expect(status).toBe(413);
    expect(json.error.code).toBe('payload_too_large');
  });

  it('rejects requests when MBOWAZAP_SECRET is not configured', async () => {
    vi.stubEnv('MBOWAZAP_SECRET', '');
    const { status, json } = await call(request(`session=${SESSION}`, bytes));
    expect(status).toBe(503);
    expect(json.error.code).toBe('bridge_not_configured');
  });
});
