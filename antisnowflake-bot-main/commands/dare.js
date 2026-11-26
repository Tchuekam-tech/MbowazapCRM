const axios = require('axios');

const FALLBACK_DARES = [
    'Send a voice note singing the chorus of your favorite song!',
    'Change your WhatsApp status to "I love pineapple on pizza 🍍🍕" for 1 hour.',
    'Text the 3rd person in your recent chats a random compliment right now.',
    'Write your next 3 messages in this chat using ONLY emojis.',
    'Share the most recent photo in your gallery (keep it PG!).',
    'Send a 10-second voice note speaking in your best news anchor voice.',
    'Compliment every admin in this group in one creative sentence.',
    'Type a sentence with your eyes closed and send it without fixing typos!',
];

async function dareCommand(sock, chatId, message) {
    try {
        let dareMessage = null;
        try {
            const res = await axios.get('https://api.truthordarebot.xyz/v1/dare', { timeout: 8000 });
            if (res.data?.question) dareMessage = res.data.question;
        } catch (_) {}

        if (!dareMessage) {
            dareMessage = FALLBACK_DARES[Math.floor(Math.random() * FALLBACK_DARES.length)];
        }

        await sock.sendMessage(chatId, { text: `🔥 *Dare:* ${dareMessage}` }, { quoted: message });
    } catch (error) {
        console.error('Error in dare command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get dare. Please try again later!' }, { quoted: message });
    }
}

module.exports = { dareCommand };
