const axios = require('axios');

async function memeCommand(sock, chatId, message) {
    try {
        const res = await axios.get('https://meme-api.com/gimme', { timeout: 10000 });
        const meme = res.data;
        if (!meme?.url) {
            throw new Error('No meme URL returned');
        }

        const imgRes = await axios.get(meme.url, { responseType: 'arraybuffer', timeout: 15000 });
        const contentType = String(imgRes.headers?.['content-type'] || '').toLowerCase();
        if (!contentType.startsWith('image/')) {
            throw new Error('Meme URL did not return an image');
        }

        await sock.sendMessage(chatId, {
            image: Buffer.from(imgRes.data),
            caption: `🎭 *${meme.title || 'Random Meme'}*\n> r/${meme.subreddit || 'memes'}`
        }, { quoted: message });
    } catch (error) {
        console.error('Error in meme command:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to fetch meme right now. Please try again later.'
        }, { quoted: message });
    }
}

module.exports = memeCommand;
