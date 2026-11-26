const isAdmin = require('../lib/isAdmin');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

async function downloadMediaMessage(message, mediaType) {
    const stream = await downloadContentFromMessage(message, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    const dir = path.join(__dirname, '../temp');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${mediaType}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

async function hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message) {
    let tempFilePath = null;
    try {
        if (!chatId || !chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
            return;
        }
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, { text: 'Please make the bot an admin first.' }, { quoted: message });
            return;
        }

        if (!isSenderAdmin && !message?.key?.fromMe) {
            await sock.sendMessage(chatId, { text: 'Only admins can use the .hidetag command.' }, { quoted: message });
            return;
        }

        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants || [];
        const nonAdmins = participants.filter(p => !p.admin).map(p => p.id);

        if (replyMessage) {
            let content = {};
            if (replyMessage.imageMessage) {
                tempFilePath = await downloadMediaMessage(replyMessage.imageMessage, 'image');
                content = { image: { url: tempFilePath }, caption: messageText || replyMessage.imageMessage.caption || '', mentions: nonAdmins };
            } else if (replyMessage.videoMessage) {
                tempFilePath = await downloadMediaMessage(replyMessage.videoMessage, 'video');
                content = { video: { url: tempFilePath }, caption: messageText || replyMessage.videoMessage.caption || '', mentions: nonAdmins };
            } else if (replyMessage.conversation || replyMessage.extendedTextMessage) {
                content = { text: replyMessage.conversation || replyMessage.extendedTextMessage.text, mentions: nonAdmins };
            } else if (replyMessage.documentMessage) {
                tempFilePath = await downloadMediaMessage(replyMessage.documentMessage, 'document');
                content = { document: { url: tempFilePath }, fileName: replyMessage.documentMessage.fileName, caption: messageText || '', mentions: nonAdmins };
            }

            if (Object.keys(content).length > 0) {
                await sock.sendMessage(chatId, content);
            }
        } else {
            await sock.sendMessage(chatId, { text: messageText || 'Tagged members (excluding admins).', mentions: nonAdmins });
        }
    } catch (err) {
        console.error('Error in hideTagCommand:', err);
        await sock.sendMessage(chatId, { text: '❌ Failed to hidetag group members.' }, { quoted: message });
    } finally {
        try { if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
    }
}

module.exports = hideTagCommand;


