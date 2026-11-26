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
 
╭═✦〔 👮‍♂️ *ᴀᴅᴍɪɴ ᴄᴍᴅꜱ* 〕✦═╮
│
│🔹 .ban @user
│🔹 .promote @user
│🔹 .demote @user
│🔹 .mute <minutes>
│🔹 .unmute
│🔹 .delete or .del
│🔹 .kick @user
│🔹 .warnings @user
│🔹 .warn @user
│🔹 .antilink
│🔹 .antibadword
│🔹 .clear
│🔹 .tag <message>
│🔹 .tagall
│🔹 .tagnotadmin
│🔹 .hidetag <message>
│🔹 .chatbot
│🔹 .resetlink
│🔹 .antitag <on/off>
│🔹 .welcome <on/off>
│🔹 .goodbye <on/off>
│🔹 .setgdesc <description>
│🔹 .setgname <new name>
│🔹 .setgpp (reply to image)
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
