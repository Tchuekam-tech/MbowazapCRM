const axios = require("axios");

async function l\u0075ckyCommand(sock, chatId, message, q) {
  try {
    if (!q) {
      return await sock.sendMessage(
        chatId,
        { text: "Please provide a query.\n\nExample:\n.ask What is AI?" },
        { quoted: message }
      );
    }

    await sock.sendMessage(chatId, { react: { text: "⏳", key: message.key } });

    const apiUrl = `https://api.dreaded.site/api/chatgpt?text=${encodeURIComponent(q)}`;
    const response = await axios.get(apiUrl, { headers: { "User-Agent": "Mozilla/5.0" } });

    const aiResponse = response.data?.result?.prompt || "No response received from Tchuek AI.";
    const aiImage = "https://files.catbox.moe/suqejh.jpg";

    await sock.sendMessage(
      chatId,
      {
        image: { url: aiImage },
        caption: `🤖 *Tchuek AI Response:*\n\n${aiResponse}`,
        contextInfo: { mentionedJid: [message.sender] },
      },
      { quoted: message }
    );

    await sock.sendMessage(chatId, { react: { text: "✅", key: message.key } });
  } catch (error) {
    console.error("aiCommand error:", error);

    await sock.sendMessage(
      chatId,
      { text: `Failed to fetch Tchuek AI response.\n\nError: ${error.message}` },
      { quoted: message }
    );

    await sock.sendMessage(chatId, { react: { text: "❌", key: message.key } });
  }
}

module.exports = l\u0075ckyCommand;
