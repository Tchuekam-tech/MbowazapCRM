const isAdmin = require('../lib/isAdmin');

async function unmuteCommand(sock, chatId, senderId, message = null) {
    try {
        if (!chatId || !chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, message ? { quoted: message } : undefined);
            return;
        }
        if (senderId && !message?.key?.fromMe) {
            const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
            if (!isBotAdmin) {
                await sock.sendMessage(chatId, { text: 'Please make the bot an admin first.' }, message ? { quoted: message } : undefined);
                return;
            }
            if (!isSenderAdmin) {
                await sock.sendMessage(chatId, { text: 'Only group admins can use the unmute command.' }, message ? { quoted: message } : undefined);
                return;
            }
        }
        await sock.groupSettingUpdate(chatId, 'not_announcement');
        await sock.sendMessage(chatId, { text: '🔊 The group has been unmuted.' }, message ? { quoted: message } : undefined);
    } catch (err) {
        console.error('Error in unmuteCommand:', err);
        await sock.sendMessage(chatId, { text: '❌ Failed to unmute the group.' }, message ? { quoted: message } : undefined);
    }
}

module.exports = unmuteCommand;
