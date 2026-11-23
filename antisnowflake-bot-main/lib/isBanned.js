const fs = require('fs');
const path = require('path');

function isBanned(userId, bannedFilePath = path.join(__dirname, '../data/banned.json')) {
    try {
        if (!fs.existsSync(bannedFilePath)) {
            fs.mkdirSync(path.dirname(bannedFilePath), { recursive: true });
            fs.writeFileSync(bannedFilePath, '[]', 'utf8');
            return false;
        }
        const raw = fs.readFileSync(bannedFilePath, 'utf8').trim();
        if (!raw) return false;
        const bannedUsers = JSON.parse(raw);
        return Array.isArray(bannedUsers) && bannedUsers.includes(userId);
    } catch (error) {
        console.error('Error checking banned status:', error);
        return false;
    }
}

module.exports = { isBanned };
