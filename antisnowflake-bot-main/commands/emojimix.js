const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

function emojiToCodepoint(emoji) {
    return Array.from(emoji)
        .map((c) => c.codePointAt(0).toString(16))
        .filter((cp) => cp !== 'fe0f')
        .join('-');
}

async function emojimixCommand(sock, chatId, msg) {
    let tempFile = null;
    let outputFile = null;
    try {
        const text =
            msg.message?.conversation?.trim() ||
            msg.message?.extendedTextMessage?.text?.trim() ||
            '';

        const argStr = text.replace(/^\.(?:emojimix|emix)\s*/i, '').trim();
        if (!argStr || !argStr.includes('+')) {
            await sock.sendMessage(chatId, {
                text: '✳️ Separate two emojis with a *+* sign\n\n📌 Example:\n*.emojimix 😎+🥰*'
            }, { quoted: msg });
            return;
        }

        const [emoji1, emoji2] = argStr.split('+').map(e => e.trim());
        if (!emoji1 || !emoji2) {
            await sock.sendMessage(chatId, {
                text: '🎴 Example: *.emojimix 😎+🥰*'
            }, { quoted: msg });
            return;
        }

        let imageUrl = null;
        const tenorApiKey = process.env.TENOR_API_KEY || '';
        if (tenorApiKey) {
            try {
                const url = `https://tenor.googleapis.com/v2/featured?key=${encodeURIComponent(tenorApiKey)}&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(emoji1)}_${encodeURIComponent(emoji2)}`;
                const res = await axios.get(url, { timeout: 10000 });
                imageUrl = res.data?.results?.[0]?.media_formats?.png_transparent?.url || null;
            } catch (_) {}
        }

        // Keyless fallback via Google Emoji Kitchen CDN
        if (!imageUrl) {
            const c1 = emojiToCodepoint(emoji1);
            const c2 = emojiToCodepoint(emoji2);
            const candidates = [
                `https://emojik.vercel.app/s/${c1}_${c2}?size=512`,
                `https://emojik.vercel.app/s/${c2}_${c1}?size=512`,
            ];
            for (const cand of candidates) {
                try {
                    const probe = await axios.get(cand, { responseType: 'arraybuffer', timeout: 10000 });
                    const ct = String(probe.headers?.['content-type'] || '').toLowerCase();
                    if (ct.startsWith('image/') && probe.data?.byteLength > 200) {
                        imageUrl = cand;
                        break;
                    }
                } catch (_) {}
            }
        }

        if (!imageUrl) {
            await sock.sendMessage(chatId, {
                text: '❌ These emojis cannot be mixed! Try a different pair (e.g. `.emojimix 😎+🥰`).'
            }, { quoted: msg });
            return;
        }

        const tmpDir = path.join(process.cwd(), 'tmp');
        fs.mkdirSync(tmpDir, { recursive: true });
        const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        tempFile = path.join(tmpDir, `emix_${stamp}.png`).replace(/\\/g, '/');
        outputFile = path.join(tmpDir, `emix_${stamp}.webp`).replace(/\\/g, '/');

        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
        fs.writeFileSync(tempFile, Buffer.from(imageResponse.data));

        const ffmpegCommand = `ffmpeg -y -i "${tempFile}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" "${outputFile}"`;
        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, { timeout: 20000 }, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        if (!fs.existsSync(outputFile)) {
            throw new Error('Failed to create sticker file');
        }

        const stickerBuffer = fs.readFileSync(outputFile);
        await sock.sendMessage(chatId, { sticker: stickerBuffer }, { quoted: msg });
    } catch (error) {
        console.error('Error in emojimix command:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to mix emojis! Make sure you are using two valid emojis.\n\nExample: .emojimix 😎+🥰'
        }, { quoted: msg });
    } finally {
        try { if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
        try { if (outputFile && fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch (_) {}
    }
}

module.exports = emojimixCommand;
