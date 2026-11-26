const fs = require('fs');
const path = require('path');

// Separate file from messageCount.json (which stores bot public/private mode) to avoid clobbering isPublic
const dataFilePath = path.join(__dirname, '..', 'data', 'memberActivity.json');

function loadMessageCounts() {
    try {
        if (fs.existsSync(dataFilePath)) {
            const raw = fs.readFileSync(dataFilePath, 'utf8').trim();
            if (raw) return JSON.parse(raw);
        }
    } catch (err) {
        console.error('Failed to load memberActivity.json:', err.message);
    }
    return {};
}

function saveMessageCounts(messageCounts) {
    try {
        const dir = path.dirname(dataFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dataFilePath, JSON.stringify(messageCounts, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to save memberActivity.json:', err.message);
    }
}

function incrementMessageCount(groupId, userId) {
    if (!groupId || !userId || !String(groupId).endsWith('@g.us')) return;
    const messageCounts = loadMessageCounts();
    if (!messageCounts[groupId] || typeof messageCounts[groupId] !== 'object') {
        messageCounts[groupId] = {};
    }
    messageCounts[groupId][userId] = (messageCounts[groupId][userId] || 0) + 1;
    saveMessageCounts(messageCounts);
}

async function topMembers(sock, chatId, isGroup) {
    try {
        if (!isGroup) {
            await sock.sendMessage(chatId, { text: 'This command is only available in group chats.' });
            return;
        }

        const messageCounts = loadMessageCounts();
        const groupCounts = messageCounts[chatId] || {};

        const sortedMembers = Object.entries(groupCounts)
            .filter(([, count]) => typeof count === 'number')
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);

        if (sortedMembers.length === 0) {
            await sock.sendMessage(chatId, { text: 'No message activity recorded yet.' });
            return;
        }

        let message = '🏆 *Top Members Based on Message Count:*\n\n';
        sortedMembers.forEach(([userId, count], index) => {
            message += `${index + 1}. @${userId.split('@')[0]} - ${count} messages\n`;
        });

        await sock.sendMessage(chatId, {
            text: message,
            mentions: sortedMembers.map(([userId]) => userId)
        });
    } catch (err) {
        console.error('Error in topMembers:', err);
        await sock.sendMessage(chatId, { text: '❌ Failed to load top members.' });
    }
}

module.exports = { incrementMessageCount, topMembers };
