const axios = require('axios');

const FALLBACK_QUOTES = [
    '"The secret of getting ahead is getting started." — Mark Twain',
    '"Success usually comes to those who are too busy to be looking for it." — Henry David Thoreau',
    '"Quality is not an act, it is a habit." — Aristotle',
    '"Do something today that your future self will thank you for." — Sean Patrick Flanery',
    '"Small daily improvements over time lead to stunning results." — Robin Sharma',
    '"Action is the foundational key to all success." — Pablo Picasso',
    '"Simplicity is the ultimate sophistication." — Leonardo da Vinci',
    '"Your time is limited, so do not waste it living someone else’s life." — Steve Jobs',
];

module.exports = async function quoteCommand(sock, chatId, message) {
    try {
        let quoteMessage = null;
        try {
            const res = await axios.get('https://zenquotes.io/api/random', { timeout: 8000 });
            if (Array.isArray(res.data) && res.data[0]?.q) {
                quoteMessage = `"${res.data[0].q}"\n— *${res.data[0].a || 'Unknown'}*`;
            }
        } catch (_) {}

        if (!quoteMessage) {
            try {
                const res = await axios.get('https://dummyjson.com/quotes/random', { timeout: 8000 });
                if (res.data?.quote) {
                    quoteMessage = `"${res.data.quote}"\n— *${res.data.author || 'Unknown'}*`;
                }
            } catch (_) {}
        }

        if (!quoteMessage) {
            quoteMessage = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
        }

        await sock.sendMessage(chatId, { text: `💬 ${quoteMessage}` }, { quoted: message });
    } catch (error) {
        console.error('Error in quote command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get quote. Please try again later!' }, { quoted: message });
    }
};
