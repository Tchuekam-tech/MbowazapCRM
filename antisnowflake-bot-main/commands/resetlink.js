const isAdmin = require('../lib/isAdmin');

async function resetlinkCommand(sock, chatId, senderId, message = null) {
    try {
        if (!chatId || !chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups!' }, message ? { quoted: message } : undefined);
            return;
        }

        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

        if (!isSenderAdmin && !message?.key?.fromMe) {
            await sock.sendMessage(chatId, { text: '❌ Only admins can use this command!' }, message ? { quoted: message } : undefined);
            return;
        }

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, { text: '❌ Bot must be admin to reset group link!' }, message ? { quoted: message } : undefined);
            return;
        }

        const newCode = await sock.groupRevokeInvite(chatId);

        await sock.sendMessage(chatId, {
            text: `╭══✦〔 *ɢʀᴏᴜᴘ ʀᴇꜱᴇᴛ ʟɪɴᴋ* 〕✦═╮\n│\n│ ✅ Group link has been successfully reset\n│\n│ 📌 New link:\n│ https://chat.whatsapp.com/${newCode}\n│\n╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯`
        }, message ? { quoted: message } : undefined);

    } catch (error) {
        console.error('Error in resetlink command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to reset group link!' }, message ? { quoted: message } : undefined);
    }
}

module.exports = resetlinkCommand;
