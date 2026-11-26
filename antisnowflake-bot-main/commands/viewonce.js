const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

function unwrapViewOnce(msgObj) {
    if (!msgObj || typeof msgObj !== 'object') return null;
    if (msgObj.ephemeralMessage?.message) return unwrapViewOnce(msgObj.ephemeralMessage.message);
    if (msgObj.viewOnceMessage?.message) return msgObj.viewOnceMessage.message;
    if (msgObj.viewOnceMessageV2?.message) return msgObj.viewOnceMessageV2.message;
    if (msgObj.viewOnceMessageV2Extension?.message) return msgObj.viewOnceMessageV2Extension.message;
    if (msgObj.imageMessage?.viewOnce === true || msgObj.videoMessage?.viewOnce === true) return msgObj;
    return null;
}

async function viewOnceCommand(sock, chatId, message) {
    let tempFile = null;
    try {
        const quotedRaw =
            message.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
            message.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        const target = unwrapViewOnce(quotedRaw) || unwrapViewOnce(message.message);

        if (!target) {
            await sock.sendMessage(chatId, {
                text: '❌ Please reply to a view-once image or video!'
            }, { quoted: message });
            return;
        }

        const imageMsg = target.imageMessage || null;
        const videoMsg = target.videoMessage || null;

        if (imageMsg) {
            const stream = await downloadContentFromMessage(imageMsg, 'image');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            const caption = imageMsg.caption || '';

            await sock.sendMessage(chatId, {
                image: buffer,
                caption: `👀 *View-Once Recovered*\n*Type:* Image 📸${caption ? `\n*Caption:* ${caption}` : ''}`
            }, { quoted: message });
            return;
        }

        if (videoMsg) {
            const tempDir = path.join(__dirname, '../tmp');
            fs.mkdirSync(tempDir, { recursive: true });
            tempFile = path.join(tempDir, `vv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`);

            const stream = await downloadContentFromMessage(videoMsg, 'video');
            const writeStream = fs.createWriteStream(tempFile);
            const done = new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });
            for await (const chunk of stream) writeStream.write(chunk);
            writeStream.end();
            await done;

            const caption = videoMsg.caption || '';
            await sock.sendMessage(chatId, {
                video: fs.readFileSync(tempFile),
                caption: `👀 *View-Once Recovered*\n*Type:* Video 📹${caption ? `\n*Caption:* ${caption}` : ''}`
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, {
            text: '❌ Unsupported view-once media type. Reply to a view-once image or video.'
        }, { quoted: message });
    } catch (error) {
        console.error('❌ Error in viewonce command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to process view-once message: ' + (error?.message || 'Unknown error')
        }, { quoted: message });
    } finally {
        try {
            if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (_) {}
    }
}

module.exports = viewOnceCommand;
