const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../../lib/bridge/protocol');

const REF = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const SESSION = '237600000001';

function assertInvalid(fn, pattern) {
    assert.throws(fn, (err) => {
        assert.ok(err instanceof protocol.BridgeError);
        assert.equal(err.status, 400);
        assert.equal(err.code, 'invalid_request');
        if (pattern) assert.match(err.message, pattern);
        return true;
    });
}

test('parsePairRequest: code needs a phone, qr does not', () => {
    assert.deepEqual(protocol.parsePairRequest({ pairingRef: REF, method: 'code', phone: SESSION }), {
        pairingRef: REF,
        method: 'code',
        phone: SESSION,
    });
    assert.deepEqual(protocol.parsePairRequest({ pairingRef: REF, method: 'qr' }), { pairingRef: REF, method: 'qr' });
    assertInvalid(() => protocol.parsePairRequest({ pairingRef: REF, method: 'code' }), /phone/);
    assertInvalid(() => protocol.parsePairRequest({ pairingRef: 'not-a-uuid', method: 'qr' }), /pairingRef/);
    assertInvalid(() => protocol.parsePairRequest({ pairingRef: REF, method: 'sms' }), /method/);
    assertInvalid(() => protocol.parsePairRequest(null), /JSON object/);
});

test('parseSendRequest: text message', () => {
    const cmd = protocol.parseSendRequest({
        session: SESSION,
        to: { phone: '237699999999' },
        kind: 'text',
        text: 'Hello',
        origin: 'agent',
    });
    assert.deepEqual(cmd, {
        session: SESSION,
        to: { phone: '237699999999' },
        kind: 'text',
        origin: 'agent',
        text: 'Hello',
        quotedId: undefined,
    });
    assertInvalid(() => protocol.parseSendRequest({ ...cmd, text: '   ' }), /text is required/);
});

test('parseSendRequest: media needs an http(s) mediaUrl', () => {
    const base = { session: SESSION, to: { lid: '123456789012' }, kind: 'image', origin: 'flow' };
    const cmd = protocol.parseSendRequest({ ...base, mediaUrl: 'https://cdn.example.com/a.jpg', mimeType: 'image/jpeg', text: 'caption' });
    assert.equal(cmd.mediaUrl, 'https://cdn.example.com/a.jpg');
    assert.equal(cmd.mimeType, 'image/jpeg');
    assert.equal(cmd.text, 'caption');
    assertInvalid(() => protocol.parseSendRequest(base), /mediaUrl/);
    assertInvalid(() => protocol.parseSendRequest({ ...base, mediaUrl: 'file:///etc/passwd' }), /http/);
    assertInvalid(() => protocol.parseSendRequest({ ...base, mediaUrl: 'https://x/a', mimeType: 'jpeg' }), /mimeType/);
});

test('parseSendRequest: recipient, session and origin rules', () => {
    const base = { session: SESSION, kind: 'text', text: 'hi', origin: 'agent' };
    assertInvalid(() => protocol.parseSendRequest({ ...base, to: { phone: '237699999999', lid: '123456' } }), /exactly one/);
    assertInvalid(() => protocol.parseSendRequest({ ...base, to: {} }), /exactly one/);
    assertInvalid(() => protocol.parseSendRequest({ ...base, to: { phone: '+237 699' } }), /to.phone/);
    assertInvalid(() => protocol.parseSendRequest({ ...base, to: { phone: '237699999999' }, session: 'temp_qr' }), /session/);
    assertInvalid(() => protocol.parseSendRequest({ ...base, to: { phone: '237699999999' }, origin: 'broadcast' }), /origin/);
    assertInvalid(() => protocol.parseSendRequest({ ...base, to: { phone: '237699999999' }, kind: 'sticker' }), /kind/);
});

test('parseReactRequest allows an empty emoji (removes the reaction)', () => {
    const cmd = protocol.parseReactRequest({
        session: SESSION,
        to: { phone: '237699999999' },
        targetId: '3EB0ABCDEF',
        targetFromMe: false,
        emoji: '',
    });
    assert.equal(cmd.emoji, '');
    assertInvalid(() => protocol.parseReactRequest({ ...cmd, targetFromMe: 'no' }), /targetFromMe/);
});

test('parseContactAiRequest bounds minutes', () => {
    assert.deepEqual(protocol.parseContactAiRequest({ session: SESSION, paused: true }), {
        session: SESSION,
        paused: true,
        minutes: undefined,
    });
    assert.equal(protocol.parseContactAiRequest({ session: SESSION, paused: true, minutes: 30 }).minutes, 30);
    assertInvalid(() => protocol.parseContactAiRequest({ session: SESSION, paused: true, minutes: 0 }), /minutes/);
    assertInvalid(() => protocol.parseContactAiRequest({ session: SESSION, paused: true, minutes: 1.5 }), /minutes/);
});

test('recipientJid maps phone and lid recipients', () => {
    assert.equal(protocol.recipientJid({ phone: '237699999999' }), '237699999999@s.whatsapp.net');
    assert.equal(protocol.recipientJid({ lid: '123456789012' }), '123456789012@lid');
});

test('buildEvent stamps id, type and time; unknown types throw', () => {
    const event = protocol.buildEvent('status', { id: 'ABC', status: 'read' }, 1700000000000);
    assert.equal(event.type, 'status');
    assert.equal(event.at, 1700000000000);
    assert.match(event.eventId, /^[0-9a-f-]{36}$/);
    assert.equal(event.status, 'read');
    assert.throws(() => protocol.buildEvent('message.deleted', {}), /Unknown bridge event type/);
});
