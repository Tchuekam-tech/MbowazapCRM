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
 
╭═✦〔 🎯 *ꜰᴜɴ ᴄᴍᴅꜱ* 〕✦═╮
│
│🔹 .compliment @user
│🔹 .insult @user
│🔹 .flirt 
│🔹 .hack
│🔹 .shayari
│🔹 .goodnight
│🔹 .roseday
│🔹 .character @user
│🔹 .wasted @user
│🔹 .ship @user
│🔹 .simp @user
│🔹 .stupid @user [text]
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
