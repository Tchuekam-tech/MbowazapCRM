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

async function tagCommand(sock, chatId, senderId, messageText, replyMessage, message) {
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
            const stickerPath = './assets/sticktag.webp';
            if (fs.existsSync(stickerPath)) {
                const stickerBuffer = fs.readFileSync(stickerPath);
                await sock.sendMessage(chatId, { sticker: stickerBuffer }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, { text: 'Only group admins can use .tag.' }, { quoted: message });
            }
            return;
        }

        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants || [];
        const mentionedJidList = participants.map(p => p.id);

        if (replyMessage) {
            let messageContent = {};

            if (replyMessage.imageMessage) {
                tempFilePath = await downloadMediaMessage(replyMessage.imageMessage, 'image');
                messageContent = {
                    image: { url: tempFilePath },
                    caption: messageText || replyMessage.imageMessage.caption || '',
                    mentions: mentionedJidList,
                };
            } else if (replyMessage.videoMessage) {
                tempFilePath = await downloadMediaMessage(replyMessage.videoMessage, 'video');
                messageContent = {
                    video: { url: tempFilePath },
                    caption: messageText || replyMessage.videoMessage.caption || '',
                    mentions: mentionedJidList
                };
            } else if (replyMessage.conversation || replyMessage.extendedTextMessage) {
                messageContent = {
                    text: replyMessage.conversation || replyMessage.extendedTextMessage.text,
                    mentions: mentionedJidList
                };
            } else if (replyMessage.documentMessage) {
                tempFilePath = await downloadMediaMessage(replyMessage.documentMessage, 'document');
                messageContent = {
                    document: { url: tempFilePath },
                    fileName: replyMessage.documentMessage.fileName,
                    caption: messageText || '',
                    mentions: mentionedJidList
                };
            }

            if (Object.keys(messageContent).length > 0) {
                await sock.sendMessage(chatId, messageContent);
            }
        } else {
            await sock.sendMessage(chatId, {
                text: messageText || "Tagged message",
                mentions: mentionedJidList
            });
        }
    } catch (err) {
        console.error('Error in tagCommand:', err);
        await sock.sendMessage(chatId, { text: '❌ Failed to tag group members.' }, { quoted: message });
    } finally {
        try { if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
    }
}

module.exports = tagCommand;
