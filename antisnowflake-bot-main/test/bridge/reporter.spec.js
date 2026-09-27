const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractChatRef,
    inspectMessageContent,
    createReporter,
} = require('../../lib/bridge/reporter');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

    const buttonReply = inspectMessageContent({
        buttonsResponseMessage: {
            selectedDisplayText: 'Get pricing',
            selectedButtonId: 'pricing',
        },
    });
    assert.equal(buttonReply.kind, 'text');
    assert.equal(buttonReply.text, 'Get pricing');

    const listReply = inspectMessageContent({
        listResponseMessage: {
            title: 'Business plan',
            singleSelectReply: { selectedRowId: 'business' },
        },
    });
    assert.equal(listReply.kind, 'text');
    assert.equal(listReply.text, 'Business plan');

    const nativeFlowReply = inspectMessageContent({
        interactiveResponseMessage: {
            nativeFlowResponseMessage: {
                paramsJson: JSON.stringify({ display_text: 'Talk to sales', id: 'sales' }),
            },
        },
    });
    assert.equal(nativeFlowReply.kind, 'text');
    assert.equal(nativeFlowReply.text, 'Talk to sales');

    const buttonPrompt = inspectMessageContent({
        buttonsMessage: {
            contentText: 'Confirm your choice?',
            footerText: 'MboWazap Engagement',
            buttons: [
                { buttonId: 'yes', buttonText: { displayText: 'Yes' } },
                { buttonId: 'change', buttonText: { displayText: 'Change pack' } },
            ],
        },
    });
    assert.equal(buttonPrompt.kind, 'text');
    assert.match(buttonPrompt.text, /Confirm your choice\?/);
    assert.match(buttonPrompt.text, /- Yes/);
    assert.match(buttonPrompt.text, /- Change pack/);

    const listPrompt = inspectMessageContent({
        listMessage: {
            title: 'FAQ',
            description: 'Choose a question',
            sections: [{ rows: [{ title: 'Delivery time', rowId: 'delivery', description: 'When it arrives' }] }],
        },
    });
    assert.equal(listPrompt.kind, 'text');
    assert.match(listPrompt.text, /FAQ/);
    assert.match(listPrompt.text, /Delivery time: When it arrives/);
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

test('processMessage mirrors view-once button prompts as readable CRM text', async () => {
    const client = mockWacrmClient();
    const reporter = createReporter({ getClient: () => client });

    await reporter.processMessage(SESSION, {
        key: {
            id: 'OUTBOUND_BUTTON_001',
            remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`,
            fromMe: true,
        },
        message: {
            viewOnceMessage: {
                message: {
                    buttonsMessage: {
                        contentText: 'Confirm your choice?',
                        buttons: [
                            { buttonId: 'yes', buttonText: { displayText: 'Yes' } },
                            { buttonId: 'change', buttonText: { displayText: 'Change pack' } },
                        ],
                    },
                },
            },
        },
    });

    assert.equal(client.emitted.length, 1);
    assert.equal(client.emitted[0].payload.kind, 'text');
    assert.match(client.emitted[0].payload.text, /Confirm your choice\?/);
    assert.match(client.emitted[0].payload.text, /- Yes/);
    assert.match(client.emitted[0].payload.text, /- Change pack/);
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
    // A temp dir: the phone-origin path persists a pause, which must not
    // land in the real data/bridge/pauses.json of a dev checkout.
    const state = tempState();
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
    assert.ok(listeners.has('messaging-history.set'));
    assert.ok(listeners.has('contacts.upsert'));
    assert.ok(listeners.has('contacts.update'));
    assert.ok(listeners.has('messages.update'));
    assert.ok(listeners.has('messages.reaction'));

    // Verify sendMessage wrapper marks Davila
    await fakeSocket.sendMessage(`${CUSTOMER_PHONE}@s.whatsapp.net`, { text: 'Hi' }, { _origin: 'davila' });
    assert.ok(reporter.isDavilaSent('OUT_REPLY_123'));
});

test('attachSocket syncs history messages and contact names, but ignores group messages', async () => {
    const client = mockWacrmClient();
    const reporter = createReporter({ getClient: () => client });
    const listeners = new Map();
    const fakeSocket = {
        ev: { on: (name, callback) => listeners.set(name, callback) },
        sendMessage: async () => ({ key: { id: 'OUT_REPLY_123' } }),
    };
    reporter.attachSocket(fakeSocket, SESSION);

    listeners.get('contacts.upsert')([
        { id: `${CUSTOMER_PHONE}@s.whatsapp.net`, name: 'Alice Saved', notify: 'Alice Phone' },
    ]);
    listeners.get('contacts.update')([
        { id: `${CUSTOMER_LID}@lid`, name: 'Bob' },
    ]);
    listeners.get('messaging-history.set')({
        contacts: [{ id: `${CUSTOMER_PHONE}@s.whatsapp.net`, name: 'Alice' }],
        messages: [
            {
                key: {
                    id: 'HISTORY_MSG_001',
                    remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`,
                    fromMe: false,
                },
                message: { conversation: 'Earlier conversation' },
                messageTimestamp: 1727136000,
                pushName: 'Alice',
            },
            {
                key: {
                    id: 'GROUP_MSG_001',
                    remoteJid: '120363000000000000@g.us',
                    participant: `${CUSTOMER_PHONE}@s.whatsapp.net`,
                    fromMe: false,
                },
                message: { conversation: 'Group message is not a 1:1 CRM thread' },
                messageTimestamp: 1727136000,
            },
        ],
    });

    await new Promise((resolve) => setImmediate(resolve));

    const contactEvents = client.emitted.filter((event) => event.type === 'contact.facts');
    assert.ok(contactEvents.some((event) => event.payload.chat.phone === CUSTOMER_PHONE && event.payload.facts.name === 'Alice Saved'));
    assert.ok(contactEvents.some((event) => event.payload.chat.lid === CUSTOMER_LID && event.payload.facts.name === 'Bob'));
    const messageEvents = client.emitted.filter((event) => event.type === 'message');
    assert.equal(messageEvents.length, 1);
    assert.equal(messageEvents[0].payload.id, 'HISTORY_MSG_001');
    assert.equal(messageEvents[0].payload.text, 'Earlier conversation');
});

function tempState() {
    return createBridgeState({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-reporter-')) });
}

function fakeSocketFor(reporter) {
    let counter = 0;
    const sock = {
        ev: { on() {} },
        sendMessage: async (jid) => ({ key: { id: `BOT_OUT_${++counter}`, remoteJid: jid, fromMe: true } }),
    };
    reporter.attachSocket(sock, SESSION);
    return sock;
}

test('connection events get a fresh id per occurrence, so wacrm never drops a reconnect as a duplicate', () => {
    const client = mockWacrmClient();
    let clock = 1_700_000_000_000;
    const reporter = createReporter({ getClient: () => client, now: () => clock });

    reporter.reportConnection(SESSION, 'connected', { phone: SESSION }, 'ref-uuid-1234');
    clock += 60_000;
    reporter.reportConnection(SESSION, 'disconnected', null, null, 'stream reset');
    clock += 5_000;
    // Reconnect of the same session with the same (retained) pairing ref.
    reporter.reportConnection(SESSION, 'connected', { phone: SESSION }, 'ref-uuid-1234');
    clock += 60_000;
    reporter.reportConnection(SESSION, 'disconnected', null, null, 'stream reset');

    const ids = client.emitted.map((e) => e.eventId);
    assert.equal(new Set(ids).size, 4);
});

test('anything sent through the socket is automation, tagged or not — no human takeover', async () => {
    const client = mockWacrmClient();
    const state = tempState();
    const reporter = createReporter({ getClient: () => client, state });
    const sock = fakeSocketFor(reporter);

    // e.g. Davila's "couldn't hear your voice note" apology, the STOP
    // confirmation or the human-request acknowledgement: none carry _origin.
    const sent = await sock.sendMessage(`${CUSTOMER_PHONE}@s.whatsapp.net`, { text: 'Désolée…' });
    await reporter.processMessage(SESSION, {
        key: { id: sent.key.id, remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`, fromMe: true },
        message: { conversation: 'Désolée…' },
    });

    assert.equal(client.emitted.length, 1);
    assert.equal(client.emitted[0].payload.origin, 'davila');
    assert.equal(state.isContactPaused(CUSTOMER_PHONE), false);
});

test('a message typed on the phone is still a human takeover: origin phone, Davila paused', async () => {
    const client = mockWacrmClient();
    const state = tempState();
    let cancelled = false;
    state.registerActiveDavilaRun(CUSTOMER_PHONE, { abort: () => { cancelled = true; } });
    const reporter = createReporter({ getClient: () => client, state });
    fakeSocketFor(reporter);

    // Never went through sock.sendMessage: typed on the paired phone.
    await reporter.processMessage(SESSION, {
        key: { id: 'PHONE_TYPED_1', remoteJid: `${CUSTOMER_PHONE}@s.whatsapp.net`, fromMe: true },
        message: { conversation: 'Je prends le relais' },
    });

    assert.equal(client.emitted[0].payload.origin, 'phone');
    assert.equal(state.isContactPaused(CUSTOMER_PHONE), true);
    assert.equal(cancelled, true);
});

test('group, broadcast and newsletter traffic is never reported as a 1:1 conversation', async () => {
    const client = mockWacrmClient();
    const state = tempState();
    const reporter = createReporter({ getClient: () => client, state });

    // A member writing in a group the business number belongs to.
    await reporter.processMessage(SESSION, {
        key: {
            id: 'GROUP_MSG_1',
            remoteJid: '120363000000000000@g.us',
            participant: `${CUSTOMER_PHONE}@s.whatsapp.net`,
            fromMe: false,
        },
        message: { conversation: 'hello group' },
    });
    // The owner posting in that group from the phone.
    await reporter.processMessage(SESSION, {
        key: {
            id: 'GROUP_MSG_2',
            remoteJid: '120363000000000000@g.us',
            participant: `${SESSION}@s.whatsapp.net`,
            fromMe: true,
        },
        message: { conversation: 'owner in group' },
    });
    await reporter.processMessage(SESSION, {
        key: { id: 'NEWS_1', remoteJid: '120363111111111111@newsletter', fromMe: false },
        message: { conversation: 'channel post' },
    });
    reporter.reportStatusUpdate(SESSION, {
        key: {
            id: 'GROUP_MSG_2',
            remoteJid: '120363000000000000@g.us',
            participant: `${CUSTOMER_PHONE}@s.whatsapp.net`,
        },
        update: { status: 4 },
    });
    reporter.reportReaction(SESSION, {
        key: {
            id: 'GROUP_MSG_1',
            remoteJid: '120363000000000000@g.us',
            participant: `${CUSTOMER_PHONE}@s.whatsapp.net`,
        },
        reaction: { text: '👍', key: { id: 'GROUP_MSG_1' } },
    });

    assert.equal(client.emitted.length, 0);
    assert.equal(state.isContactPaused(CUSTOMER_PHONE), false);
    assert.equal(state.isContactPaused(SESSION), false);
});
