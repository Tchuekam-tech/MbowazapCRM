const fs = require("fs");
const settings = require("../settings");

function getBotModeLabel() {
    try {
        if (global.botModeCache && typeof global.botModeCache.isPublic === "boolean") {
            return global.botModeCache.isPublic ? "Public" : "Private";
        }
        const data = JSON.parse(fs.readFileSync("./data/messageCount.json", "utf8"));
        return data.isPublic ? "Public" : "Private";
    } catch {
        return "Public";
    }
}

async function aliveCommand(sock, chatId, message) {
    try {
        const modeLabel = getBotModeLabel();
        const message1 = `╭══✦〔 🤖 *ᴀᴍ ᴀʟɪᴠᴇ..!* 〕✦═╮\n│\n` +
                       `│ 🚀 *ᴠᴇʀsɪᴏɴ*    : ${settings.version}\n` +
                       `│ ⛳ *ꜱᴛᴀᴛᴜꜱ*    : Online\n` +
                       `│ 🌍 *ᴍᴏᴅᴇ*      : ${modeLabel}\n│\n` +
                       `│ 🌟 *ꜰᴇᴀᴛᴜʀᴇꜱ*:\n` +
                       `│  ➟ ᴠɪᴇᴡ ᴏɴᴄᴇ\n` +
                       `│  ➟ ɢʀᴏᴜᴘ ᴍᴀɴᴀɢᴇᴍᴇɴᴛ\n` +
                       `│  ➟ ᴀɴᴛɪʟɪɴᴋ ᴘʀᴏᴛᴇᴄᴛɪᴏɴ\n` +
                       `│  ➟ ꜰᴜɴ ᴄᴏᴍᴍᴀɴᴅꜱ\n` +
                       `│  ➟ ᴀᴜᴛᴏꜱᴛᴀᴛᴜꜱ ᴠɪᴇᴡ\n` +
                       `│  ➟ ᴀᴜᴛᴏꜱᴛᴀᴛᴜꜱ ʀᴇᴀᴄᴛ \n` +
                       `│  ➟ ᴀɴᴅ ᴍᴏʀᴇ!\n` +
                       `│☄️ᴛʜᴀɴᴋꜱ ꜰᴏʀ ᴄʜᴇᴄᴋɪɴɢ 🙂\n│\n` +
                       `│ ᴛʏᴘᴇ *.menu* ꜰᴏʀ ꜰᴜʟʟ ᴄᴏᴍᴍᴀɴᴅ ʟɪꜱᴛ\n` +
                       `╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯`;

        await sock.sendMessage(chatId, {
            text: message1
        }, { quoted: message });
    } catch (error) {
        console.error('Error in alive command:', error);
        await sock.sendMessage(chatId, { text: 'Bot is alive and running!' }, { quoted: message });
    }
}

module.exports = aliveCommand;