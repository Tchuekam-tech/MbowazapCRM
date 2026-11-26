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
 
╭═✦〔 🎨 *ɪᴍɢ/ꜱᴛᴋʀ ᴄᴍᴅꜱ* 〕✦═╮
│
│🔹 .blur <image>
│🔹 .simage <reply to sticker>
│🔹 .sticker <reply to image>
│🔹 .removebg
│🔹 .remini
│🔹 .crop <reply to image>
│🔹 .tgsticker <Link>
│🔹 .meme
│🔹 .take <packname> 
│🔹 .emojimix <emj1>+<emj2>
│🔹 .igs <insta link>
│🔹 .igsc <insta link>
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
