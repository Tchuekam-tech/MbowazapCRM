import { describe, it, expect, vi } from 'vitest';
import {
  createMbowazapClient,
  getMbowazapClient,
  MbowazapBridgeError,
  SLOW_TIMEOUT_MS,
} from './client';
import { normalizeOrigin, readMbowazapEnv } from './env';
import { createNonceCache, verifyBridgeRequest } from './signature';

const secret = 'mbowazap-test-secret-0123456789abcdef';
const botUrl = 'https://bot.example.com';
const now = () => 1_700_000_000_000;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(
  respond: () => Response | Promise<Response> = () =>
    jsonResponse(200, { ok: true })
) {
  const fetchImpl = vi.fn<typeof fetch>(async () => respond());
  const client = createMbowazapClient({ botUrl, secret, fetchImpl, now });
  return { client, fetchImpl };
}

function lastRequest(fetchImpl: ReturnType<typeof setup>['fetchImpl']) {
  const [url, init] = fetchImpl.mock.calls.at(-1)!;
  return { url: String(url), init: init! };
}

describe('createMbowazapClient', () => {
  it('signs each request so the bot can verify it', async () => {
    const { client, fetchImpl } = setup(() =>
      jsonResponse(200, {
        ok: true,
        messageId: '3EB0X',
        timestamp: 1_700_000_100,
      })
    );
    const result = await client.send({
      session: '237600000001',
      to: { phone: '237699999999' },
      kind: 'text',
      text: 'Bonjour',
      origin: 'agent',
    });
    expect(result).toEqual({ messageId: '3EB0X', timestamp: 1_700_000_100 });

    const { url, init } = lastRequest(fetchImpl);
    expect(url).toBe('https://bot.example.com/bridge/send');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const verdict = verifyBridgeRequest({
      method: 'POST',
      pathAndQuery: '/bridge/send',
      body: init.body as string,
      headers: new Headers(init.headers),
      secret,
      nowSeconds: now() / 1000,
      nonceCache: createNonceCache(),
    });
    expect(verdict).toEqual({ ok: true });
    expect(JSON.parse(init.body as string)).toMatchObject({
      kind: 'text',
      origin: 'agent',
    });
  });

  it('sends GETs without a body and strips the ok flag from results', async () => {
    const info = {
      session: '237600000001',
      status: 'connected',
      me: { phone: '237600000001', name: null },
      davila: true,
    };
    const { client, fetchImpl } = setup(() =>
      jsonResponse(200, { ok: true, ...info })
    );
    await expect(client.getSession('237600000001')).resolves.toEqual(info);
    const { url, init } = lastRequest(fetchImpl);
    expect(url).toBe('https://bot.example.com/bridge/sessions/237600000001');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('routes every command to its bot path', async () => {
    const { client, fetchImpl } = setup();
    await client.ping();
    await client.pair({
      pairingRef: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
      method: 'qr',
    });
    await client.getSession('temp_qr');
    await client.logout('237600000001');
    await client.setBrain('237600000001', false);
    await client.react({
      session: '237600000001',
      to: { lid: '123456789012' },
      targetId: 'A',
      targetFromMe: true,
      emoji: '👍',
    });
    await client.setContactAi('237699999999', {
      session: '237600000001',
      paused: true,
      minutes: 30,
    });
    expect(
      fetchImpl.mock.calls.map(
        ([url, init]) => `${init!.method} ${String(url).slice(botUrl.length)}`
      )
    ).toEqual([
      'GET /bridge/ping',
      'POST /bridge/pair',
      'GET /bridge/sessions/temp_qr',
      'POST /bridge/sessions/237600000001/logout',
      'PUT /bridge/sessions/237600000001/brain',
      'POST /bridge/react',
      'PUT /bridge/contacts/237699999999/ai',
    ]);
    expect(JSON.parse(lastRequest(fetchImpl).init.body as string)).toEqual({
      session: '237600000001',
      paused: true,
      minutes: 30,
    });
  });

  it('refuses path params that are not digits before calling the bot', async () => {
    const { client, fetchImpl } = setup();
    await expect(client.logout('../../etc')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(client.setBrain('temp_qr', true)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(
      client.setContactAi('abc', { session: '237600000001', paused: false })
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces the bot error envelope as MbowazapBridgeError', async () => {
    const { client } = setup(() =>
      jsonResponse(409, {
        ok: false,
        error: {
          code: 'session_not_connected',
          message: '2376 is not connected to WhatsApp',
        },
      })
    );
    const error = await client
      .send({
        session: '237600000001',
        to: { phone: '237699999999' },
        kind: 'text',
        text: 'x',
        origin: 'agent',
      })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MbowazapBridgeError);
    expect(error).toMatchObject({
      code: 'session_not_connected',
      httpStatus: 409,
      message: '2376 is not connected to WhatsApp',
    });
  });

  it('maps transport failures to their own codes', async () => {
    await expect(
      setup(
        () => new Response('<html>502</html>', { status: 502 })
      ).client.ping()
    ).rejects.toMatchObject({
      code: 'bad_response',
      httpStatus: 502,
    });
    await expect(
      setup(() => jsonResponse(500, { nope: true })).client.ping()
    ).rejects.toMatchObject({
      code: 'bad_response',
      httpStatus: 500,
    });
    await expect(
      setup(() => {
        throw new TypeError('fetch failed');
      }).client.ping()
    ).rejects.toMatchObject({ code: 'network_error', httpStatus: null });
    await expect(
      setup(() => {
        throw new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError'
        );
      }).client.ping()
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('gives slow commands the longer timeout', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const { client } = setup();
    await client.pair({
      pairingRef: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
      method: 'code',
      phone: '237600000001',
    });
    expect(spy).toHaveBeenLastCalledWith(SLOW_TIMEOUT_MS);
    spy.mockRestore();
  });
});

describe('getMbowazapClient / readMbowazapEnv', () => {
  it('reports every configuration problem', () => {
    expect(readMbowazapEnv({})).toEqual({
      ok: false,
      problems: ['MBOWAZAP_BOT_URL is not set', 'MBOWAZAP_SECRET is not set'],
    });
    const bad = readMbowazapEnv({
      MBOWAZAP_BOT_URL: 'https://bot.example.com/api',
      MBOWAZAP_SECRET: 'short',
    });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.problems).toHaveLength(2);
    expect(() => getMbowazapClient({})).toThrow(MbowazapBridgeError);
  });

  it('builds a client from a valid environment', () => {
    expect(
      readMbowazapEnv({
        MBOWAZAP_BOT_URL: ' https://bot.example.com/ ',
        MBOWAZAP_SECRET: secret,
      })
    ).toEqual({
      ok: true,
      env: { botUrl: 'https://bot.example.com', secret },
    });
    expect(
      getMbowazapClient({ MBOWAZAP_BOT_URL: botUrl, MBOWAZAP_SECRET: secret })
    ).toHaveProperty('send');
  });

  it('normalizeOrigin accepts http(s) origins only', () => {
    expect(normalizeOrigin('http://localhost:8080')).toBe(
      'http://localhost:8080'
    );
    expect(normalizeOrigin('https://bot.example.com/path')).toBeNull();
    expect(normalizeOrigin('https://bot.example.com/?a=1')).toBeNull();
    expect(normalizeOrigin('ftp://bot.example.com')).toBeNull();
    expect(normalizeOrigin('nope')).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
  });
});
