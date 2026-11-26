const { getAIResponse } = require('../lib/aiProvider');

async function llama3Command(sock, chatId, message, q) {
    try {
        const query = (q || '').trim();
        if (!query) {
            return await sock.sendMessage(chatId, {
                text: "⚠️ Please provide a query.\n\n📌 Example:\n.llama3 Explain quantum computing"
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: "⏳", key: message.key } });

        const aiResponse = await getAIResponse(query);
        const sender = message?.key?.participant || message?.key?.remoteJid;

        await sock.sendMessage(
            chatId,
            {
                text: `🤖 *Llama3 AI Response:*\n\n${aiResponse}`,
                ...(sender ? { mentions: [sender] } : {}),
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, { react: { text: "✅", key: message.key } });

    } catch (error) {
        console.error("llama3Command error:", error?.message || error);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to fetch AI response.\n\n🛠 Error: ${error?.message || 'Unknown error'}`
        }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: "❌", key: message.key } });
    }
}

module.exports = llama3Command;
