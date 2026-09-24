const { getAIResponse } = require('../lib/aiProvider');

async function llama3Command(sock, chatId, message, q) {
    try {
        if (!q) {
            return await sock.sendMessage(chatId, {
                text: "⚠️ Please provide a query.\n\n📌 Example:\n.llama3 Explain quantum computing"
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: "⏳", key: message.key } });

        const aiResponse = await getAIResponse(q);

        const AI_IMG = "https://files.catbox.moe/suqejh.jpg";

        await sock.sendMessage(
            chatId,
            {
                image: { url: AI_IMG },
                caption: `🤖 *Llama3 AI Response:*\n\n${aiResponse}`,
                contextInfo: { mentionedJid: [message.sender] },
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, { react: { text: "✅", key: message.key } });

    } catch (error) {
        console.error("llama3Command error:", error.message);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to fetch AI response.\n\n🛠 Error: ${error.message}`
        }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: "❌", key: message.key } });
    }
}

module.exports = llama3Command;
