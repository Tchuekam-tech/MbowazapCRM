const fs = require('fs');
const path = require('path');

const warningsFilePath = path.join(__dirname, '../data/warnings.json');

function loadWarnings() {
    try {
        const dir = path.dirname(warningsFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(warningsFilePath)) {
            fs.writeFileSync(warningsFilePath, JSON.stringify({}), 'utf8');
            return {};
        }
        const raw = fs.readFileSync(warningsFilePath, 'utf8').trim();
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.error('Failed to load warnings.json:', err.message);
        return {};
    }
}

async function warningsCommand(sock, chatId, mentionedJidList, message = null) {
    try {
        const warnings = loadWarnings();

        let userToCheck = Array.isArray(mentionedJidList) && mentionedJidList.length > 0
            ? mentionedJidList[0]
            : null;

        if (!userToCheck && message?.message?.extendedTextMessage?.contextInfo?.participant) {
            userToCheck = message.message.extendedTextMessage.contextInfo.participant;
        }

        if (!userToCheck) {
            await sock.sendMessage(chatId, {
                text: 'Please mention a user or reply to their message to check warnings.'
            }, message ? { quoted: message } : undefined);
            return;
        }

        const chatWarnings = warnings[chatId];
        const warningCount = (chatWarnings && typeof chatWarnings === 'object' && Number.isFinite(chatWarnings[userToCheck]))
            ? chatWarnings[userToCheck]
            : (typeof warnings[userToCheck] === 'number' ? warnings[userToCheck] : 0);

        await sock.sendMessage(chatId, {
            text: `⚠️ @${userToCheck.split('@')[0]} has *${warningCount}/3* warning(s) in this chat.`,
            mentions: [userToCheck],
        }, message ? { quoted: message } : undefined);
    } catch (err) {
        console.error('Error in warningsCommand:', err);
        await sock.sendMessage(chatId, { text: '❌ Failed to check warnings.' });
    }
}

module.exports = warningsCommand;
