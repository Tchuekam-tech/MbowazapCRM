const { getAIResponse } = require('../lib/aiProvider');
const conversationHistory = new Map();

async function aiCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation ||
                     message.message?.extendedTextMessage?.text || '';

        const query = text.split(' ').slice(1).join(' ').trim();

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: '❌ Example: .ai what is quantum computing'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            react: { text: '⏳', key: message.key }
        });

        const settings = require('../settings');

        // Get or create history for this sender
        const senderId = message.key.participant || message.key.remoteJid;
        if (!conversationHistory.has(senderId)) {
            conversationHistory.set(senderId, []);
        }
        const history = conversationHistory.get(senderId);

        // Build system prompt with last 30 messages of history
        const systemPrompt = (settings.botPersonality || '')
            .replace('{HISTORY}', history.slice(-30).join(' | '))
            .replace('{MESSAGE}', query);

        const answer = await getAIResponse(query, systemPrompt);

        // Store this exchange in history (keep last 30 entries)
        history.push(`prospect: ${query}`);
        history.push(`rostand: ${answer}`);
        while (history.length > 60) history.splice(0, 2);
        conversationHistory.set(senderId, history);

        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });

        await sock.sendMessage(chatId, {
            text: answer
        }, { quoted: message });

    } catch (error) {
        console.error('AI Command Error:', error.message);
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