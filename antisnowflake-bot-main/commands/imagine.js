const axios = require('axios');

async function imagineCommand(sock, chatId, message) {
    try {
        const prompt =
            message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            '';

        // Strip any command prefix (.imagine, .flux, etc.)
        const imagePrompt = prompt.replace(/^\.[a-z0-9_-]+\s*/i, '').trim();

        if (!imagePrompt) {
            await sock.sendMessage(chatId, {
                text: 'Please provide a prompt for image generation.\nExample: .imagine a beautiful sunset over mountains'
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, {
            text: '🎨 Generating your image... Please wait.'
        }, { quoted: message });

        const enhancedPrompt = enhancePrompt(imagePrompt);
        const endpoints = [
            `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?nologo=true`,
            `https://shizoapi.onrender.com/api/ai/imagine?apikey=shizo&query=${encodeURIComponent(enhancedPrompt)}`,
        ];

        let imageBuffer = null;
        for (const url of endpoints) {
            try {
                const response = await axios.get(url, {
                    responseType: 'arraybuffer',
                    timeout: 35000,
                });
                const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
                if (contentType.startsWith('image/') && response.data && response.data.byteLength > 1000) {
                    imageBuffer = Buffer.from(response.data);
                    break;
                }
            } catch (_) {}
        }

        if (!imageBuffer) {
            throw new Error('Image generation providers returned no valid image');
        }

        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: `🎨 Generated image for prompt: "${imagePrompt}"`
        }, { quoted: message });

    } catch (error) {
        console.error('Error in imagine command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to generate image. Please try again later.'
        }, { quoted: message });
    }
}

function enhancePrompt(prompt) {
    const qualityEnhancers = [
        'high quality',
        'detailed',
        'masterpiece',
        'best quality',
        'ultra realistic',
        '4k',
        'highly detailed',
        'professional photography',
        'cinematic lighting',
        'sharp focus'
    ];
    const numEnhancers = Math.floor(Math.random() * 2) + 3;
    const selectedEnhancers = [...qualityEnhancers]
        .sort(() => Math.random() - 0.5)
        .slice(0, numEnhancers);
    return `${prompt}, ${selectedEnhancers.join(', ')}`;
}

module.exports = imagineCommand;
