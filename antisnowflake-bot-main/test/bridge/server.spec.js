const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const sig = require('../../lib/bridge/signature');
const { createBridgeHandler } = require('../../lib/bridge/server');
const { createBridgeState, PAUSE_FOREVER } = require('../../lib/bridge/state');

const SECRET = 'mbowazap-test-secret-0123456789abcdef';
const SESSION = '237600000001';
const CUSTOMER = '237699999999';
const REF = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';

function fakeSocket({ phone = SESSION, registered = true, open = true } = {}) {
    return {
        open,
        authState: { creds: { registered } },
        user: registered ? { id: `${phone}:7@s.whatsapp.net`, name: 'Tchuek-Tech' } : undefined,
        sent: [],
        presenceUpdates: [],
        failSend: false,
        loggedOut: false,
        ended: null,
        async sendPresenceUpdate(presence, jid) {
            this.presenceUpdates.push({ presence, jid });
        },
        async sendMessage(jid, content, options) {
            if (this.failSend) throw new Error('socket hiccup');
            this.sent.push({ jid, content, options });
            return { key: { id: options.messageId, remoteJid: jid, fromMe: true }, messageTimestamp: 1700000100 };
        },
        async logout() {
            this.loggedOut = true;
        },
        end(err) {
            this.ended = err;
        },
    };
}

async function startBridge(t, overrides = {}) {
    const clock = { now: 1_700_000_000_000 };
    const sockets = new Map();
    const removed = [];
    const pairingCalls = [];
    let idCounter = 0;
    const state = createBridgeState({
        baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-server-')),
        now: () => clock.now,
        getAllSockets: () => [...sockets],
    });
    const handler = createBridgeHandler({
        now: () => clock.now,
        getSecret: () => SECRET,
        getSocket: (session) => sockets.get(session),
        deleteSocket: (session) => sockets.delete(session),
        isSocketOpen: (sock) => sock.open === true,
        requestPairingCode: async (phone) => {
            pairingCalls.push(phone);
            return { code: 'ABCD-EFGH', isConnected: false };
        },
        getTempQr: async () => ({ status: 200, qr: 'data:image/png;base64,QUJD' }),
        removeSessionFiles: (session) => removed.push(session),
        loadMessage: async () => null,
        generateMessageId: () => `3EB0TEST${String(++idCounter).padStart(4, '0')}`,
        handoffMinutes: () => 120,
        state,
        log: { warn() {}, error() {} },
        ...overrides,
    });
    const server = http.createServer((req, res) => handler(req, res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;

    async function call(method, pathAndQuery, body, { sign = true, secret = SECRET, nonce, headers = {} } = {}) {
        const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
        const signed = sign
            ? sig.signRequest({ method, pathAndQuery, body: raw, secret, nowSeconds: Math.floor(clock.now / 1000), nonce })
            : {};
        const res = await fetch(base + pathAndQuery, {
            method,
            headers: { 'content-type': 'application/json', ...signed, ...headers },
            body: method === 'GET' ? undefined : raw,
        });
        return { status: res.status, json: await res.json() };
    }

    return { call, clock, sockets, removed, pairingCalls, state };
}

test('fails closed while MBOWAZAP_SECRET is not configured', async (t) => {
    const { call } = await startBridge(t, { getSecret: () => null });
    const { status, json } = await call('GET', '/bridge/ping');
    assert.equal(status, 503);
    assert.equal(json.error.code, 'bridge_not_configured');
});

test('rejects unsigned, mis-signed, replayed and wrong-protocol requests', async (t) => {
    const { call } = await startBridge(t);

    let res = await call('GET', '/bridge/ping', undefined, { sign: false });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'unauthorized');

    res = await call('GET', '/bridge/ping', undefined, { secret: 'x'.repeat(40) });
    assert.equal(res.status, 401);

    res = await call('GET', '/bridge/ping', undefined, { headers: { 'x-mbowazap-protocol': '9' } });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'unsupported_protocol');

    const nonce = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    assert.equal((await call('GET', '/bridge/ping', undefined, { nonce })).status, 200);
    assert.equal((await call('GET', '/bridge/ping', undefined, { nonce })).status, 401);
});

test('unknown routes 404, wrong methods 405, bad JSON 400', async (t) => {
    const { call } = await startBridge(t);
    assert.equal((await call('GET', '/bridge/nope')).json.error.code, 'not_found');
    const wrongMethod = await call('POST', '/bridge/ping', {});
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.json.error.code, 'method_not_allowed');
    const badJson = await call('POST', '/bridge/send', '{not json');
    assert.equal(badJson.status, 400);
    assert.match(badJson.json.error.message, /valid JSON/);
});

test('ping reports the protocol version', async (t) => {
    const { call, clock } = await startBridge(t);
    const { status, json } = await call('GET', '/bridge/ping');
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true, protocol: '1', time: clock.now });
});

test('pair with a code returns it and remembers the pairing ref', async (t) => {
    const { call, state, pairingCalls } = await startBridge(t);
    const { status, json } = await call('POST', '/bridge/pair', { pairingRef: REF, method: 'code', phone: SESSION });
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true, method: 'code', code: 'ABCD-EFGH', session: SESSION });
    assert.deepEqual(pairingCalls, [SESSION]);
    assert.equal(state.getPairingRef(SESSION), REF);
});

test('pair refuses a number that is already linked', async (t) => {
    const { call, sockets, pairingCalls, state } = await startBridge(t);
    sockets.set(SESSION, fakeSocket());
    const { status, json } = await call('POST', '/bridge/pair', { pairingRef: REF, method: 'code', phone: SESSION });
    assert.equal(status, 409);
    assert.equal(json.error.code, 'already_connected');
    assert.deepEqual(pairingCalls, []);
    assert.equal(state.getPairingRef(SESSION), null);
});

test('pair via QR returns the data URL, or pairing_pending while it is generated', async (t) => {
    const ready = await startBridge(t);
    const { status, json } = await ready.call('POST', '/bridge/pair', { pairingRef: REF, method: 'qr' });
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true, method: 'qr', qr: 'data:image/png;base64,QUJD', session: 'temp_qr' });
    assert.equal(ready.state.getPairingRef('temp_qr'), REF);

    const pending = await startBridge(t, { getTempQr: async () => ({ status: 200, qr: null, error: 'not yet' }) });
    const res = await pending.call('POST', '/bridge/pair', { pairingRef: REF, method: 'qr' });
    assert.equal(res.status, 503);
    assert.equal(res.json.error.code, 'pairing_pending');
});

test('session status covers connected, reconnecting, pairing and disconnected', async (t) => {
    const { call, sockets } = await startBridge(t);
    sockets.set(SESSION, fakeSocket());
    sockets.set('237600000002', fakeSocket({ phone: '237600000002', open: false }));
    sockets.set('237600000003', fakeSocket({ registered: false }));

    const connected = await call('GET', `/bridge/sessions/${SESSION}`);
    assert.deepEqual(connected.json, {
        ok: true,
        session: SESSION,
        status: 'connected',
        me: { phone: SESSION, name: 'Tchuek-Tech' },
        davila: true,
    });
    assert.equal((await call('GET', '/bridge/sessions/237600000002')).json.status, 'reconnecting');
    const pairing = await call('GET', '/bridge/sessions/237600000003');
    assert.equal(pairing.json.status, 'pairing');
    assert.equal(pairing.json.me, null);
    assert.equal((await call('GET', '/bridge/sessions/237600000004')).json.status, 'disconnected');
    assert.equal((await call('GET', '/bridge/sessions/temp_qr')).json.status, 'disconnected');
    assert.equal((await call('GET', '/bridge/sessions/12')).status, 400);
});

test('logout unlinks the number and deletes its session files', async (t) => {
    const { call, sockets, removed, state } = await startBridge(t);
    const sock = fakeSocket();
    sockets.set(SESSION, sock);
    state.setPairingRef(SESSION, REF);

    const { status, json } = await call('POST', `/bridge/sessions/${SESSION}/logout`);
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true, session: SESSION, status: 'disconnected' });
    assert.equal(sock.loggedOut, true);
    assert.equal(sockets.has(SESSION), false);
    assert.deepEqual(removed, [SESSION]);
    assert.equal(state.getPairingRef(SESSION), null);
});

test('logout ends the socket as logged-out (401) when logout() fails', async (t) => {
    const { call, sockets } = await startBridge(t);
    const sock = fakeSocket();
    sock.logout = async () => {
        throw new Error('ws closed');
    };
    sockets.set(SESSION, sock);
    assert.equal((await call('POST', `/bridge/sessions/${SESSION}/logout`)).status, 200);
    assert.equal(sock.ended.output.statusCode, 401);
});

test('brain switch turns Davila off and on for a number', async (t) => {
    const { call, state } = await startBridge(t);
    const off = await call('PUT', `/bridge/sessions/${SESSION}/brain`, { davila: false });
    assert.deepEqual(off.json, { ok: true, session: SESSION, davila: false });
    assert.equal(state.isDavilaEnabled(SESSION), false);
    assert.equal((await call('GET', `/bridge/sessions/${SESSION}`)).json.davila, false);
    assert.equal((await call('PUT', `/bridge/sessions/${SESSION}/brain`, { davila: 'no' })).status, 400);
});

test('send text uses a pre-registered id and hands the contact over to the agent', async (t) => {
    const { call, sockets, state, clock } = await startBridge(t);
    const sock = fakeSocket();
    sockets.set(SESSION, sock);

    const { status, json } = await call('POST', '/bridge/send', {
        session: SESSION,
        to: { phone: CUSTOMER },
        kind: 'text',
        text: 'Bonjour',
        origin: 'agent',
    });
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true, messageId: '3EB0TEST0001', timestamp: 1700000100 });
    assert.deepEqual(sock.sent[0], {
        jid: `${CUSTOMER}@s.whatsapp.net`,
        content: { text: 'Bonjour' },
        options: { messageId: '3EB0TEST0001' },
    });
    assert.equal(state.wasSentByCrm('3EB0TEST0001'), true);
    assert.equal(state.getContactPause(CUSTOMER), clock.now + 120 * 60 * 1000);
});

test('automated sends do not pause Davila; agent sends never shorten a pause', async (t) => {
    const { call, sockets, state } = await startBridge(t);
    sockets.set(SESSION, fakeSocket());
    const text = { session: SESSION, to: { phone: CUSTOMER }, kind: 'text', text: 'Hi' };

    await call('POST', '/bridge/send', { ...text, origin: 'automation' });
    assert.equal(state.isContactPaused(CUSTOMER), false);

    state.setContactPause(CUSTOMER, PAUSE_FOREVER);
    await call('POST', '/bridge/send', { ...text, origin: 'agent' });
    assert.equal(state.getContactPause(CUSTOMER), PAUSE_FOREVER);
});

test('send builds the right Baileys content for each media kind', async (t) => {
    const { call, sockets } = await startBridge(t);
    const sock = fakeSocket();
    sockets.set(SESSION, sock);
    const base = { session: SESSION, to: { phone: CUSTOMER }, origin: 'agent', mediaUrl: 'https://cdn.example.com/f' };

    await call('POST', '/bridge/send', { ...base, kind: 'image', mimeType: 'image/jpeg', text: 'Voici' });
    await call('POST', '/bridge/send', { ...base, kind: 'audio', mimeType: 'audio/ogg; codecs=opus' });
    await call('POST', '/bridge/send', { ...base, kind: 'audio', mimeType: 'audio/mpeg' });
    await call('POST', '/bridge/send', { ...base, kind: 'document', mimeType: 'application/pdf', filename: 'devis.pdf' });
    await call('POST', '/bridge/send', { ...base, to: { lid: '123456789012' }, kind: 'video' });

    const url = 'https://cdn.example.com/f';
    assert.deepEqual(sock.sent[0].content, { image: { url }, mimetype: 'image/jpeg', caption: 'Voici' });
    assert.deepEqual(sock.sent[1].content, { audio: { url }, mimetype: 'audio/ogg; codecs=opus', ptt: true });
    assert.deepEqual(sock.sent[2].content, { audio: { url }, mimetype: 'audio/mpeg', ptt: false });
    assert.deepEqual(sock.sent[3].content, { document: { url }, mimetype: 'application/pdf', fileName: 'devis.pdf' });
    assert.equal(sock.sent[4].jid, '123456789012@lid');
    assert.deepEqual(sock.sent[4].content, { video: { url } });
});

test('send quotes the original message when the bot still has it', async (t) => {
    const original = { key: { id: 'ORIG1', remoteJid: `${CUSTOMER}@s.whatsapp.net` } };
    const { call, sockets } = await startBridge(t, {
        loadMessage: async (_jid, id) => (id === 'ORIG1' ? original : null),
    });
    const sock = fakeSocket();
    sockets.set(SESSION, sock);
    const text = { session: SESSION, to: { phone: CUSTOMER }, kind: 'text', text: 'Oui', origin: 'agent' };

    await call('POST', '/bridge/send', { ...text, quotedId: 'ORIG1' });
    await call('POST', '/bridge/send', { ...text, quotedId: 'MISSING' });
    assert.deepEqual(sock.sent[0].options.quoted, original);
    assert.equal('quoted' in sock.sent[1].options, false);
});

test('send errors: not connected 409, WhatsApp failure 502, bad body 400', async (t) => {
    const { call, sockets } = await startBridge(t);
    const text = { session: SESSION, to: { phone: CUSTOMER }, kind: 'text', text: 'Hi', origin: 'agent' };

    const missing = await call('POST', '/bridge/send', text);
    assert.equal(missing.status, 409);
    assert.equal(missing.json.error.code, 'session_not_connected');

    sockets.set(SESSION, fakeSocket({ open: false }));
    assert.equal((await call('POST', '/bridge/send', text)).status, 409);

    const sock = fakeSocket();
    sock.failSend = true;
    sockets.set(SESSION, sock);
    const failed = await call('POST', '/bridge/send', text);
    assert.equal(failed.status, 502);
    assert.equal(failed.json.error.code, 'send_failed');

    assert.equal((await call('POST', '/bridge/send', { ...text, text: '' })).status, 400);
});

test('react sends a reaction keyed to the target message', async (t) => {
    const { call, sockets, state } = await startBridge(t);
    const sock = fakeSocket();
    sockets.set(SESSION, sock);
    const { status, json } = await call('POST', '/bridge/react', {
        session: SESSION,
        to: { phone: CUSTOMER },
        targetId: 'ABC123',
        targetFromMe: false,
        emoji: '👍',
    });
    assert.equal(status, 200);
    assert.deepEqual(sock.sent[0].content, {
        react: { text: '👍', key: { remoteJid: `${CUSTOMER}@s.whatsapp.net`, fromMe: false, id: 'ABC123' } },
    });
    assert.equal(state.wasSentByCrm(json.messageId), true);
});

test('contact AI pause: forever, for N minutes, and resume', async (t) => {
    const { call, state, clock } = await startBridge(t);
    const route = `/bridge/contacts/${CUSTOMER}/ai`;

    assert.equal((await call('PUT', route, { session: SESSION, paused: true })).json.pausedUntil, PAUSE_FOREVER);
    assert.equal(
        (await call('PUT', route, { session: SESSION, paused: true, minutes: 30 })).json.pausedUntil,
        clock.now + 30 * 60 * 1000
    );
    assert.equal((await call('PUT', route, { session: SESSION, paused: false })).json.pausedUntil, null);
    assert.equal(state.isContactPaused(CUSTOMER), false);
    assert.equal((await call('PUT', '/bridge/contacts/abc/ai', { session: SESSION, paused: true })).status, 400);
});

test('oversized bodies are refused with 413', async (t) => {
    const { call } = await startBridge(t);
    const { status, json } = await call('POST', '/bridge/send', { text: 'x'.repeat(600 * 1024) });
    assert.equal(status, 413);
    assert.equal(json.error.code, 'payload_too_large');
});

test('presence endpoint sets composing and paused on Baileys socket', async (t) => {
    const { call, sockets } = await startBridge(t);
    const sock = fakeSocket();
    sockets.set(SESSION, sock);

    const res1 = await call('POST', '/bridge/presence', {
        session: SESSION,
        to: { phone: CUSTOMER },
        presence: 'composing',
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.json.ok, true);
    assert.equal(res1.json.presence, 'composing');
    assert.deepEqual(sock.presenceUpdates[0], {
        presence: 'composing',
        jid: `${CUSTOMER}@s.whatsapp.net`,
    });

    const res2 = await call('POST', '/bridge/presence', {
        session: SESSION,
        to: { phone: CUSTOMER },
        presence: 'paused',
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.json.presence, 'paused');
    assert.deepEqual(sock.presenceUpdates[1], {
        presence: 'paused',
        jid: `${CUSTOMER}@s.whatsapp.net`,
    });

    // Invalid presence kind refused
    const resBad = await call('POST', '/bridge/presence', {
        session: SESSION,
        to: { phone: CUSTOMER },
        presence: 'invalid_status',
    });
    assert.equal(resBad.status, 400);
});

test('agent send and contact AI pause cancel in-flight Davila run immediately', async (t) => {
    const { call, sockets, state } = await startBridge(t);
    const sock = fakeSocket();
    sockets.set(SESSION, sock);

    let aborted = false;
    let stoppedPresence = false;
    state.registerActiveDavilaRun(CUSTOMER, {
        abort: () => { aborted = true; },
        stopPresence: () => { stoppedPresence = true; },
    });

    // Agent send triggers cancellation
    const res = await call('POST', '/bridge/send', {
        session: SESSION,
        to: { phone: CUSTOMER },
        kind: 'text',
        origin: 'agent',
        text: 'Hello from human agent',
    });
    assert.equal(res.status, 200);
    assert.equal(aborted, true);
    assert.equal(stoppedPresence, true);
});

test('presence answers 409 session_not_connected while the socket is down, reconnecting or unpaired', async (t) => {
    const { call, sockets } = await startBridge(t);
    const body = { session: SESSION, to: { phone: CUSTOMER }, presence: 'composing' };

    // No socket at all (logged out, or never paired on this process).
    let res = await call('POST', '/bridge/presence', body);
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'session_not_connected');

    // Socket object kept while Baileys reconnects (connection 'close' → scheduleReconnect).
    sockets.set(SESSION, fakeSocket({ open: false }));
    res = await call('POST', '/bridge/presence', body);
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'session_not_connected');

    // Socket mid-pairing.
    sockets.set(SESSION, fakeSocket({ registered: false }));
    res = await call('POST', '/bridge/presence', body);
    assert.equal(res.status, 409);

    // Back open after the reconnect: presence flows again.
    const sock = fakeSocket();
    sockets.set(SESSION, sock);
    res = await call('POST', '/bridge/presence', body);
    assert.equal(res.status, 200);
    assert.equal(sock.presenceUpdates.length, 1);
});

test('presence answers presence_failed instead of hanging when the socket stalls', async (t) => {
    const { call, sockets } = await startBridge(t, { presenceTimeoutMs: () => 30 });
    const sock = fakeSocket();
    sock.sendPresenceUpdate = () => new Promise(() => {}); // never settles
    sockets.set(SESSION, sock);

    const res = await call('POST', '/bridge/presence', {
        session: SESSION,
        to: { phone: CUSTOMER },
        presence: 'composing',
    });
    assert.equal(res.status, 502);
    assert.equal(res.json.error.code, 'presence_failed');
});
