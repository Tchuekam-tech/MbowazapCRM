const GOODNIGHT_MESSAGES = [
    "🌙 Good night! May your dreams be peaceful and tomorrow bring fresh opportunities. ✨",
    "🌟 Time to rest your mind and recharge your energy. Sleep tight and wake up unstoppable!",
    "🌌 Wishing you a calm night, sweet dreams, and a bright morning ahead. Good night! 💫",
    "🌠 Let go of today's worries — tomorrow is a brand new page. Sweet dreams! 🌙",
    "✨ Stars can't shine without darkness. Rest well tonight and shine bright tomorrow!",
    "💤 Sending warm goodnight wishes your way. Sleep peacefully! 🌙",
];

async function goodnightCommand(sock, chatId, message) {
    try {
        const goodnightMessage = GOODNIGHT_MESSAGES[Math.floor(Math.random() * GOODNIGHT_MESSAGES.length)];
        await sock.sendMessage(chatId, { text: goodnightMessage }, { quoted: message });
    } catch (error) {
        console.error('Error in goodnight command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get goodnight message. Please try again later!' }, { quoted: message });
    }
}

module.exports = { goodnightCommand };
