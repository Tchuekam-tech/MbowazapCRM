const { getAIResponse } = require('../lib/aiProvider');

async function luckyCommand(sock, chatId, message, q) {
    try {
        const query = (q || '').trim();
        if (!query) {
            return await sock.sendMessage(
                chatId,
                { text: "Please provide a query.\n\nExample:\n.ask What is AI?" },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, { react: { text: "⏳", key: message.key } });

        const aiResponse = await getAIResponse(query);
        const sender = message?.key?.participant || message?.key?.remoteJid;

        await sock.sendMessage(
            chatId,
            {
                text: `🤖 *Tchuek AI Response:*\n\n${aiResponse}`,
                ...(sender ? { mentions: [sender] } : {}),
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, { react: { text: "✅", key: message.key } });
    } catch (error) {
        console.error("luckyCommand error:", error?.message || error);
        await sock.sendMessage(
            chatId,
            { text: `❌ Failed to fetch Tchuek AI response.\n\nError: ${error?.message || 'Unknown error'}` },
            { quoted: message }
        );
        await sock.sendMessage(chatId, { react: { text: "❌", key: message.key } });
    }
}

module.exports = luckyCommand;
