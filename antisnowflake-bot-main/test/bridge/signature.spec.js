const test = require('node:test');
const assert = require('node:assert/strict');
const sig = require('../../lib/bridge/signature');

const SECRET = 'mbowazap-test-secret-0123456789abcdef';

// Shared with wacrm (src/lib/mbowazap/signature.test.ts): both
// implementations must produce exactly this header for these inputs.
const VECTOR = {
    method: 'POST',
    pathAndQuery: '/bridge/send',
    body: '{"hello":"world"}',
    nowSeconds: 1700000000,
    nonce: '00112233445566778899aabbccddeeff',
    signature: 't=1700000000,v1=230171515dc1178991cc9cbf559200bd2296debae51a9abaddee49876fef37cb',
};

function signedHeaders(overrides = {}) {
    return sig.signRequest({
        method: VECTOR.method,
        pathAndQuery: VECTOR.pathAndQuery,
        body: VECTOR.body,
        secret: SECRET,
        nowSeconds: VECTOR.nowSeconds,
        nonce: VECTOR.nonce,
        ...overrides,
    });
}

function verify({ headers = signedHeaders(), nonceCache = sig.createNonceCache(), ...overrides } = {}) {
    return sig.verifyRequest({
        method: VECTOR.method,
        pathAndQuery: VECTOR.pathAndQuery,
        body: VECTOR.body,
        headers,
        secret: SECRET,
        nowSeconds: VECTOR.nowSeconds,
        nonceCache,
        ...overrides,
    });
}

test('signRequest reproduces the cross-implementation vector', () => {
    const headers = signedHeaders();
    assert.equal(headers['x-mbowazap-signature'], VECTOR.signature);
    assert.equal(headers['x-mbowazap-nonce'], VECTOR.nonce);
    assert.equal(headers['x-mbowazap-protocol'], '1');
});

test('verifyRequest accepts a correctly signed request within tolerance', () => {
    assert.deepEqual(verify(), { ok: true });
    assert.deepEqual(verify({ nowSeconds: VECTOR.nowSeconds + 299 }), { ok: true });
});

test('verifyRequest rejects anything that changed after signing', () => {
    assert.equal(verify({ method: 'PUT' }).reason, 'bad_signature');
    assert.equal(verify({ pathAndQuery: '/bridge/react' }).reason, 'bad_signature');
    assert.equal(verify({ body: '{"hello":"world!"}' }).reason, 'bad_signature');
    assert.equal(verify({ secret: `${SECRET}x` }).reason, 'bad_signature');
    const swappedNonce = { ...signedHeaders(), 'x-mbowazap-nonce': 'ffeeddccbbaa99887766554433221100' };
    assert.equal(verify({ headers: swappedNonce }).reason, 'bad_signature');
});

test('verifyRequest rejects stale and future timestamps', () => {
    assert.equal(verify({ nowSeconds: VECTOR.nowSeconds + 301 }).reason, 'stale_timestamp');
    assert.equal(verify({ nowSeconds: VECTOR.nowSeconds - 301 }).reason, 'stale_timestamp');
});

test('verifyRequest accepts a nonce once', () => {
    const nonceCache = sig.createNonceCache();
    assert.deepEqual(verify({ nonceCache }), { ok: true });
    assert.equal(verify({ nonceCache }).reason, 'replayed');
});

test('verifyRequest does not burn a nonce on a bad signature', () => {
    const nonceCache = sig.createNonceCache();
    assert.equal(verify({ nonceCache, body: 'tampered' }).reason, 'bad_signature');
    assert.deepEqual(verify({ nonceCache }), { ok: true });
});

test('verifyRequest rejects missing or malformed headers', () => {
    const headers = signedHeaders();
    assert.equal(verify({ headers: { ...headers, 'x-mbowazap-protocol': '2' } }).reason, 'unsupported_protocol');
    const noProtocol = { ...headers };
    delete noProtocol['x-mbowazap-protocol'];
    assert.equal(verify({ headers: noProtocol }).reason, 'unsupported_protocol');
    assert.equal(verify({ headers: { ...headers, 'x-mbowazap-signature': 'garbage' } }).reason, 'missing_signature');
    assert.equal(verify({ headers: { ...headers, 'x-mbowazap-nonce': 'short' } }).reason, 'bad_nonce');
});

test('verifyRequest tolerates uppercase hex and spaces in the signature header', () => {
    const headers = signedHeaders();
    const [timestamp, signature] = headers['x-mbowazap-signature'].split(',');
    const loud = `${timestamp}, v1=${signature.slice('v1='.length).toUpperCase()}`;
    assert.deepEqual(verify({ headers: { ...headers, 'x-mbowazap-signature': loud } }), { ok: true });
});

test('binary bodies sign the same as the equivalent bytes', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255]);
    const fromBuffer = sig.canonicalRequest('POST', '/api/mbowazap/media?session=237600000000', 'n'.repeat(16), bytes);
    const fromCopy = sig.canonicalRequest('POST', '/api/mbowazap/media?session=237600000000', 'n'.repeat(16), Buffer.from(bytes));
    assert.equal(fromBuffer, fromCopy);
    assert.match(fromBuffer, /\n[0-9a-f]{64}$/);
});

test('readSecret enforces the minimum length', () => {
    assert.equal(sig.readSecret({ MBOWAZAP_SECRET: 'too-short' }), null);
    assert.equal(sig.readSecret({}), null);
    assert.equal(sig.readSecret({ MBOWAZAP_SECRET: `  ${SECRET}  ` }), SECRET);
});

test('encodeQueryValue survives WHATWG URL parsing unchanged', () => {
    const query = `?filename=${sig.encodeQueryValue("it's (a) *file*! é.pdf")}`;
    assert.equal(new URL(`https://crm.example.com/api/mbowazap/media${query}`).search, query);
});

test('nonce cache forgets entries after their TTL and stays bounded', () => {
    const cache = sig.createNonceCache({ ttlMs: 1000, maxEntries: 2 });
    assert.equal(cache.seen('abcdefabcdefabcdef', 0), false);
    assert.equal(cache.seen('abcdefabcdefabcdef', 999), true);
    assert.equal(cache.seen('abcdefabcdefabcdef', 1001), false);
    cache.seen('b'.repeat(16), 1002);
    cache.seen('c'.repeat(16), 1003);
    assert.equal(cache.size, 2);
});
