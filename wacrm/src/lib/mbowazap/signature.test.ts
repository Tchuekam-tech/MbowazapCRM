import { describe, it, expect } from 'vitest';
import {
  canonicalRequest,
  createNonceCache,
  pathAndQueryOf,
  signBridgeRequest,
  verifyBridgeRequest,
} from './signature';

const secret = 'mbowazap-test-secret-0123456789abcdef';

// Shared with TchuekBot (test/bridge/signature.spec.js): both
// implementations must produce exactly this header for these inputs.
const vector = {
  method: 'POST',
  pathAndQuery: '/bridge/send',
  body: '{"hello":"world"}',
  nowSeconds: 1_700_000_000,
  nonce: '00112233445566778899aabbccddeeff',
  signature:
    't=1700000000,v1=230171515dc1178991cc9cbf559200bd2296debae51a9abaddee49876fef37cb',
};

function signed(overrides: Partial<typeof vector> = {}) {
  const v = { ...vector, ...overrides };
  return new Headers(
    signBridgeRequest({
      method: v.method,
      pathAndQuery: v.pathAndQuery,
      body: v.body,
      secret,
      nowSeconds: v.nowSeconds,
      nonce: v.nonce,
    })
  );
}

function verify(
  overrides: Partial<Parameters<typeof verifyBridgeRequest>[0]> = {}
) {
  return verifyBridgeRequest({
    method: vector.method,
    pathAndQuery: vector.pathAndQuery,
    body: vector.body,
    headers: signed(),
    secret,
    nowSeconds: vector.nowSeconds,
    nonceCache: createNonceCache(),
    ...overrides,
  });
}

describe('signBridgeRequest', () => {
  it('reproduces the cross-implementation vector', () => {
    const headers = signed();
    expect(headers.get('x-mbowazap-signature')).toBe(vector.signature);
    expect(headers.get('x-mbowazap-nonce')).toBe(vector.nonce);
    expect(headers.get('x-mbowazap-protocol')).toBe('1');
  });

  it('uses a fresh random nonce by default', () => {
    const args = { ...vector, secret };
    const a = signBridgeRequest({ ...args, nonce: undefined });
    const b = signBridgeRequest({ ...args, nonce: undefined });
    expect(a['x-mbowazap-nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(a['x-mbowazap-nonce']).not.toBe(b['x-mbowazap-nonce']);
  });
});

describe('verifyBridgeRequest', () => {
  it('accepts a correctly signed request within tolerance', () => {
    expect(verify()).toEqual({ ok: true });
    expect(verify({ nowSeconds: vector.nowSeconds + 299 })).toEqual({
      ok: true,
    });
  });

  it('rejects anything that changed after signing', () => {
    expect(verify({ method: 'PUT' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verify({ pathAndQuery: '/bridge/react' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verify({ body: '{"hello":"world!"}' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verify({ secret: `${secret}x` })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    const swapped = signed();
    swapped.set('x-mbowazap-nonce', 'ffeeddccbbaa99887766554433221100');
    expect(verify({ headers: swapped })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects stale and future timestamps', () => {
    expect(verify({ nowSeconds: vector.nowSeconds + 301 })).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
    expect(verify({ nowSeconds: vector.nowSeconds - 301 })).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
  });

  it('accepts a nonce once, without burning it on a bad signature', () => {
    const nonceCache = createNonceCache();
    expect(verify({ nonceCache, body: 'tampered' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verify({ nonceCache })).toEqual({ ok: true });
    expect(verify({ nonceCache })).toEqual({ ok: false, reason: 'replayed' });
  });

  it('checks the signature header before the protocol header', () => {
    expect(verify({ headers: new Headers() })).toEqual({
      ok: false,
      reason: 'missing_signature',
    });

    const wrongProtocol = signed();
    wrongProtocol.set('x-mbowazap-protocol', '2');
    expect(verify({ headers: wrongProtocol })).toEqual({
      ok: false,
      reason: 'unsupported_protocol',
    });

    const badNonce = signed();
    badNonce.set('x-mbowazap-nonce', 'short');
    expect(verify({ headers: badNonce })).toEqual({
      ok: false,
      reason: 'bad_nonce',
    });

    const garbage = signed();
    garbage.set('x-mbowazap-signature', 't=abc,v1=xyz');
    expect(verify({ headers: garbage })).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  it('tolerates uppercase hex and spaces in the signature header', () => {
    const headers = signed();
    const [t, v1] = vector.signature.split(',');
    headers.set(
      'x-mbowazap-signature',
      `${t}, v1=${v1.slice(3).toUpperCase()}`
    );
    expect(verify({ headers })).toEqual({ ok: true });
  });

  it('signs binary bodies by their bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const path = '/api/mbowazap/media?session=237600000000';
    const headers = new Headers(
      signBridgeRequest({
        method: 'POST',
        pathAndQuery: path,
        body: bytes,
        secret,
        nowSeconds: vector.nowSeconds,
      })
    );
    const args = {
      method: 'POST',
      pathAndQuery: path,
      headers,
      secret,
      nowSeconds: vector.nowSeconds,
    };
    expect(
      verifyBridgeRequest({
        ...args,
        body: Buffer.from(bytes),
        nonceCache: createNonceCache(),
      })
    ).toEqual({ ok: true });
    expect(
      verifyBridgeRequest({
        ...args,
        body: new Uint8Array([0, 1, 2]),
        nonceCache: createNonceCache(),
      })
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(canonicalRequest('POST', path, 'n'.repeat(16), bytes)).toMatch(
      /\n[0-9a-f]{64}$/
    );
  });
});

describe('pathAndQueryOf', () => {
  it('keeps the query exactly as sent', () => {
    expect(
      pathAndQueryOf(
        'https://crm.example.com/api/mbowazap/media?session=2376&filename=it%27s%20a.jpg'
      )
    ).toBe('/api/mbowazap/media?session=2376&filename=it%27s%20a.jpg');
  });
});

describe('createNonceCache', () => {
  it('forgets entries after their TTL and stays bounded', () => {
    const cache = createNonceCache({ ttlMs: 1000, maxEntries: 2 });
    expect(cache.seen('a'.repeat(16), 0)).toBe(false);
    expect(cache.seen('a'.repeat(16), 999)).toBe(true);
    expect(cache.seen('a'.repeat(16), 1001)).toBe(false);
    cache.seen('b'.repeat(16), 1002);
    cache.seen('c'.repeat(16), 1003);
    expect(cache.size).toBe(2);
  });
});
