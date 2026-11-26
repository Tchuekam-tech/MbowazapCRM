const gTTS = require('gtts');
const fs = require('fs');
const path = require('path');

async function ttsCommand(sock, chatId, text, message, language = 'en') {
    if (!text || !text.trim()) {
        await sock.sendMessage(chatId, { text: 'Please provide the text for TTS conversion.\nUsage: .tts <text>' }, { quoted: message });
        return;
    }

    const tmpDir = path.join(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `tts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`);

    try {
        const gtts = new gTTS(text.trim(), language);
        await new Promise((resolve, reject) => {
            gtts.save(filePath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        await sock.sendMessage(chatId, {
            audio: { url: filePath },
            mimetype: 'audio/mpeg',
        }, { quoted: message });
    } catch (err) {
        console.error('Error in ttsCommand:', err);
        await sock.sendMessage(chatId, { text: '❌ Error generating TTS audio.' }, { quoted: message });
    } finally {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (_) {}
    }
}

module.exports = ttsCommand;
