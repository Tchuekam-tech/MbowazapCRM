async function shipCommand(sock, chatId, msg) {
    try {
        if (!chatId || !chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
            return;
        }

        const participants = await sock.groupMetadata(chatId);
        const ps = (participants?.participants || []).map(v => v.id).filter(Boolean);

        if (ps.length < 2) {
            await sock.sendMessage(chatId, {
                text: '❌ Need at least 2 members in this group to ship!'
            }, { quoted: msg });
            return;
        }

        const firstIdx = Math.floor(Math.random() * ps.length);
        let secondIdx = Math.floor(Math.random() * (ps.length - 1));
        if (secondIdx >= firstIdx) secondIdx += 1;

        const firstUser = ps[firstIdx];
        const secondUser = ps[secondIdx];
        const formatMention = id => '@' + id.split('@')[0];

        await sock.sendMessage(chatId, {
            text: `${formatMention(firstUser)} ❤️ ${formatMention(secondUser)}\nCongratulations 💖🍻`,
            mentions: [firstUser, secondUser]
        });

    } catch (error) {
        console.error('Error in ship command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to ship! Make sure this is a group.' });
    }
}

module.exports = shipCommand;
