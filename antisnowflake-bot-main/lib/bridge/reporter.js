/**
 * MboWazap bridge — Baileys outbound event reporting layer.
 *
 * Coordinates transforming real WhatsApp events (incoming & outgoing messages,
 * delivery statuses, reactions, connection changes, and Davila CRM insights)
 * into signed, idempotent Mbowazap protocol batches delivered to wacrm.
 *
 * Requirements:
 *  - Fully asynchronous and non-blocking: never crashes or delays Baileys socket.
 *  - Idempotent: deterministic event IDs prevent duplicate CRM rows on retry/restart.
 *  - Media streaming: uploads binary media to /api/mbowazap/media before emitting message.
 *  - Actor classification: identifies Davila replies (origin: 'davila') vs phone (origin: 'phone').
 *  - Echo suppression: suppresses messages originated by wacrm (/bridge/send).
 */

const crypto = require('crypto');
const { getWacrmClient, MEDIA_MAX_BYTES } = require('./wacrmClient');
const { deterministicEventId, SESSION_PATTERN, CONTACT_PATTERN } = require('./protocol');
const bridgeState = require('./state');

const DAVILA_SENT_TTL_MS = 10 * 60 * 1000;

/**
 * Extracts inner message content from standard Baileys wrappers
 */
function unwrapMessage(content) {
    if (!content) return null;
    if (content.ephemeralMessage?.message) return unwrapMessage(content.ephemeralMessage.message);
    if (content.viewOnceMessage?.message) return unwrapMessage(content.viewOnceMessage.message);
    if (content.viewOnceMessageV2?.message) return unwrapMessage(content.viewOnceMessageV2.message);
    if (content.documentWithCaptionMessage?.message) return unwrapMessage(content.documentWithCaptionMessage.message);
    return content;
}

/**
 * Extracts ChatRef (phone, lid, pushName) from remoteJid, participant, and pushName
 */
function extractChatRef(remoteJid, participant = null, pushName = null) {
    const chat = {};
    const jids = [remoteJid, participant].filter(Boolean);

    for (const jid of jids) {
        const parts = String(jid).split('@');
        if (parts.length !== 2) continue;
        const cleanUser = parts[0].split(':')[0].replace(/[^0-9]/g, '');
        const server = parts[1];
        if (server === 's.whatsapp.net' && SESSION_PATTERN.test(cleanUser)) {
            chat.phone = cleanUser;
        } else if (server === 'lid' && CONTACT_PATTERN.test(cleanUser)) {
            chat.lid = cleanUser;
        }
    }

    if (pushName && typeof pushName === 'string' && pushName.trim()) {
        chat.pushName = pushName.trim().slice(0, 256);
    }

    return chat;
}

/**
 * Maps Baileys message content to protocol MessageKind and metadata
 */
function inspectMessageContent(innerMsg) {
    if (!innerMsg) return { kind: 'unsupported', text: '[Empty message]' };

    if (innerMsg.reactionMessage) {
        return {
            kind: 'reaction',
            reaction: innerMsg.reactionMessage,
        };
    }

    if (innerMsg.conversation) {
        return { kind: 'text', text: innerMsg.conversation };
    }
    if (innerMsg.extendedTextMessage) {
        return {
            kind: 'text',
            text: innerMsg.extendedTextMessage.text || '',
            quotedId: innerMsg.extendedTextMessage.contextInfo?.stanzaId,
        };
    }
    if (innerMsg.imageMessage) {
        return {
            kind: 'image',
            mediaType: 'image',
            raw: innerMsg.imageMessage,
            mimeType: innerMsg.imageMessage.mimetype || 'image/jpeg',
            text: innerMsg.imageMessage.caption || undefined,
            quotedId: innerMsg.imageMessage.contextInfo?.stanzaId,
        };
    }
    if (innerMsg.videoMessage) {
        return {
            kind: 'video',
            mediaType: 'video',
            raw: innerMsg.videoMessage,
            mimeType: innerMsg.videoMessage.mimetype || 'video/mp4',
            text: innerMsg.videoMessage.caption || undefined,
            quotedId: innerMsg.videoMessage.contextInfo?.stanzaId,
        };
    }
    if (innerMsg.audioMessage) {
        return {
            kind: 'audio',
            mediaType: 'audio',
            raw: innerMsg.audioMessage,
            mimeType: innerMsg.audioMessage.mimetype || 'audio/ogg; codecs=opus',
            quotedId: innerMsg.audioMessage.contextInfo?.stanzaId,
        };
    }
    if (innerMsg.documentMessage) {
        return {
            kind: 'document',
            mediaType: 'document',
            raw: innerMsg.documentMessage,
            mimeType: innerMsg.documentMessage.mimetype || 'application/octet-stream',
            filename: innerMsg.documentMessage.fileName || 'document',
            text: innerMsg.documentMessage.caption || undefined,
            quotedId: innerMsg.documentMessage.contextInfo?.stanzaId,
        };
    }
    if (innerMsg.stickerMessage) {
        return {
            kind: 'sticker',
            mediaType: 'sticker',
            raw: innerMsg.stickerMessage,
            mimeType: innerMsg.stickerMessage.mimetype || 'image/webp',
            quotedId: innerMsg.stickerMessage.contextInfo?.stanzaId,
        };
    }
    if (innerMsg.locationMessage || innerMsg.liveLocationMessage) {
        const loc = innerMsg.locationMessage || innerMsg.liveLocationMessage;
        return {
            kind: 'location',
            location: {
                latitude: loc.degreesLatitude,
                longitude: loc.degreesLongitude,
                name: loc.name || undefined,
                address: loc.address || undefined,
            },
            quotedId: loc.contextInfo?.stanzaId,
        };
    }

    return { kind: 'unsupported', text: '[Unsupported message]' };
}

function normalizeTimestamp(ts) {
    if (!ts) return Math.floor(Date.now() / 1000);
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return Math.floor(Date.now() / 1000);
    return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}

function createReporter({
    getClient = getWacrmClient,
    state = bridgeState,
    log = console,
    now = () => Date.now(),
    downloadMediaImpl = null,
} = {}) {
    const davilaSentMap = new Map(); // msgId -> expiresAt

    function getDownloader() {
        if (downloadMediaImpl) return downloadMediaImpl;
        try {
            return require('@whiskeysockets/baileys').downloadContentFromMessage;
        } catch (_) {
            return null;
        }
    }

    function markDavilaSent(messageId) {
        if (!messageId) return;
        const t = now();
        for (const [id, exp] of davilaSentMap) {
            if (exp <= t) davilaSentMap.delete(id);
        }
        davilaSentMap.set(messageId, t + DAVILA_SENT_TTL_MS);
    }

    function isDavilaSent(messageId) {
        if (!messageId) return false;
        const exp = davilaSentMap.get(messageId);
        return exp !== undefined && exp > now();
    }

    /**
     * Download media stream and upload to wacrm's /api/mbowazap/media endpoint.
     */
    async function handleMediaUpload(session, rawMsg, mediaType, mimeType, filename) {
        const client = getClient();
        if (!client || !client.isConfigured()) return null;

        const downloadFn = getDownloader();
        if (!downloadFn) {
            log.warn('[wacrm-reporter] downloadContentFromMessage not available; skipping media upload');
            return null;
        }

        try {
            const stream = await downloadFn(rawMsg, mediaType);
            const chunks = [];
            let total = 0;
            for await (const chunk of stream) {
                total += chunk.length;
                if (total > MEDIA_MAX_BYTES) {
                    throw new Error(`Media size exceeds limit (${MEDIA_MAX_BYTES} bytes)`);
                }
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            const uploaded = await client.uploadMedia(session, buffer, { mimeType, filename });
            return uploaded;
        } catch (err) {
            log.warn(`[wacrm-reporter] Failed to upload media: ${err.message}`);
            return null;
        }
    }

    /**
     * Report an inbound or outbound message to wacrm.
     */
    async function processMessage(session, mek) {
        if (!SESSION_PATTERN.test(String(session))) return;
        if (!mek || !mek.key) return;

        const messageId = mek.key.id;
        if (!messageId) return;

        const isFromMe = Boolean(mek.key.fromMe);

        // Echo check: If this outbound message was sent by wacrm via /bridge/send, skip reporting
        if (isFromMe && state.wasSentByCrm(messageId)) {
            return;
        }

        const remoteJid = mek.key.remoteJid;
        if (remoteJid === 'status@broadcast') return;

        const inner = unwrapMessage(mek.message);
        if (!inner) return;

        const inspected = inspectMessageContent(inner);

        const chat = extractChatRef(remoteJid, mek.key.participant, mek.pushName);
        if (!chat.phone && !chat.lid) {
            // Cannot attribute conversation to a valid contact phone or LID
            return;
        }

        // If it's a reaction message disguised as a message upsert
        if (inspected.kind === 'reaction' && inspected.reaction) {
            const r = inspected.reaction;
            const targetId = r.key?.id;
            if (targetId) {
                const eventId = deterministicEventId(session, 'reaction', `${targetId}:${isFromMe}:${r.text || 'cleared'}`);
                getClient()?.emit(
                    session,
                    'reaction',
                    {
                        id: messageId,
                        chat,
                        targetId,
                        emoji: r.text || '',
                        fromMe: isFromMe,
                    },
                    eventId
                );
            }
            return;
        }

        const timestamp = normalizeTimestamp(mek.messageTimestamp);
        const direction = isFromMe ? 'outbound' : 'inbound';
        let origin = 'customer';
        if (isFromMe) {
            origin = isDavilaSent(messageId) ? 'davila' : 'phone';
            if (origin === 'phone') {
                const contact = chat.phone || chat.lid;
                if (contact) {
                    const until = now() + (Number(process.env.MBOWAZAP_HANDOFF_MINUTES) || 120) * 60 * 1000;
                    state.setContactPause(contact, until);
                    state.cancelActiveDavilaRun?.(contact, 'phone_outbound_detected');
                }
            }
        }

        let mediaPayload = undefined;
        if (inspected.raw && inspected.mediaType) {
            const uploaded = await handleMediaUpload(
                session,
                inspected.raw,
                inspected.mediaType,
                inspected.mimeType,
                inspected.filename
            );
            if (uploaded?.url) {
                mediaPayload = {
                    url: uploaded.url,
                    mimeType: uploaded.mimeType || inspected.mimeType,
                    filename: inspected.filename,
                    sizeBytes: uploaded.sizeBytes,
                };
            }
        }

        const messagePayload = {
            id: messageId,
            direction,
            origin,
            chat,
            timestamp,
            kind: inspected.kind,
        };

        if (inspected.text) messagePayload.text = inspected.text;
        if (mediaPayload) messagePayload.media = mediaPayload;
        if (inspected.location) messagePayload.location = inspected.location;
        if (inspected.quotedId) messagePayload.quotedId = inspected.quotedId;

        const eventId = deterministicEventId(session, 'message', messageId);
        getClient()?.emit(session, 'message', messagePayload, eventId);
    }

    /**
     * Safe wrapper for message processing that never rejects or throws.
     */
    function reportMessageSafe(session, mek) {
        setImmediate(async () => {
            try {
                await processMessage(session, mek);
            } catch (err) {
                log.error(`[wacrm-reporter] Error reporting message ${mek?.key?.id}:`, err.message);
            }
        });
    }

    /**
     * Map Baileys status integer to protocol Status: 'sent' | 'delivered' | 'read' | 'failed'
     */
    function mapBaileysStatus(statusCode) {
        // Baileys WAMessageStatus enum:
        // 0: ERROR
        // 1: PENDING
        // 2: SERVER_ACK
        // 3: DELIVERY_ACK
        // 4: READ
        // 5: PLAYED
        switch (statusCode) {
            case 0:
                return 'failed';
            case 2:
                return 'sent';
            case 3:
                return 'delivered';
            case 4:
            case 5:
                return 'read';
            default:
                return null;
        }
    }

    /**
     * Report message status updates (messages.update).
     */
    function reportStatusUpdate(session, update) {
        if (!SESSION_PATTERN.test(String(session))) return;
        if (!update || !update.key || update.update?.status === undefined) return;

        const messageId = update.key.id;
        const mappedStatus = mapBaileysStatus(update.update.status);
        if (!mappedStatus) return;

        const chat = extractChatRef(update.key.remoteJid, update.key.participant);
        if (!chat.phone && !chat.lid) return;

        const eventId = deterministicEventId(session, 'status', `${messageId}:${mappedStatus}`);
        getClient()?.emit(
            session,
            'status',
            {
                id: messageId,
                chat,
                status: mappedStatus,
            },
            eventId
        );
    }

    /**
     * Report a reaction event.
     */
    function reportReaction(session, reactionUpdate) {
        if (!SESSION_PATTERN.test(String(session))) return;
        if (!reactionUpdate || !reactionUpdate.key) return;

        const targetId = reactionUpdate.reaction?.key?.id || reactionUpdate.key.id;
        const chat = extractChatRef(reactionUpdate.key.remoteJid, reactionUpdate.key.participant);
        if (!chat.phone && !chat.lid) return;

        const emoji = reactionUpdate.reaction?.text ?? '';
        const fromMe = Boolean(reactionUpdate.reaction?.key?.fromMe ?? reactionUpdate.key.fromMe);
        const eventId = deterministicEventId(session, 'reaction', `${targetId}:${fromMe}:${emoji || 'cleared'}`);

        getClient()?.emit(
            session,
            'reaction',
            {
                id: reactionUpdate.key.id || targetId,
                chat,
                targetId,
                emoji,
                fromMe,
            },
            eventId
        );
    }

    /**
     * Report connection lifecycle events.
     */
    function reportConnection(session, status, me = null, pairingRef = null, reason = null) {
        if (!SESSION_PATTERN.test(String(session))) return;

        const payload = { status };
        if (me && me.phone) {
            payload.me = { phone: me.phone, name: me.name || undefined };
        }
        if (pairingRef) payload.pairingRef = pairingRef;
        if (reason) payload.reason = String(reason).slice(0, 512);

        const eventId = deterministicEventId(session, 'connection', `${status}:${pairingRef || 'direct'}`);
        getClient()?.emit(session, 'connection', payload, eventId);
    }

    /**
     * Report a closed deal / hot lead from Davila.
     */
    function reportDealClosed(session, chat, deal = {}) {
        if (!SESSION_PATTERN.test(String(session))) return;
        if (!chat?.phone && !chat?.lid) return;

        const key = chat.phone || chat.lid;
        const eventId = deterministicEventId(session, 'deal.closed', `${key}:${deal.externalDealId || deal.pack || 'closed'}`);

        const payload = { chat };
        if (deal.pack) payload.pack = String(deal.pack).slice(0, 64);
        if (deal.value !== undefined && deal.value !== null) payload.value = Number(deal.value);
        if (deal.currency) payload.currency = String(deal.currency).slice(0, 10);
        if (deal.externalDealId) payload.externalDealId = String(deal.externalDealId).slice(0, 128);

        getClient()?.emit(session, 'deal.closed', payload, eventId);
    }

    /**
     * Report contact profile facts extracted by Davila.
     */
    function reportContactFacts(session, chat, facts = {}) {
        if (!SESSION_PATTERN.test(String(session))) return;
        if (!chat?.phone && !chat?.lid) return;

        const cleanFacts = {};
        if (facts.name && facts.name !== 'unknown') cleanFacts.name = String(facts.name).slice(0, 256);
        if (facts.businessType && facts.businessType !== 'unknown') cleanFacts.businessType = String(facts.businessType).slice(0, 256);
        if (facts.location && facts.location !== 'unknown') cleanFacts.location = String(facts.location).slice(0, 256);
        if (facts.interestedPack && facts.interestedPack !== 'unknown') cleanFacts.interestedPack = String(facts.interestedPack).slice(0, 64);

        if (Object.keys(cleanFacts).length === 0) return;

        const key = chat.phone || chat.lid;
        const factsHash = crypto.createHash('sha256').update(JSON.stringify(cleanFacts)).digest('hex').slice(0, 16);
        const eventId = deterministicEventId(session, 'contact.facts', `${key}:${factsHash}`);

        getClient()?.emit(session, 'contact.facts', { chat, facts: cleanFacts }, eventId);
    }

    /**
     * Report Tally order form submission event.
     */
    function reportTallySubmitted(session, chat) {
        if (!SESSION_PATTERN.test(String(session))) return;
        if (!chat?.phone && !chat?.lid) return;

        const key = chat.phone || chat.lid;
        const eventId = deterministicEventId(session, 'tally.submitted', key);
        getClient()?.emit(session, 'tally.submitted', { chat }, eventId);
    }

    /**
     * Report explicit contact opt-out (STOP).
     */
    function reportContactOptedOut(session, chat) {
        if (!SESSION_PATTERN.test(String(session))) return;
        if (!chat?.phone && !chat?.lid) return;

        const key = chat.phone || chat.lid;
        const eventId = deterministicEventId(session, 'contact.opted_out', key);
        getClient()?.emit(session, 'contact.opted_out', { chat }, eventId);
    }

    /**
     * Report Davila AI pause for a contact.
     */
    function reportAiPaused(session, chat, until) {
        if (!SESSION_PATTERN.test(String(session))) return;
        if (!chat?.phone && !chat?.lid) return;

        const key = chat.phone || chat.lid;
        const eventId = deterministicEventId(session, 'ai.paused', `${key}:${until ?? 'unpaused'}`);
        getClient()?.emit(session, 'ai.paused', { chat, until: until ?? null }, eventId);
    }

    /**
     * Attach socket event listeners to report all relevant WhatsApp events.
     */
    function attachSocket(sock, phoneNumber) {
        if (!sock || !sock.ev) return;
        if (!SESSION_PATTERN.test(String(phoneNumber))) return;

        // Monitor sendMessage to register Davila or phone messages
        if (!sock._reporterWrapped) {
            const originalSendMessage = sock.sendMessage.bind(sock);
            sock.sendMessage = async (jid, content, options = {}) => {
                const result = await originalSendMessage(jid, content, options);
                const msgId = result?.key?.id || options?.messageId;
                if (msgId) {
                    if (options._origin === 'davila') {
                        markDavilaSent(msgId);
                    }
                }
                return result;
            };
            sock._reporterWrapped = true;
        }

        // Messages upsert: incoming messages and outgoing echoes
        sock.ev.on('messages.upsert', (chatUpdate) => {
            try {
                const messages = chatUpdate?.messages || [];
                for (const mek of messages) {
                    reportMessageSafe(phoneNumber, mek);
                }
            } catch (err) {
                log.error('[wacrm-reporter] messages.upsert listener error:', err.message);
            }
        });

        // Messages update: delivery and read receipts
        sock.ev.on('messages.update', (updates) => {
            try {
                const list = Array.isArray(updates) ? updates : [updates];
                for (const u of list) {
                    reportStatusUpdate(phoneNumber, u);
                }
            } catch (err) {
                log.error('[wacrm-reporter] messages.update listener error:', err.message);
            }
        });

        // Messages reaction
        sock.ev.on('messages.reaction', (reactions) => {
            try {
                const list = Array.isArray(reactions) ? reactions : [reactions];
                for (const r of list) {
                    reportReaction(phoneNumber, r);
                }
            } catch (err) {
                log.error('[wacrm-reporter] messages.reaction listener error:', err.message);
            }
        });
    }

    return {
        attachSocket,
        markDavilaSent,
        isDavilaSent,
        processMessage,
        reportMessageSafe,
        reportStatusUpdate,
        reportReaction,
        reportConnection,
        reportDealClosed,
        reportContactFacts,
        reportTallySubmitted,
        reportContactOptedOut,
        reportAiPaused,
    };
}

let defaultReporter = null;

function getReporter() {
    if (!defaultReporter) {
        defaultReporter = createReporter();
    }
    return defaultReporter;
}

module.exports = {
    extractChatRef,
    inspectMessageContent,
    createReporter,
    getReporter,
};
