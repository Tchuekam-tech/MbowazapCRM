const { getAIResponse } = require('../lib/aiProvider');

const MAX_TRACKED_SENDERS = 500;
const conversationHistory = new Map();

function unwrapMessage(msgObj) {
    if (!msgObj) return null;
    if (msgObj.ephemeralMessage?.message) return unwrapMessage(msgObj.ephemeralMessage.message);
    if (msgObj.viewOnceMessage?.message) return unwrapMessage(msgObj.viewOnceMessage.message);
    if (msgObj.viewOnceMessageV2?.message) return unwrapMessage(msgObj.viewOnceMessageV2.message);
    return msgObj;
}

async function aiCommand(sock, chatId, message) {
    try {
        const inner = unwrapMessage(message.message);
        const text =
            inner?.conversation ||
            inner?.extendedTextMessage?.text ||
            inner?.imageMessage?.caption ||
            '';

        const query = text.trim().replace(/^\.[a-z0-9_-]+\s*/i, '').trim();

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: '❌ Example: .ai what is quantum computing'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            react: { text: '⏳', key: message.key }
        });

        const settings = require('../settings');
        const senderId = message.key.participant || message.key.remoteJid || chatId;

        if (!conversationHistory.has(senderId)) {
            if (conversationHistory.size >= MAX_TRACKED_SENDERS) {
                const oldestKey = conversationHistory.keys().next().value;
                if (oldestKey !== undefined) conversationHistory.delete(oldestKey);
            }
            conversationHistory.set(senderId, []);
        }
        const history = conversationHistory.get(senderId);

        const systemPrompt = (settings.botPersonality || '')
            .replace('{HISTORY}', history.slice(-30).join(' | '))
            .replace('{MESSAGE}', query);

        const answer = await getAIResponse(query, systemPrompt);

        history.push(`prospect: ${query}`);
        history.push(`assistant: ${answer}`);
        while (history.length > 60) history.splice(0, 2);
        conversationHistory.set(senderId, history);

        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });

        await sock.sendMessage(chatId, { text: answer }, { quoted: message });
    } catch (error) {
        console.error('AI Command Error:', error?.message || error);
        try {
            await sock.sendMessage(chatId, {
                react: { text: '❌', key: message.key }
            });
        } catch (_) {}
        await sock.sendMessage(chatId, {
            text: '❌ AI system is currently under heavy load. Please try again in a moment.'
        }, { quoted: message });
    }
}

module.exports = aiCommand;
