// menus/sub1.js
const settings = require('../../settings'); // ✅ go up two levels
const path = require('path');
const fs = require('fs');

// Bot image path
const imagePath = path.join(__dirname, '../../assets/bot_image.jpg');

module.exports = async (sock, chatId, message) => {
    const caption = `
╭═✦〔 ✅ *ꜱᴇʟᴇᴄᴛᴇᴅ* ✅ 〕✦═╮
│🛠️ ᴘʀᴇғɪx  : [ ${settings.prefix} ]
│🚀 ᴠᴇʀsɪᴏɴ : *${settings.version}*
╰═══⭘════════════⚬═╯
 
╭═✦〔 🌐 *ɢᴇɴᴇʀᴀʟ ᴄᴍᴅ* 〕✦═╮
│
│🔹 .menu or .allmenu
│🔹 .ping
│🔹 .alive
│🔹 .dev
│🔹 .bible <verse>
│🔹 .biblelist
│🔹 .cinfo <country name >
│🔹 .check
│🔹 .epl
│🔹 .tts <text>
│🔹 .owner
│🔹 .joke
│🔹 .define <word>
│🔹 .quote
│🔹 .fact
│🔹 .weather <city>
│🔹 .news
│🔹 .attp <text>
│🔹 .lyrics <song_title>
│🔹 .8ball <question>
│🔹 .groupinfo
│🔹 .staff or .admins 
│🔹 .vv or .ok or .wow
│🔹 .trt <text> <lang>
│🔹 .ss <link>
│🔹 .jid
│🔹 .url
│
╰═✪╾✦═✦═✦═✦═✦╼✪═╯

> ${settings.caption}
`;

    // Build payload
    let msgPayload = {
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
    };

    // Attach image if available
    if (fs.existsSync(imagePath)) {
        msgPayload.image = fs.readFileSync(imagePath);
    }

    // Send menu
    await sock.sendMessage(chatId, msgPayload, { quoted: message });

    // React to confirm
    await sock.sendMessage(chatId, {
        react: { text: '📂', key: message.key }
    });
};
