const settings = require('../../settings');
const path = require('path');
const fs = require('fs');

const imagePath = path.join(__dirname, '../../assets/bot_image.jpg');

module.exports = async (sock, chatId, message) => {
    const caption = `
╭═✦〔 ✅ *ꜱᴇʟᴇᴄᴛᴇᴅ* ✅ 〕✦═╮
│🛠️ ᴘʀᴇғɪx  : [ ${settings.prefix} ]
│🚀 ᴠᴇʀsɪᴏɴ : *${settings.version}*
╰═══⭘════════════⚬═╯
 
╭═✦〔 🔤 *ᴛ.ᴍᴀᴋᴇʀ ᴄᴍᴅꜱ* 〕✦═╮
│
│🔹 .metallic <text>
│🔹 .ice <text>
│🔹 .snow <text>
│🔹 .impressive <text>
│🔹 .matrix <text>
│🔹 .light <text>
│🔹 .neon <text>
│🔹 .devil <text>
│🔹 .purple <text>
│🔹 .thunder <text>
│🔹 .leaves <text>
│🔹 .1917 <text>
│🔹 .arena <text>
│🔹 .hacker <text>
│🔹 .sand <text>
│🔹 .blackpink <text>
│🔹 .glitch <text>
│🔹 .fire <text>
│
╰═✪╾✦═✦═✦═✦═✦╼✪═╯
> ${settings.caption}
`;

    let imageBuffer = null;
    if (fs.existsSync(imagePath)) {
        imageBuffer = fs.readFileSync(imagePath);
    }

    await sock.sendMessage(chatId, {
        ...(imageBuffer ? { image: imageBuffer } : {}),
        caption,
        contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363420656466131@newsletter',
                newsletterName: 'Tchuek Bot',
                serverMessageId: -1
            }
        }
    }, { quoted: message });

    await sock.sendMessage(chatId, {
        react: { text: '📂', key: message.key }
    });
};
