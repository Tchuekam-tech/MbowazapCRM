const fetch = require('node-fetch');

async function handleTranslateCommand(sock, chatId, message, match) {
    try {
        try {
            await sock.presenceSubscribe(chatId);
            await sock.sendPresenceUpdate('composing', chatId);
        } catch (_) {}

        let textToTranslate = '';
        let lang = '';

        const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMessage) {
            textToTranslate =
                quotedMessage.conversation ||
                quotedMessage.extendedTextMessage?.text ||
                quotedMessage.imageMessage?.caption ||
                quotedMessage.videoMessage?.caption ||
                '';
            lang = (match || '').trim().split(/\s+/)[0] || '';
            if (!lang) {
                return sock.sendMessage(chatId, {
                    text: '❌ Please specify a target language code when replying.\nExample: *.trt fr* or *.translate en*'
                }, { quoted: message });
            }
        } else {
            const args = (match || '').trim().split(/\s+/).filter(Boolean);
            if (args.length < 2) {
                return sock.sendMessage(chatId, {
                    text: `╭══✦〔 *ᴛʀᴀɴꜱʟᴀᴛᴏʀ* 〕✦═╮\n│\n│ Usage:\n│ 1. Reply to a message with: *.translate <lang>* or *.trt <lang>*\n│ 2. Or type: *.translate <text> <lang>* or *.trt <text> <lang>*\n│\n│ Example: *.translate hello world fr*\n│\n│ Codes: en, fr, es, de, it, pt, ru, ja, ko, zh, ar, hi\n╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯`,
                }, { quoted: message });
            }
            lang = args.pop();
            textToTranslate = args.join(' ');
        }

        if (!textToTranslate) {
            return sock.sendMessage(chatId, {
                text: '❌ No text found to translate. Please provide text or reply to a message.',
            }, { quoted: message });
        }

        let translatedText = null;

        // API 1: Google Translate (join ALL sentence segments, not just data[0][0][0])
        try {
            const response = await fetch(
                `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(textToTranslate)}`,
                { timeout: 10000 }
            );
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data?.[0])) {
                    const joined = data[0]
                        .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
                        .join('')
                        .trim();
                    if (joined) translatedText = joined;
                }
            }
        } catch (_) {}

        // API 2: MyMemory fallback
        if (!translatedText) {
            try {
                const response = await fetch(
                    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=auto|${encodeURIComponent(lang)}`,
                    { timeout: 10000 }
                );
                if (response.ok) {
                    const data = await response.json();
                    if (data?.responseData?.translatedText) {
                        translatedText = data.responseData.translatedText;
                    }
                }
            } catch (_) {}
        }

        if (!translatedText) {
            throw new Error('All translation APIs failed');
        }

        await sock.sendMessage(chatId, { text: translatedText }, { quoted: message });
    } catch (error) {
        console.error('❌ Error in translate command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to translate text. Please try again later.\n\nUsage:\n1. Reply to a message with: .translate <lang> or .trt <lang>\n2. Or type: .translate <text> <lang> or .trt <text> <lang>',
        }, { quoted: message });
    }
}

module.exports = { handleTranslateCommand };
