const FLIRT_LINES = [
    "Are you Wi-Fi? Because I'm really feeling a connection.",
    "Do you have a map? I keep getting lost in your messages.",
    "If you were a vegetable, you'd be a cute-cumber.",
    "Are you made of copper and tellurium? Because you're Cu-Te.",
    "Is your name Google? Because you have everything I've been searching for.",
    "Even if there wasn't gravity on earth, I'd still fall for you.",
    "Are you a magician? Whenever I look at you, everyone else disappears.",
    "Do you believe in love at first text, or should I message you again?",
    "If beauty were time, you'd be an eternity.",
    "You must be tired because you've been running through my mind all day.",
];

async function flirtCommand(sock, chatId, message) {
    try {
        const flirtMessage = FLIRT_LINES[Math.floor(Math.random() * FLIRT_LINES.length)];
        await sock.sendMessage(chatId, { text: `💘 ${flirtMessage}` }, { quoted: message });
    } catch (error) {
        console.error('Error in flirt command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get flirt message. Please try again later!' }, { quoted: message });
    }
}

module.exports = { flirtCommand };
