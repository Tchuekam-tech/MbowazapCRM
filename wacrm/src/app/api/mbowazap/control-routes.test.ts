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
      getSession: vi.fn(),
      pair: vi.fn(),
      setBrain: vi.fn(),
      logout: vi.fn(),
    },
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
import { POST as postQrRefresh } from './pair/qr/route';
import { GET as getPoll } from './poll/route';
import { PUT as putBrain } from './brain/route';
import { POST as postDisconnect } from './disconnect/route';

describe('MboWazap Gateway Control Routes', () => {
  let storedConfig: Record<string, any> | null = null;
  let nextUpsertError: { code: string; message: string } | null = null;
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
            if (nextUpsertError) {
              const error = nextUpsertError;
              nextUpsertError = null;
              return { error };
            }
            storedConfig = { ...(storedConfig || {}), ...patch };
            return { error: null };
          },
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    nextUpsertError = null;
    for (const fn of Object.values(h.clientMock)) fn.mockReset();
  });

  function pairRequest(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/mbowazap/pair', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  function qrRefreshRequest(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/mbowazap/pair/qr', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

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

    it('lets an admin re-pair when the bot no longer holds the stored session', async () => {
      // e.g. TchuekBot was redeployed without a persistent volume.
      h.clientMock.getSession.mockResolvedValueOnce({
        session: '237653683174',
        status: 'disconnected',
        me: null,
        davila: true,
      });
      h.clientMock.pair.mockResolvedValueOnce({
        method: 'code',
        code: 'ABCD-1234',
        session: '237653683174',
      });

      const res = await postPair(pairRequest({ method: 'code', phone: '237653683174' }));
      expect(res.status).toBe(200);
      expect(storedConfig?.mbowazap_state).toBe('pairing');
    });

    it('keeps waiting while the QR is still being generated', async () => {
      vi.useFakeTimers();
      storedConfig!.mbowazap_state = 'disconnected';
      storedConfig!.mbowazap_session = null;
      h.clientMock.pair
        .mockRejectedValueOnce(new MbowazapBridgeError('pairing_pending', 'not yet', 503))
        .mockRejectedValueOnce(new MbowazapBridgeError('pairing_pending', 'not yet', 503))
        .mockResolvedValueOnce({ method: 'qr', qr: 'data:image/png;base64,late', session: 'temp_qr' });

      const pending = postPair(pairRequest({ method: 'qr' }));
      await vi.advanceTimersByTimeAsync(5_000);
      const res = await pending;

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.qr).toBe('data:image/png;base64,late');
      expect(h.clientMock.pair).toHaveBeenCalledTimes(3);
    });

    it('answers a QR that never arrives with a clear 503, not "Internal server error"', async () => {
      vi.useFakeTimers();
      storedConfig!.mbowazap_state = 'disconnected';
      storedConfig!.mbowazap_session = null;
      h.clientMock.pair.mockRejectedValue(
        new MbowazapBridgeError('pairing_pending', 'not yet', 503)
      );

      const pending = postPair(pairRequest({ method: 'qr' }));
      await vi.advanceTimersByTimeAsync(40_000);
      const res = await pending;

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.code).toBe('pairing_pending');
      expect(json.error).toMatch(/QR code/);
      // Nothing recorded: the account is not left stuck in "pairing".
      expect(storedConfig?.mbowazap_state).toBe('disconnected');
    });

    it('explains an unreachable bot and leaves the stored state untouched', async () => {
      storedConfig!.mbowazap_state = 'disconnected';
      storedConfig!.mbowazap_session = null;
      const refBefore = storedConfig!.mbowazap_pairing_ref;
      h.clientMock.pair.mockRejectedValueOnce(
        new MbowazapBridgeError('network_error', 'Could not reach TchuekBot: fetch failed')
      );

      const res = await postPair(pairRequest({ method: 'code', phone: '237653683174' }));
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.code).toBe('network_error');
      expect(json.error).toMatch(/MBOWAZAP_BOT_URL/);
      expect(storedConfig?.mbowazap_state).toBe('disconnected');
      expect(storedConfig?.mbowazap_pairing_ref).toBe(refBefore);
    });

    it('reports a secret mismatch as a gateway error, not as the caller being signed out', async () => {
      storedConfig!.mbowazap_state = 'disconnected';
      h.clientMock.pair.mockRejectedValueOnce(
        new MbowazapBridgeError('unauthorized', 'Invalid or missing bridge signature', 401)
      );

      const res = await postPair(pairRequest({ method: 'qr' }));
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toMatch(/MBOWAZAP_SECRET must be identical/);
    });

    it('passes on the bot’s pairing failure reason', async () => {
      storedConfig!.mbowazap_state = 'disconnected';
      h.clientMock.pair.mockRejectedValueOnce(
        new MbowazapBridgeError(
          'pairing_failed',
          'Failed to request pairing code: WhatsApp did not accept the connection within 25s',
          502
        )
      );

      const res = await postPair(pairRequest({ method: 'code', phone: '237653683174' }));
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.code).toBe('pairing_failed');
      expect(json.error).toMatch(/did not accept the connection/);
    });

    it('rejects a number linked to another account with 409', async () => {
      storedConfig!.mbowazap_state = 'disconnected';
      storedConfig!.mbowazap_session = null;
      h.clientMock.pair.mockResolvedValueOnce({
        method: 'code',
        code: 'ABCD-1234',
        session: '237600000009',
      });
      nextUpsertError = { code: '23505', message: 'duplicate key value' };

      const res = await postPair(pairRequest({ method: 'code', phone: '237600000009' }));
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/already linked to another wacrm account/);
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

  describe('POST /api/mbowazap/pair/qr', () => {
    const REF = '00000000-0000-4000-8000-000000000002';

    function qrPairingInFlight() {
      storedConfig = {
        ...storedConfig,
        mbowazap_state: 'pairing',
        mbowazap_session: null,
        mbowazap_pairing_ref: REF,
      };
    }

    it('returns the bot’s current QR for the pairing in flight', async () => {
      qrPairingInFlight();
      h.clientMock.pair.mockResolvedValueOnce({
        method: 'qr',
        qr: 'data:image/png;base64,rotated',
        session: 'temp_qr',
      });

      const res = await postQrRefresh(qrRefreshRequest({ pairingRef: REF }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, qr: 'data:image/png;base64,rotated' });
      expect(h.clientMock.pair).toHaveBeenCalledWith({ pairingRef: REF, method: 'qr' });
    });

    it('refuses once the pairing is no longer a waiting QR pairing', async () => {
      // Connected already (the default fixture), under another ref.
      let res = await postQrRefresh(qrRefreshRequest({ pairingRef: REF }));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('pairing_closed');

      // A code pairing carries its number from the start.
      qrPairingInFlight();
      storedConfig!.mbowazap_session = '237653683174';
      res = await postQrRefresh(qrRefreshRequest({ pairingRef: REF }));
      expect(res.status).toBe(409);
      expect(h.clientMock.pair).not.toHaveBeenCalled();
    });

    it('validates the pairing ref', async () => {
      const res = await postQrRefresh(qrRefreshRequest({ pairingRef: 'nope' }));
      expect(res.status).toBe(400);
    });

    it('maps bridge failures to readable errors', async () => {
      qrPairingInFlight();
      h.clientMock.pair.mockRejectedValueOnce(
        new MbowazapBridgeError('timeout', 'TchuekBot did not answer within 45s')
      );
      const res = await postQrRefresh(qrRefreshRequest({ pairingRef: REF }));
      expect(res.status).toBe(504);
      expect((await res.json()).code).toBe('timeout');
    });
  });

  describe('GET /api/mbowazap/poll', () => {
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
      expect(storedConfig?.mbowazap_state).toBe('disconnected');
      expect(storedConfig?.mbowazap_session).toBeNull();
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

    it('reports disconnected when the bot only holds an unlinked socket for the number', async () => {
      h.clientMock.getSession.mockResolvedValueOnce({
        session: '237653683174',
        status: 'pairing',
        me: null,
        davila: true,
      });
      const res = await getStatus(new NextRequest('http://localhost/api/mbowazap/status'));
      const json = await res.json();
      expect(json.status).toBe('disconnected');
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
