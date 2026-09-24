const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractChatRef,
    inspectMessageContent,
    createReporter,
} = require('../../lib/bridge/reporter');
const { createBridgeState } = require('../../lib/bridge/state');
const { deterministicEventId } = require('../../lib/bridge/protocol');

const SESSION = '237699999999';
const CUSTOMER_PHONE = '237611111111';
const CUSTOMER_LID = '1234567890123';

function mockWacrmClient() {
    const emitted = [];
    const uploadedMedia = [];
    return {
        emitted,
        uploadedMedia,
        isConfigured: () => true,
        emit: (session, type, payload, eventId) => {
            const entry = { session, type, payload, eventId };
            emitted.push(entry);
            return eventId;
        },
        uploadMedia: async (session, buffer, opts) => {
            uploadedMedia.push({ session, buffer, opts });
            return {
                url: `https://wacrm.example.com/media/${opts.filename || 'media.jpg'}`,
                mimeType: opts.mimeType || 'image/jpeg',
                sizeBytes: buffer.length,
            };
        },
    };
}

test('extractChatRef extracts phone, lid, and pushName accurately', () => {
    // Standard phone JID
    const phoneOnly = extractChatRef(`${CUSTOMER_PHONE}@s.whatsapp.net`, null, 'Alice');
    assert.deepEqual(phoneOnly, { phone: CUSTOMER_PHONE, pushName: 'Alice' });

    // LID JID
    const lidOnly = extractChatRef(`${CUSTOMER_LID}@lid`, null, 'Bob');
    assert.deepEqual(lidOnly, { lid: CUSTOMER_LID, pushName: 'Bob' });

    // Group or participant pairing phone and LID
    const groupChat = extractChatRef('120363000000000000@g.us', `${CUSTOMER_PHONE}@s.whatsapp.net`, 'Charlie');
    assert.equal(groupChat.phone, CUSTOMER_PHONE);
    assert.equal(groupChat.pushName, 'Charlie');

    // Phone with device suffix
    const deviceSuffix = extractChatRef(`${CUSTOMER_PHONE}:15@s.whatsapp.net`);
    assert.equal(deviceSuffix.phone, CUSTOMER_PHONE);
});

test('inspectMessageContent unwraps wrappers and maps message kinds', () => {
    // Simple text
    const textMsg = inspectMessageContent({ conversation: 'Hello Davila' });
    assert.equal(textMsg.kind, 'text');
    assert.equal(textMsg.text, 'Hello Davila');

    // Extended text with quotedId
    const extText = inspectMessageContent({
        extendedTextMessage: {
            text: 'I want starter pack',
            contextInfo: { stanzaId: 'ORIG_MSG_123' },
        },
    });
    assert.equal(extText.kind, 'text');
    assert.equal(extText.text, 'I want starter pack');
    assert.equal(extText.quotedId, 'ORIG_MSG_123');

    // Image message with caption
    const imageMsg = inspectMessageContent({
        imageMessage: {
            mimetype: 'image/jpeg',
            caption: 'Here is my shop',
            contextInfo: { stanzaId: 'REPLY_TO_1' },
        },
    });
    assert.equal(imageMsg.kind, 'image');
    assert.equal(imageMsg.mimeType, 'image/jpeg');
    assert.equal(imageMsg.text, 'Here is my shop');
    assert.equal(imageMsg.quotedId, 'REPLY_TO_1');

    // Reaction message
    const reactionMsg = inspectMessageContent({
        reactionMessage: {
            key: { id: 'TARGET_MSG_456', remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net` },
            text: '❤️',
        },
    });
    assert.equal(reactionMsg.kind, 'reaction');
    assert.equal(reactionMsg.reaction.text, '❤️');

    // Location message
    const locMsg = inspectMessageContent({
        locationMessage: {
            degreesLatitude: 3.848,
            degreesLongitude: 11.502,
            name: 'Yaoundé Central',
            address: 'Boulevard du 20 Mai',
        },
    });
    assert.equal(locMsg.kind, 'location');
    assert.equal(locMsg.location.latitude, 3.848);
    assert.equal(locMsg.location.name, 'Yaoundé Central');
});

test('processMessage reports inbound text message with customer origin and deterministic eventId', async () => {
    const client = mockWacrmClient();
    const reporter = createReporter({ getClient: () => client });

    const mek = {
        key: {
            id: 'INBOUND_MSG_001',
            remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`,
            fromMe: false,
        },
        message: {
            conversation: 'Combien coûte le pack Business ?',
        },
        messageTimestamp: 1727136000,
        pushName: 'Prosper',
    };

    await reporter.processMessage(SESSION, mek);

    assert.equal(client.emitted.length, 1);
    const event = client.emitted[0];
    assert.equal(event.session, SESSION);
    assert.equal(event.type, 'message');
    assert.equal(event.payload.id, 'INBOUND_MSG_001');
    assert.equal(event.payload.direction, 'inbound');
    assert.equal(event.payload.origin, 'customer');
    assert.equal(event.payload.chat.phone, CUSTOMER_PHONE);
    assert.equal(event.payload.chat.pushName, 'Prosper');
    assert.equal(event.payload.text, 'Combien coûte le pack Business ?');
    assert.equal(event.payload.kind, 'text');
    assert.equal(event.payload.timestamp, 1727136000);

    const expectedId = deterministicEventId(SESSION, 'message', 'INBOUND_MSG_001');
    assert.equal(event.eventId, expectedId);
});

test('processMessage downloads media and uploads to wacrm before emitting message event', async () => {
    const client = mockWacrmClient();
    const fakeBuffer = Buffer.from('fake-image-bytes-12345');
    const downloadMediaImpl = async () => {
        return (async function* () {
            yield fakeBuffer;
        })();
    };

    const reporter = createReporter({
        getClient: () => client,
        downloadMediaImpl,
    });

    const mek = {
        key: {
            id: 'INBOUND_IMG_002',
            remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`,
            fromMe: false,
        },
        message: {
            imageMessage: {
                mimetype: 'image/png',
                caption: 'Proof of receipt',
            },
        },
        messageTimestamp: 1727136010,
    };

    await reporter.processMessage(SESSION, mek);

    // Verify media was uploaded
    assert.equal(client.uploadedMedia.length, 1);
    assert.deepEqual(client.uploadedMedia[0].buffer, fakeBuffer);

    // Verify message event was emitted with media URL
    assert.equal(client.emitted.length, 1);
    const event = client.emitted[0];
    assert.equal(event.type, 'message');
    assert.equal(event.payload.kind, 'image');
    assert.equal(event.payload.media.url, 'https://wacrm.example.com/media/media.jpg');
    assert.equal(event.payload.media.mimeType, 'image/png');
    assert.equal(event.payload.text, 'Proof of receipt');
});

test('processMessage gracefully handles media upload failure by preserving text/caption', async () => {
    const client = mockWacrmClient();
    const downloadMediaImpl = async () => {
        throw new Error('Decryption network timeout');
    };

    const reporter = createReporter({
        getClient: () => client,
        downloadMediaImpl,
        log: { warn() {}, error() {} },
    });

    const mek = {
        key: {
            id: 'INBOUND_FAIL_003',
            remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`,
            fromMe: false,
        },
        message: {
            imageMessage: {
                mimetype: 'image/jpeg',
                caption: 'Important contract photo',
            },
        },
        messageTimestamp: 1727136020,
    };

    await reporter.processMessage(SESSION, mek);

    assert.equal(client.emitted.length, 1);
    const event = client.emitted[0];
    assert.equal(event.type, 'message');
    assert.equal(event.payload.kind, 'image');
    assert.equal(event.payload.text, 'Important contract photo');
    assert.equal(event.payload.media, undefined); // upload failed but event preserved
});

test('outbound message: distinguishes Davila vs phone origin and suppresses CRM-sent echo', async () => {
    const client = mockWacrmClient();
    const state = createBridgeState();
    const reporter = createReporter({ getClient: () => client, state });

    // 1. Message sent by WACRM via /bridge/send -> should be skipped!
    const crmMsgId = 'CRM_SENT_999';
    state.markCrmSent(crmMsgId);
    await reporter.processMessage(SESSION, {
        key: { id: crmMsgId, remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`, fromMe: true },
        message: { conversation: 'Message from human agent in WACRM' },
    });
    assert.equal(client.emitted.length, 0);

    // 2. Message sent by Davila (autoReplyManager)
    const davilaMsgId = 'DAVILA_MSG_001';
    reporter.markDavilaSent(davilaMsgId);
    await reporter.processMessage(SESSION, {
        key: { id: davilaMsgId, remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`, fromMe: true },
        message: { conversation: 'Bonjour ! Je suis Davila.' },
    });
    assert.equal(client.emitted.length, 1);
    assert.equal(client.emitted[0].payload.direction, 'outbound');
    assert.equal(client.emitted[0].payload.origin, 'davila');

    // 3. Message sent manually from physical phone (or bot command)
    const phoneMsgId = 'PHONE_MSG_002';
    await reporter.processMessage(SESSION, {
        key: { id: phoneMsgId, remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`, fromMe: true },
        message: { conversation: 'Typed on phone' },
    });
    assert.equal(client.emitted.length, 2);
    assert.equal(client.emitted[1].payload.direction, 'outbound');
    assert.equal(client.emitted[1].payload.origin, 'phone');
});

test('reportStatusUpdate maps Baileys status codes and emits status events', () => {
    const client = mockWacrmClient();
    const reporter = createReporter({ getClient: () => client });

    // Status 2 -> 'sent'
    reporter.reportStatusUpdate(SESSION, {
        key: { id: 'MSG_STAT_1', remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net` },
        update: { status: 2 },
    });
    // Status 3 -> 'delivered'
    reporter.reportStatusUpdate(SESSION, {
        key: { id: 'MSG_STAT_2', remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net` },
        update: { status: 3 },
    });
    // Status 4 -> 'read'
    reporter.reportStatusUpdate(SESSION, {
        key: { id: 'MSG_STAT_3', remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net` },
        update: { status: 4 },
    });
    // Status 0 -> 'failed'
    reporter.reportStatusUpdate(SESSION, {
        key: { id: 'MSG_STAT_4', remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net` },
        update: { status: 0 },
    });

    assert.equal(client.emitted.length, 4);
    assert.equal(client.emitted[0].payload.status, 'sent');
    assert.equal(client.emitted[1].payload.status, 'delivered');
    assert.equal(client.emitted[2].payload.status, 'read');
    assert.equal(client.emitted[3].payload.status, 'failed');

    // Deterministic ID check
    const expectedId = deterministicEventId(SESSION, 'status', 'MSG_STAT_3:read');
    assert.equal(client.emitted[2].eventId, expectedId);
});

test('reaction handling: reports reactions and reaction clearing', () => {
    const client = mockWacrmClient();
    const reporter = createReporter({ getClient: () => client });

    reporter.reportReaction(SESSION, {
        key: { id: 'REACT_MSG_1', remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`, fromMe: false },
        reaction: {
            key: { id: 'ORIG_MSG_001', fromMe: false },
            text: '🔥',
        },
    });

    assert.equal(client.emitted.length, 1);
    const r1 = client.emitted[0];
    assert.equal(r1.type, 'reaction');
    assert.equal(r1.payload.targetId, 'ORIG_MSG_001');
    assert.equal(r1.payload.emoji, '🔥');
    assert.equal(r1.payload.fromMe, false);

    // Reaction clearing (empty emoji)
    reporter.reportReaction(SESSION, {
        key: { id: 'REACT_MSG_2', remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`, fromMe: false },
        reaction: {
            key: { id: 'ORIG_MSG_001', fromMe: false },
            text: '',
        },
    });

    assert.equal(client.emitted.length, 2);
    assert.equal(client.emitted[1].payload.emoji, '');
});

test('connection reporting: reports connected, disconnected, and logged_out with pairingRef', () => {
    const client = mockWacrmClient();
    const reporter = createReporter({ getClient: () => client });

    reporter.reportConnection(SESSION, 'connected', { phone: SESSION, name: 'TchuekBot' }, 'ref-uuid-1234');
    reporter.reportConnection(SESSION, 'disconnected', null, null, 'stream reset');
    reporter.reportConnection(SESSION, 'logged_out', null, null, 'device unlinked');

    assert.equal(client.emitted.length, 3);
    assert.equal(client.emitted[0].payload.status, 'connected');
    assert.equal(client.emitted[0].payload.pairingRef, 'ref-uuid-1234');
    assert.equal(client.emitted[0].payload.me.phone, SESSION);
    assert.equal(client.emitted[1].payload.status, 'disconnected');
    assert.equal(client.emitted[1].payload.reason, 'stream reset');
    assert.equal(client.emitted[2].payload.status, 'logged_out');
});

test('business CRM events: reports deal closed, facts, tally submitted, opt-out, and ai paused', () => {
    const client = mockWacrmClient();
    const reporter = createReporter({ getClient: () => client });
    const chat = { phone: CUSTOMER_PHONE, pushName: 'Jean' };

    // Deal closed
    reporter.reportDealClosed(SESSION, chat, { pack: 'business', value: 75000, currency: 'XAF' });
    // Contact facts
    reporter.reportContactFacts(SESSION, chat, {
        name: 'Jean Paul',
        businessType: 'Boutique Vetements',
        location: 'Douala Akwa',
        interestedPack: 'business',
    });
    // Tally submitted
    reporter.reportTallySubmitted(SESSION, chat);
    // Contact opted out
    reporter.reportContactOptedOut(SESSION, chat);
    // AI paused
    reporter.reportAiPaused(SESSION, chat, 1727140000000);

    assert.equal(client.emitted.length, 5);

    const dealEvent = client.emitted[0];
    assert.equal(dealEvent.type, 'deal.closed');
    assert.equal(dealEvent.payload.pack, 'business');
    assert.equal(dealEvent.payload.value, 75000);

    const factsEvent = client.emitted[1];
    assert.equal(factsEvent.type, 'contact.facts');
    assert.equal(factsEvent.payload.facts.name, 'Jean Paul');
    assert.equal(factsEvent.payload.facts.businessType, 'Boutique Vetements');

    const tallyEvent = client.emitted[2];
    assert.equal(tallyEvent.type, 'tally.submitted');
    assert.equal(tallyEvent.payload.chat.phone, CUSTOMER_PHONE);

    const optOutEvent = client.emitted[3];
    assert.equal(optOutEvent.type, 'contact.opted_out');
    assert.equal(optOutEvent.payload.chat.phone, CUSTOMER_PHONE);

    const pauseEvent = client.emitted[4];
    assert.equal(pauseEvent.type, 'ai.paused');
    assert.equal(pauseEvent.payload.until, 1727140000000);
});

test('idempotency: identical WhatsApp event produces the same deterministic eventId across runs', () => {
    const id1 = deterministicEventId(SESSION, 'message', 'BAE5SAMEID123');
    const id2 = deterministicEventId(SESSION, 'message', 'BAE5SAMEID123');
    assert.equal(id1, id2);

    const statusId1 = deterministicEventId(SESSION, 'status', 'BAE5SAMEID123:delivered');
    const statusId2 = deterministicEventId(SESSION, 'status', 'BAE5SAMEID123:delivered');
    assert.equal(statusId1, statusId2);
});

test('attachSocket: hooks socket events and wraps sendMessage without throwing', async () => {
    const client = mockWacrmClient();
    const reporter = createReporter({ getClient: () => client });

    const listeners = new Map();
    let sentArgs = null;

    const fakeSocket = {
        ev: {
            on: (name, cb) => {
                listeners.set(name, cb);
            },
        },
        sendMessage: async (jid, content, options) => {
            sentArgs = { jid, content, options };
            return { key: { id: 'OUT_REPLY_123' } };
        },
    };

    reporter.attachSocket(fakeSocket, SESSION);

    // Verify listeners registered
    assert.ok(listeners.has('messages.upsert'));
    assert.ok(listeners.has('messages.update'));
    assert.ok(listeners.has('messages.reaction'));

    // Verify sendMessage wrapper marks Davila
    await fakeSocket.sendMessage(`${CUSTOMER_PHONE}@s.whatsapp.net`, { text: 'Hi' }, { _origin: 'davila' });
    assert.ok(reporter.isDavilaSent('OUT_REPLY_123'));
});
