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
