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

    const payload = fs.existsSync(imagePath)
        ? { image: fs.readFileSync(imagePath), caption }
        : { text: caption };

    await sock.sendMessage(chatId, payload, { quoted: message });

    await sock.sendMessage(chatId, {
        react: { text: '📂', key: message.key }
    });
};
