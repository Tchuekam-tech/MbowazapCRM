const test = require('node:test');
const assert = require('node:assert/strict');
const sessionManager = require('../lib/sessionManager');
const { getTempQrDataUrl, TEMP_QR_SESSION } = require('../lib/qrSession');

/** A Baileys-like socket whose WebSocket state the test drives. */
function fakeQrSocket({ closed = false } = {}) {
    return {
        ws: { isOpen: false, isClosed: closed, isClosing: false },
        lastQR: undefined,
        lastCloseReason: undefined,
        ev: { removeAllListeners() {} },
        end() {},
        close(reason) {
            this.ws.isClosed = true;
            this.lastCloseReason = reason;
        },
    };
}

function useTempQrStarter(t, onStart) {
    const started = [];
    global.startXeonBotInc = async (session) => {
        assert.equal(session, TEMP_QR_SESSION);
        const sock = fakeQrSocket();
        sessionManager.setSocket(TEMP_QR_SESSION, sock);
        started.push(sock);
        onStart?.(sock);
        return sock;
    };
    t.after(() => {
        delete global.startXeonBotInc;
        sessionManager.deleteSocket(TEMP_QR_SESSION);
    });
    return started;
}

test('isLinkedCreds accepts QR-linked and code-linked devices only', () => {
    assert.equal(sessionManager.isLinkedCreds({ registered: true }), true);
    // QR linking never sets `registered`; the signed identity marks the link.
    assert.equal(sessionManager.isLinkedCreds({ registered: false, account: { details: 'x' } }), true);
    // A pairing code that was requested but never entered sets `me` only.
    assert.equal(sessionManager.isLinkedCreds({ registered: false, me: { id: '2376@s.whatsapp.net' } }), false);
    assert.equal(sessionManager.isLinkedCreds(undefined), false);
    assert.equal(sessionManager.isLinked({ authState: { creds: { account: {} } } }), true);
    assert.equal(sessionManager.isLinked(undefined), false);
});

test('a cold temp_qr socket is started and its first QR awaited', async (t) => {
    const started = useTempQrStarter(t, (sock) => {
        // WhatsApp sends the first QR only after the connect + handshake.
        setTimeout(() => { sock.lastQR = 'ref,noise,identity,adv'; }, 400);
    });

    const result = await getTempQrDataUrl({ waitMs: 3000 });
    assert.equal(started.length, 1);
    assert.equal(result.status, 200);
    assert.match(result.qr, /^data:image\/png;base64,/);
});

test('a temp_qr socket that is still connecting is waited on, not reported pending', async (t) => {
    const started = useTempQrStarter(t);
    const connecting = fakeQrSocket();
    sessionManager.setSocket(TEMP_QR_SESSION, connecting);
    setTimeout(() => { connecting.lastQR = 'ref,noise,identity,adv'; }, 300);

    const result = await getTempQrDataUrl({ waitMs: 3000 });
    assert.equal(started.length, 0, 'the live socket is reused');
    assert.match(result.qr, /^data:image\/png;base64,/);
});

test('a spent temp_qr socket is replaced by a fresh one', async (t) => {
    const started = useTempQrStarter(t, (sock) => {
        sock.lastQR = 'fresh-ref,noise,identity,adv';
    });
    sessionManager.setSocket(TEMP_QR_SESSION, fakeQrSocket({ closed: true }));

    const result = await getTempQrDataUrl({ waitMs: 1000 });
    assert.equal(started.length, 1);
    assert.equal(sessionManager.getSocket(TEMP_QR_SESSION), started[0]);
    assert.match(result.qr, /^data:image\/png;base64,/);
});

test('WhatsApp closing the socket before any QR is an error, not "pending"', async (t) => {
    useTempQrStarter(t, (sock) => {
        setTimeout(() => sock.close('Connection Failure, code 405'), 100);
    });

    const result = await getTempQrDataUrl({ waitMs: 3000 });
    assert.equal(result.status, 502);
    assert.equal(result.qr, null);
    assert.match(result.error, /Connection Failure, code 405/);
});

test('no QR within the wait budget is reported as still pending', async (t) => {
    useTempQrStarter(t);

    const result = await getTempQrDataUrl({ waitMs: 300 });
    assert.equal(result.status, 200);
    assert.equal(result.qr, null);
    assert.ok(result.error);
});
