const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const isOwnerOrSudo = require('../lib/isOwner');

async function setProfilePicture(sock, chatId, msg) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { 
                text: '❌ This command is only available for the owner!' 
            });
            return;
        }

        // Check if message is a reply
        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMessage) {
            await sock.sendMessage(chatId, { 
                text: '⚠️ Please reply to an image with the .setpp command!' 
            });
            return;
        }

        // Check if quoted message contains an image or sticker
        const isSticker = !quotedMessage.imageMessage && Boolean(quotedMessage.stickerMessage);
        const imageMessage = quotedMessage.imageMessage || quotedMessage.stickerMessage;
        if (!imageMessage) {
            await sock.sendMessage(chatId, { 
                text: '❌ The replied message must contain an image!' 
            });
            return;
        }

        // Create tmp directory if it doesn't exist
        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        let imagePath = null;
        try {
            // Download the media with proper Baileys media type
            const stream = await downloadContentFromMessage(imageMessage, isSticker ? 'sticker' : 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            imagePath = path.join(tmpDir, `profile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
            fs.writeFileSync(imagePath, buffer);

            await sock.updateProfilePicture(sock.user.id, { url: imagePath });
            await sock.sendMessage(chatId, { 
                text: '✅ Successfully updated bot profile picture!' 
            });
        } finally {
            try { if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (_) {}
        }

    } catch (error) {
        console.error('Error in setpp command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to update profile picture!' 
        });
    }
}

module.exports = setProfilePicture; 