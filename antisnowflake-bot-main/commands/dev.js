async function devCommand(sock, chatId, message, q) {
  try {
    const senderJid = message.key?.participant || message.key?.remoteJid || message.sender || '';
    const pushname =
      message.pushName ||
      message.message?.pushName ||
      (senderJid ? senderJid.split('@')[0] : 'there');

    const name = pushname || 'there';

    const caption = `
╭─⌈ *Developer Info* ⌋─
│
│ 👋 Hello, *${name}*!
│
│ 🤖 Tchuek Bot is maintained by
│    *TCHUEK-TECH*.
│
│ 👨‍💻 *Dev Info:*
│ ──────────
│ 🧠 *Name:* TCHUEK-TECH
│ 📞 *Contact:* 237653683174
│
╰─────────

> Powered By TCHUEK-TECH
    `.trim();

    const contextInfo = {
      mentionedJid: senderJid ? [senderJid] : [],
      forwardingScore: 999,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: "120363420656466131@newsletter",
        newsletterName: "Tchuek Bot",
        serverMessageId: 143
      },
      externalAdReply: {
        title: "Tchuek Bot",
        body: "Created by TCHUEK-TECH",
        thumbnailUrl: "https://files.catbox.moe/suqejh.jpg",
        mediaType: 1,
        renderSmallerThumbnail: true,
        showAdAttribution: true
      }
    };

    await sock.sendMessage(
      chatId,
      {
        image: { url: "https://files.catbox.moe/suqejh.jpg" },
        caption,
        contextInfo
      },
      { quoted: message }
    );
  } catch (err) {
    console.error("devCommand error:", err);
    await sock.sendMessage(chatId, { text: `Error showing dev info: ${err.message}` }, { quoted: message });
  }
}

module.exports = devCommand;
