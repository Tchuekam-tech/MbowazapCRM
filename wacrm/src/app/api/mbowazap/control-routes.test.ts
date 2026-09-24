import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  return {
    accountContext: {
      supabase: null as any,
      userId: 'user-admin',
      accountId: 'acct-1',
      role: 'admin',
      account: { id: 'acct-1', name: 'Acme Corp' },
    },
    clientMock: {
      ping: vi.fn(),
      getSession: vi.fn(),
      pair: vi.fn(),
      setBrain: vi.fn(),
      logout: vi.fn(),
    },
    upsertError: null as { code?: string; message: string } | null,
  };
});

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(async () => h.accountContext),
  requireRole: vi.fn(async (min: string) => {
    if (min === 'admin' && h.accountContext.role !== 'admin' && h.accountContext.role !== 'owner') {
      const err = new Error("Forbidden");
      (err as any).status = 403;
      throw err;
    }
    return h.accountContext;
  }),
  toErrorResponse: (err: any) => {
    const status = err.status || 500;
    return new Response(JSON.stringify({ error: err.message }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  },
}));

vi.mock('@/lib/mbowazap/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mbowazap/client')>();
  return {
    ...actual,
    createMbowazapClient: () => h.clientMock,
  };
});

import { MbowazapBridgeError } from '@/lib/mbowazap/client';
import { GET as getSession } from './session/route';
import { GET as getStatus } from './status/route';
import { POST as postPair } from './pair/route';
import { GET as getPoll } from './poll/route';
import { PUT as putBrain } from './brain/route';
import { POST as postDisconnect } from './disconnect/route';
import { POST as postQr } from './qr/route';

describe('MboWazap Gateway Control Routes', () => {
  let storedConfig: Record<string, any> | null = null;
  const SECRET = '0123456789abcdef0123456789abcdef';
  const BOT_URL = 'https://bot.example.com';

  beforeEach(() => {
    vi.stubEnv('MBOWAZAP_BOT_URL', BOT_URL);
    vi.stubEnv('MBOWAZAP_SECRET', SECRET);
    h.accountContext.role = 'admin';

    storedConfig = {
      id: 'cfg-1',
      account_id: 'acct-1',
      provider: 'mbowazap',
      mbowazap_session: '237653683174',
      mbowazap_pairing_ref: '00000000-0000-4000-8000-000000000001',
      mbowazap_state: 'connected',
      mbowazap_display_name: 'TchuekBot Host',
      mbowazap_brain: 'tchuekbot',
      mbowazap_last_event_at: '2026-09-24T00:00:00.000Z',
      connected_at: '2026-09-24T00:00:00.000Z',
      status: 'connected',
    };

    h.accountContext.supabase = {
      from: (table: string) => {
        if (table !== 'whatsapp_config') throw new Error(`Unexpected table ${table}`);
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: storedConfig, error: null }),
              eq: (_col2: string, val2: string) => ({
                maybeSingle: async () => {
                  if (storedConfig && storedConfig.mbowazap_pairing_ref === val2) {
                    return { data: storedConfig, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
          }),
          upsert: async (patch: any) => {
            if (h.upsertError) return { error: h.upsertError };
            storedConfig = { ...(storedConfig || {}), ...patch };
            return { error: null };
          },
          delete: () => ({
            eq: () => {
              storedConfig = null;
              return Promise.resolve({ error: null });
            },
          }),
          update: (patch: any) => ({
            eq: (_col: string, _val: string) => {
              storedConfig = { ...(storedConfig || {}), ...patch };
              return Promise.resolve({ error: null });
            },
          }),
        };
      },
    };

    vi.clearAllMocks();
    h.upsertError = null;
    h.clientMock.ping.mockResolvedValue({ protocol: '1', time: Date.now() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /api/mbowazap/session', () => {
    it('returns configured status and session info', async () => {
      h.clientMock.getSession.mockResolvedValueOnce({
        session: '237653683174',
        status: 'connected',
        davila: true,
      });

      const res = await getSession();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.configured).toBe(true);
      expect(json.session).toBe('237653683174');
      expect(json.state).toBe('connected');
      expect(json.brain).toBe('tchuekbot');
      expect(json.live).toEqual({
        session: '237653683174',
        status: 'connected',
        davila: true,
      });
    });

    it('reports unconfigured when env variables are missing', async () => {
      vi.stubEnv('MBOWAZAP_SECRET', '');

      const res = await getSession();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.configured).toBe(false);
      expect(json.configIssues.length).toBeGreaterThan(0);
      expect(h.clientMock.getSession).not.toHaveBeenCalled();
    });

    it('still answers with stored state when TchuekBot is unreachable', async () => {
      h.clientMock.getSession.mockRejectedValueOnce(
        new MbowazapBridgeError('network_error', 'Could not reach TchuekBot: ECONNREFUSED')
      );

      const res = await getSession();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.state).toBe('connected');
      expect(json.live).toBeNull();
      expect(json.liveError).toEqual({
        code: 'network_error',
        message: 'Could not reach TchuekBot: ECONNREFUSED',
      });
    });
  });

  describe('POST /api/mbowazap/pair', () => {
    it('validates method and phone number', async () => {
      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'code', phone: '12' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Phone number must be between 6 and 15 digits/);
    });

    it('rejects pairing when already connected', async () => {
      h.clientMock.getSession.mockResolvedValueOnce({
        session: '237653683174',
        status: 'connected',
        me: null,
        davila: true,
      });
      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'code', phone: '+237 653 683 174' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.code).toBe('already_connected');
      expect(h.clientMock.pair).not.toHaveBeenCalled();
    });

    it('pairs again when the stored connection no longer exists on the bot', async () => {
      h.clientMock.getSession.mockResolvedValueOnce({
        session: '237653683174',
        status: 'disconnected',
        me: null,
        davila: true,
      });
      h.clientMock.pair.mockResolvedValueOnce({
        method: 'qr',
        qr: 'data:image/png;base64,fresh',
        session: 'temp_qr',
      });
      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'qr' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.qr).toBe('data:image/png;base64,fresh');
      expect(storedConfig?.mbowazap_state).toBe('pairing');
      expect(storedConfig?.mbowazap_session).toBeNull();
    });

    it('refuses while the Cloud API connection is live', async () => {
      storedConfig = { provider: 'meta', status: 'connected', phone_number_id: '1', access_token: 'x' };
      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'qr' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('provider_conflict');
      expect(h.clientMock.pair).not.toHaveBeenCalled();
    });

    it('explains a secret mismatch and leaves no pairing open', async () => {
      storedConfig!.mbowazap_state = 'disconnected';
      h.clientMock.pair.mockRejectedValueOnce(
        new MbowazapBridgeError('unauthorized', 'Invalid or missing bridge signature', 401)
      );
      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'code', phone: '237653683174' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.code).toBe('unauthorized');
      expect(json.error).toMatch(/MBOWAZAP_SECRET must be identical/);
      expect(storedConfig?.mbowazap_state).toBe('disconnected');
    });

    it('reports a number linked to another account', async () => {
      storedConfig = null;
      h.upsertError = { code: '23505', message: 'duplicate key value' };
      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'code', phone: '237653683174' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('already_linked_elsewhere');
    });

    it("takes back this account's number when the bot still holds its link", async () => {
      storedConfig!.mbowazap_state = 'disconnected';
      h.clientMock.pair.mockRejectedValueOnce(
        new MbowazapBridgeError('already_connected', '237653683174 is already linked', 409)
      );
      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'code', phone: '237653683174' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('connected');
      expect(storedConfig?.mbowazap_state).toBe('connected');
      expect(h.clientMock.logout).not.toHaveBeenCalled();
    });

    it('unlinks an orphaned link on the bot before pairing a new number', async () => {
      storedConfig = null;
      h.clientMock.pair
        .mockRejectedValueOnce(
          new MbowazapBridgeError('already_connected', '237600000009 is already linked', 409)
        )
        .mockResolvedValueOnce({ method: 'code', code: 'WXYZ-9876', session: '237600000009' });
      h.clientMock.logout.mockResolvedValueOnce({ session: '237600000009', status: 'disconnected' });
      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'code', phone: '237600000009' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(200);
      expect((await res.json()).code).toBe('WXYZ-9876');
      expect(h.clientMock.logout).toHaveBeenCalledWith('237600000009');
    });

    it('successfully initiates pairing code with TchuekBot', async () => {
      storedConfig!.mbowazap_state = 'disconnected';
      storedConfig!.mbowazap_session = null;

      h.clientMock.pair.mockResolvedValueOnce({
        method: 'code',
        code: 'ABCD-1234',
        session: '237653683174',
      });

      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'code', phone: '+237 653 683 174' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.method).toBe('code');
      expect(json.code).toBe('ABCD-1234');
      expect(json.pairingRef).toBeTruthy();
      expect(storedConfig?.mbowazap_state).toBe('pairing');
    });

    it('successfully initiates QR pairing with TchuekBot', async () => {
      storedConfig!.mbowazap_state = 'disconnected';
      storedConfig!.mbowazap_session = null;

      h.clientMock.pair.mockResolvedValueOnce({
        method: 'qr',
        qr: 'data:image/png;base64,mockqr',
        session: 'temp_qr',
      });

      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'qr' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.method).toBe('qr');
      expect(json.qr).toBe('data:image/png;base64,mockqr');
    });
  });

  describe('POST /api/mbowazap/qr', () => {
    const REF = '00000000-0000-4000-8000-000000000001';
    const qrRequest = (pairingRef: string) =>
      new NextRequest('http://localhost/api/mbowazap/qr', {
        method: 'POST',
        body: JSON.stringify({ pairingRef }),
      });

    it('returns a fresh QR and extends the pairing', async () => {
      storedConfig = {
        ...storedConfig,
        mbowazap_state: 'pairing',
        mbowazap_session: null,
        updated_at: new Date(Date.now() - 100_000).toISOString(),
      };
      h.clientMock.pair.mockResolvedValueOnce({
        method: 'qr',
        qr: 'data:image/png;base64,rotated',
        session: 'temp_qr',
      });
      const res = await postQr(qrRequest(REF));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.qr).toBe('data:image/png;base64,rotated');
      expect(h.clientMock.pair).toHaveBeenCalledWith({ pairingRef: REF, method: 'qr' });
      expect(Date.parse(storedConfig!.updated_at)).toBeGreaterThan(Date.now() - 5_000);
    });

    it('refuses a pairing that was replaced', async () => {
      const res = await postQr(qrRequest('00000000-0000-4000-8000-00000000abcd'));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('pairing_superseded');
      expect(h.clientMock.pair).not.toHaveBeenCalled();
    });

    it('says connected once the scan has linked the number', async () => {
      const res = await postQr(qrRequest(REF));
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('connected');
    });

    it('validates the pairing ref', async () => {
      const res = await postQr(qrRequest('not-a-uuid'));
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/mbowazap/poll', () => {
    it('marks the pairing connected when the bot already reports the link', async () => {
      storedConfig = { ...storedConfig, mbowazap_state: 'pairing', status: 'disconnected' };
      h.clientMock.getSession.mockResolvedValueOnce({
        session: '237653683174',
        status: 'connected',
        me: { phone: '237653683174', name: 'Biz' },
        davila: true,
      });
      const req = new NextRequest(
        'http://localhost/api/mbowazap/poll?ref=00000000-0000-4000-8000-000000000001'
      );
      const res = await getPoll(req);
      const json = await res.json();
      expect(json.connected).toBe(true);
      expect(json.displayName).toBe('Biz');
      expect(storedConfig?.mbowazap_state).toBe('connected');
      expect(storedConfig?.status).toBe('connected');
    });

    it('keeps waiting while the bot is still pairing', async () => {
      storedConfig = { ...storedConfig, mbowazap_state: 'pairing', status: 'disconnected' };
      h.clientMock.getSession.mockResolvedValueOnce({
        session: '237653683174',
        status: 'pairing',
        me: null,
        davila: true,
      });
      const req = new NextRequest(
        'http://localhost/api/mbowazap/poll?ref=00000000-0000-4000-8000-000000000001'
      );
      const json = await (await getPoll(req)).json();
      expect(json.connected).toBe(false);
      expect(json.state).toBe('pairing');
      expect(storedConfig?.mbowazap_state).toBe('pairing');
    });

    it('returns connected true when pairing succeeds', async () => {
      const req = new NextRequest(
        'http://localhost/api/mbowazap/poll?ref=00000000-0000-4000-8000-000000000001'
      );
      const res = await getPoll(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.connected).toBe(true);
      expect(json.session).toBe('237653683174');
    });

    it('returns connected false when still pairing or ref unknown', async () => {
      const req = new NextRequest(
        'http://localhost/api/mbowazap/poll?ref=non-existent-ref'
      );
      const res = await getPoll(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.connected).toBe(false);
    });
  });

  describe('PUT /api/mbowazap/brain', () => {
    it('validates brain value', async () => {
      const req = new NextRequest('http://localhost/api/mbowazap/brain', {
        method: 'PUT',
        body: JSON.stringify({ brain: 'invalid' }),
      });
      const res = await putBrain(req);
      expect(res.status).toBe(400);
    });

    it('switches brain and notifies TchuekBot', async () => {
      h.clientMock.setBrain.mockResolvedValueOnce({
        session: '237653683174',
        davila: false,
      });

      const req = new NextRequest('http://localhost/api/mbowazap/brain', {
        method: 'PUT',
        body: JSON.stringify({ brain: 'wacrm' }),
      });
      const res = await putBrain(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.brain).toBe('wacrm');
      expect(storedConfig?.mbowazap_brain).toBe('wacrm');
      expect(h.clientMock.setBrain).toHaveBeenCalledWith('237653683174', false);
    });

    it('still tells TchuekBot while the session is reconnecting', async () => {
      storedConfig!.mbowazap_state = 'disconnected';
      h.clientMock.setBrain.mockResolvedValueOnce({
        session: '237653683174',
        davila: false,
      });

      const req = new NextRequest('http://localhost/api/mbowazap/brain', {
        method: 'PUT',
        body: JSON.stringify({ brain: 'wacrm' }),
      });
      const res = await putBrain(req);
      expect(res.status).toBe(200);
      expect(h.clientMock.setBrain).toHaveBeenCalledWith('237653683174', false);
    });
  });

  describe('POST /api/mbowazap/disconnect', () => {
    it('logs out session from bot and resets state', async () => {
      h.clientMock.logout.mockResolvedValueOnce({
        session: '237653683174',
        status: 'disconnected',
      });

      const res = await postDisconnect();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.disconnected).toBe(true);
      expect(h.clientMock.logout).toHaveBeenCalledWith('237653683174');
      // No Cloud API credentials on the row: the connection is removed
      // (blanking it would violate the provider-shape CHECK).
      expect(storedConfig).toBeNull();
    });

    it('hands the row back to saved Cloud API credentials', async () => {
      storedConfig = { ...storedConfig, phone_number_id: '1098765', access_token: 'enc' };
      h.clientMock.logout.mockResolvedValueOnce({
        session: '237653683174',
        status: 'disconnected',
      });
      const res = await postDisconnect();
      expect(res.status).toBe(200);
      expect(storedConfig?.provider).toBe('meta');
      expect(storedConfig?.status).toBe('disconnected');
      expect(storedConfig?.mbowazap_session).toBeNull();
      expect(storedConfig?.mbowazap_pairing_ref).toBeNull();
    });

    it('warns when the bot could not unlink the device', async () => {
      h.clientMock.logout.mockRejectedValueOnce(
        new MbowazapBridgeError('network_error', 'Could not reach TchuekBot')
      );
      const res = await postDisconnect();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.botLogout).toBe('failed');
      expect(json.warning).toMatch(/Linked devices/);
    });
  });

  describe('GET /api/mbowazap/status', () => {
    it('returns normalized connected status when linked', async () => {
      h.clientMock.getSession.mockResolvedValueOnce({
        session: '237653683174',
        status: 'connected',
        davila: true,
      });

      const req = new NextRequest('http://localhost/api/mbowazap/status');
      const res = await getStatus(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.status).toBe('connected');
      expect(json.phone).toBe('+237653683174');
      expect(json.provider).toBe('mbowazap');
    });

    it('returns disconnected when provider is not mbowazap', async () => {
      storedConfig = { ...storedConfig, provider: 'meta' };
      const req = new NextRequest('http://localhost/api/mbowazap/status');
      const res = await getStatus(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.status).toBe('disconnected');
    });

    it('reports a bot that does not answer', async () => {
      h.clientMock.ping.mockRejectedValueOnce(
        new MbowazapBridgeError('unauthorized', 'Invalid or missing bridge signature', 401)
      );
      const req = new NextRequest('http://localhost/api/mbowazap/status');
      const json = await (await getStatus(req)).json();
      expect(json.bot.reachable).toBe(false);
      expect(json.bot.code).toBe('unauthorized');
      expect(json.bot.error).toMatch(/MBOWAZAP_SECRET/);
      expect(h.clientMock.getSession).not.toHaveBeenCalled();
    });

    it('normalizes expired pairing sessions', async () => {
      storedConfig = {
        ...storedConfig,
        mbowazap_state: 'pairing',
        updated_at: new Date(Date.now() - 150_000).toISOString(),
      };
      const req = new NextRequest('http://localhost/api/mbowazap/status');
      const res = await getStatus(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.status).toBe('expired');
      expect(json.failureReason).toContain('expired');
    });
  });
});
