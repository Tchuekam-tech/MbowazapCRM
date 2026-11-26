const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const isOwnerOrSudo = require('../lib/isOwner');
const isAdmin = require('../lib/isAdmin');
const settings = require('../settings');
const shipCommand = require('../commands/ship');
const pingCommand = require('../commands/ping');
const aliveCommand = require('../commands/alive');
const ownerCommand = require('../commands/owner');
const menuCommand = require('../commands/menu');
const menu2Command = require('../commands/menu2');
const warningsCommand = require('../commands/warnings');
const { handleTicTacToeMove } = require('../commands/tictactoe');
const { detectIntent } = require('../flows/intentDetector');
const { createWacrmClient } = require('../lib/bridge/wacrmClient');
const { handleMessages, resetAntiBanState, trackBotSentId } = require('../main');

function makeMockSock(overrides = {}) {
    const sent = [];
    const listeners = new Map();
    const sock = {
        user: { id: '237653683174:1@s.whatsapp.net', lid: '999888777:1@lid' },
        sent,
        sendMessage: async (jid, content, opts) => {
            sent.push({ jid, content, opts });
            return { key: { id: `BOT_${sent.length}`, remoteJid: jid, fromMe: true } };
        },
        groupMetadata: async (chatId) => ({
            id: chatId,
            subject: 'Test Group',
            desc: 'Test description',
            participants: [
                { id: '237653683174@s.whatsapp.net', lid: '999888777@lid', admin: 'superadmin' },
                { id: '237699999999@s.whatsapp.net', lid: '111222333@lid', admin: null },
            ],
        }),
        ev: {
            on: (ev, fn) => {
                if (!listeners.has(ev)) listeners.set(ev, new Set());
                listeners.get(ev).add(fn);
            },
            off: (ev, fn) => {
                listeners.get(ev)?.delete(fn);
            },
        },
        ...overrides,
    };
    return sock;
}

function makeUpdate({ text, chatId = '237699999999@s.whatsapp.net', participant = undefined, fromMe = false, id = `MSG_${Date.now()}_${Math.random()}` }) {
    return {
        type: 'notify',
        messages: [
            {
                key: { id, remoteJid: chatId, fromMe, ...(participant ? { participant } : {}) },
                pushName: 'Tester',
                message: { conversation: text },
            },
        ],
    };
}

test('isOwnerOrSudo prevents group LID privilege escalation', async () => {
    const ownerClean = String(settings.ownerNumber || '237653683174').replace(/[^0-9]/g, '');
    const sock = makeMockSock({
        groupMetadata: async () => ({
            participants: [
                { id: `${ownerClean}@s.whatsapp.net`, lid: '999888777@lid', admin: 'superadmin' },
                { id: '237611111111@s.whatsapp.net', lid: '555444333@lid', admin: null },
            ],
        }),
    });

    // Attacker with a different LID in a group where owner is also present MUST be rejected
    const attackerIsOwner = await isOwnerOrSudo('555444333@lid', sock, '120363000@g.us');
    assert.equal(attackerIsOwner, false);

    // Real owner's LID MUST be accepted
    const realOwner = await isOwnerOrSudo('999888777@lid', sock, '120363000@g.us');
    assert.equal(realOwner, true);

    // Empty sender MUST be rejected
    assert.equal(await isOwnerOrSudo('', sock, '120363000@g.us'), false);
});

test('isAdmin does not false-positive when bot or participant lid is empty', async () => {
    const sock = makeMockSock({
        user: { id: '237600000001:1@s.whatsapp.net', lid: '' },
        groupMetadata: async () => ({
            participants: [
                { id: '237699999999@s.whatsapp.net', lid: '', admin: 'admin' },
                { id: '237600000001@s.whatsapp.net', lid: '', admin: null },
            ],
        }),
    });

    const status = await isAdmin(sock, '120363000@g.us', '237699999999@s.whatsapp.net');
    assert.equal(status.isBotAdmin, false);
    assert.equal(status.isSenderAdmin, true);
});

test('shipCommand handles 1-member group without hanging', async () => {
    const sock = makeMockSock({
        groupMetadata: async () => ({
            participants: [{ id: '237611111111@s.whatsapp.net' }],
        }),
    });
    await shipCommand(sock, '120363000@g.us', { key: { id: '1' } });
    assert.equal(sock.sent.length, 1);
    assert.match(sock.sent[0].content.text, /at least 2 members/i);
});

test('pingCommand includes message.key in reaction and replies with latency', async () => {
    const sock = makeMockSock();
    const msg = { key: { id: 'P1', remoteJid: '237699999999@s.whatsapp.net', fromMe: false } };
    await pingCommand(sock, '237699999999@s.whatsapp.net', msg);
    const reactCall = sock.sent.find((s) => s.content.react);
    assert.ok(reactCall, 'expected react message');
    assert.deepEqual(reactCall.content.react.key, msg.key);
    const textCall = sock.sent.find((s) => typeof s.content.text === 'string');
    assert.ok(textCall && textCall.content.text.includes('RESPONSE'));
});

test('aliveCommand reflects dynamic bot mode from botModeCache', async () => {
    const prev = global.botModeCache;
    try {
        global.botModeCache = { isPublic: false };
        const sock = makeMockSock();
        await aliveCommand(sock, '237699999999@s.whatsapp.net', { key: { id: 'A1' } });
        assert.match(sock.sent[0].content.text, /Private/);
    } finally {
        global.botModeCache = prev;
    }
});

test('ownerCommand sends a valid vCard with clean digits', async () => {
    const sock = makeMockSock();
    await ownerCommand(sock, '237699999999@s.whatsapp.net');
    const vcard = sock.sent[0]?.content?.contacts?.contacts?.[0]?.vcard || '';
    assert.match(vcard, /BEGIN:VCARD/);
    assert.match(vcard, /waid=\d+:/);
});

test('menu and allmenu send valid payload without null image', async () => {
    const sock = makeMockSock();
    const msg = { key: { id: 'M1', remoteJid: '237699999999@s.whatsapp.net' }, pushName: 'Alice' };
    await menuCommand(sock, '237699999999@s.whatsapp.net', msg);
    await menu2Command(sock, '237699999999@s.whatsapp.net', msg);
    assert.equal(sock.sent.length, 2);
    for (const call of sock.sent) {
        assert.notEqual(call.content.image, null);
        assert.ok(typeof call.content.text === 'string' || Buffer.isBuffer(call.content.image));
    }
});

test('handleTicTacToeMove returns false when no game is active', async () => {
    const sock = makeMockSock();
    const handled = await handleTicTacToeMove(sock, '237699999999@s.whatsapp.net', '237699999999@s.whatsapp.net', '1');
    assert.equal(handled, false);
    assert.equal(sock.sent.length, 0);
});

test('warningsCommand reads per-chat nested warning count', async () => {
    const warningsPath = path.join(__dirname, '../data/warnings.json');
    const existed = fs.existsSync(warningsPath);
    const prev = existed ? fs.readFileSync(warningsPath, 'utf8') : null;
    try {
        fs.mkdirSync(path.dirname(warningsPath), { recursive: true });
        fs.writeFileSync(
            warningsPath,
            JSON.stringify({ '120363000@g.us': { '237611111111@s.whatsapp.net': 2 } }),
            'utf8'
        );
        const sock = makeMockSock();
        await warningsCommand(sock, '120363000@g.us', ['237611111111@s.whatsapp.net']);
        assert.match(sock.sent[0].content.text, /2\/3/);
    } finally {
        if (existed) fs.writeFileSync(warningsPath, prev, 'utf8');
        else if (fs.existsSync(warningsPath)) fs.unlinkSync(warningsPath);
    }
});

test('intentDetector matches numeric replies in AWAITING_CLOSING, COMMITMENT, and FAQ', () => {
    assert.equal(detectIntent({ body: '1' }, 'AWAITING_CLOSING').intent, 'READY');
    assert.equal(detectIntent({ body: '2' }, 'AWAITING_CLOSING').intent, 'QUESTIONS');
    assert.equal(detectIntent({ body: '1' }, 'COMMITMENT').intent, 'CONFIRM_YES');
    assert.equal(detectIntent({ body: '2' }, 'COMMITMENT').intent, 'CONFIRM_CHANGE');
    assert.equal(detectIntent({ body: '3' }, 'FAQ').intent, 'FAQ_PAYMENT');
});

test('wacrmClient.flush() returns a Promise that resolves after draining', async () => {
    const tmpDir = path.join(__dirname, '../tmp/test-flush-' + Date.now());
    let calls = 0;
    const client = createWacrmClient({
        baseUrl: 'https://crm.example.com',
        secret: 'test-secret-1234567890',
        outboxFile: path.join(tmpDir, 'outbox.jsonl'),
        deadLetterFile: path.join(tmpDir, 'deadletter.jsonl'),
        fetchImpl: async () => {
            calls++;
            return { ok: true, status: 200, json: async () => ({ accepted: 1, rejected: [] }) };
        },
    });
    try {
        client.emit('237653683174', 'message', { id: 'm1', chat: '237611111111', fromMe: false, type: 'text', text: 'hi' });
        const flushPromise = client.flush();
        assert.ok(flushPromise && typeof flushPromise.then === 'function', 'flush() must return a Promise');
        await flushPromise;
        assert.equal(calls, 1);
    } finally {
        client.stop();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('main.js exact-token router: repeated .ping commands bypass dedup & .aidiag enforces owner-only', async () => {
    resetAntiBanState();
    const prevMode = global.botModeCache;
    global.botModeCache = { isPublic: true };
    try {
        const sock = makeMockSock();

        // Non-owner calls .ping twice within 1 second — both must succeed!
        await handleMessages(sock, makeUpdate({ text: '.ping', id: 'PING_1' }));
        await handleMessages(sock, makeUpdate({ text: '.ping', id: 'PING_2' }));
        const pingReplies = sock.sent.filter((s) => s.content.text && s.content.text.includes('RESPONSE'));
        assert.equal(pingReplies.length, 2, 'repeated .ping commands must not be dropped by content dedup');

        // Non-owner calling .aidiag must NOT be shadowed by .ai and MUST be blocked as owner-only
        sock.sent.length = 0;
        await handleMessages(sock, makeUpdate({ text: '.aidiag', id: 'DIAG_1' }));
        assert.ok(
            sock.sent.some((s) => s.content.text && /owner or sudo/i.test(s.content.text)),
            '.aidiag must be gated as owner-only and not swallowed by .ai'
        );

        // Bare "." must NOT trigger .ask / luckyCommand
        sock.sent.length = 0;
        await handleMessages(sock, makeUpdate({ text: '.', id: 'DOT_1', fromMe: true }));
        assert.equal(sock.sent.length, 0, 'bare "." should be ignored');

        // .help works cleanly
        sock.sent.length = 0;
        await handleMessages(sock, makeUpdate({ text: '.help', id: 'HELP_1', fromMe: true }));
        assert.ok(sock.sent.some((s) => s.content.text && s.content.text.includes('Quick Commands')));
    } finally {
        global.botModeCache = prevMode;
    }
});

test('main.js exports every symbol destructured by index.js and tracks bot-sent IDs', async () => {
    assert.equal(typeof trackBotSentId, 'function');

    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    const match = indexSrc.match(/const\s*\{([^}]+)\}\s*=\s*require\(['"]\.\/main['"]\)/);
    assert.ok(match, 'index.js must destructure exports from ./main');

    const mainExports = require('../main');
    const importedNames = match[1]
        .split(',')
        .map((s) => s.trim().split(':')[0].trim())
        .filter(Boolean);

    for (const name of importedNames) {
        assert.notEqual(
            mainExports[name],
            undefined,
            `main.js must export "${name}" required by index.js`
        );
    }

    resetAntiBanState();
    const prevMode = global.botModeCache;
    global.botModeCache = { isPublic: true };
    try {
        const sock = makeMockSock();
        trackBotSentId('BOT_SELF_ECHO_1');
        await handleMessages(sock, makeUpdate({ text: '.ping', id: 'BOT_SELF_ECHO_1', fromMe: true }));
        assert.equal(sock.sent.length, 0, 'tracked bot-sent message ID must be ignored to prevent self-reply loops');
    } finally {
        global.botModeCache = prevMode;
    }
});
