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
 
╭═✦〔 🦠 *ʙᴜɢ ᴄᴍᴅꜱ* 〕✦═╮
│
│🔹 .crush  _premium_
│🔹 .kill    _premium_
│🔹 .218    _premium_
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
