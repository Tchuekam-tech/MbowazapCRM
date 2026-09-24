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
import { GET as getPoll } from './poll/route';
import { PUT as putBrain } from './brain/route';
import { POST as postDisconnect } from './disconnect/route';

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
      const req = new NextRequest('http://localhost/api/mbowazap/pair', {
        method: 'POST',
        body: JSON.stringify({ method: 'code', phone: '+237 653 683 174' }),
      });
      const res = await postPair(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.code).toBe('already_connected');
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
