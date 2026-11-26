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
 
╭═✦〔 🔒 *ᴏᴡɴᴇʀ ᴄᴍᴅꜱ* 〕✦═╮
│
│🔹 .mode
│🔹 .block
│🔹 .unblock
│🔹 .blocked or .blocklist
│🔹 .autostatus
│🔹 .clearsession
│🔹 .antidelete
│🔹 .cleartmp
│🔹 .update
│🔹 .settings
│🔹 .setpp <reply to image>
│🔹 .autostatus <on/off>
│🔹 .autostatus react <on/off>
│🔹 .autotyping <on/off>
│🔹 .autorecording <on/off>
│🔹 .autoread <on/off>
│🔹 .anticall <on/off>
│🔹 .pmblocker <on/off/status>
│🔹 .pmblocker setmsg <text>
│🔹 .autostatus delay <time>
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
