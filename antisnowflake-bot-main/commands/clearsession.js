const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

async function clearSessionCommand(sock, chatId, msg) {
    try {
        const senderId = msg?.key?.participant || msg?.key?.remoteJid || '';
        const allowed = Boolean(msg?.key?.fromMe) || await isOwnerOrSudo(senderId, sock, chatId);
        if (!allowed) {
            await sock.sendMessage(chatId, {
                text: '❌ This command can only be used by the owner or sudo!'
            }, { quoted: msg });
            return;
        }

        const botDigits = String(sock?.user?.id || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        const multiTenantDir = botDigits ? path.join(__dirname, '../data/sessions', botDigits) : null;
        const legacyDir = path.join(__dirname, '../session');
        const sessionDir = (multiTenantDir && fs.existsSync(multiTenantDir)) ? multiTenantDir : legacyDir;

        if (!fs.existsSync(sessionDir)) {
            await sock.sendMessage(chatId, {
                text: '❌ Session directory not found!'
            }, { quoted: msg });
            return;
        }

        let filesCleared = 0;
        let errors = 0;
        const errorDetails = [];

        await sock.sendMessage(chatId, {
            text: '🔍 Optimizing session files for better performance...'
        }, { quoted: msg });

        const files = fs.readdirSync(sessionDir);
        let appStateSyncCount = 0;
        let preKeyCount = 0;

        // Preserve critical Signal identity & encryption session files so chats don't break
        const shouldPreserve = (file) =>
            file === 'creds.json' ||
            file === 'creds.json.bak' ||
            file.startsWith('session-') ||
            file.startsWith('sender-key-');

        for (const file of files) {
            if (shouldPreserve(file)) continue;
            const filePath = path.join(sessionDir, file);
            try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile()) continue;
                if (file.startsWith('app-state-sync-')) appStateSyncCount++;
                if (file.startsWith('pre-key-')) preKeyCount++;
                fs.unlinkSync(filePath);
                filesCleared++;
            } catch (error) {
                errors++;
                errorDetails.push(`Failed to delete ${file}: ${error.message}`);
            }
        }

        const summary =
            `╭══✦〔 *ᴄʟᴇᴀʀᴇᴅ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ* 〕✦═╮\n` +
            `│ 📊 *ꜱᴛᴀᴛɪꜱᴛɪᴄꜱ:*\n` +
            `│ • Total files cleared: *${filesCleared}*\n` +
            `│ • App state sync files: *${appStateSyncCount}*\n` +
            `│ • Pre-key files: *${preKeyCount}*\n` +
            `│ • Active credentials & Signal sessions preserved ✅\n` +
            `╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯` +
            (errors > 0 ? `\n⚠️ Errors encountered: ${errors}\n${errorDetails.join('\n')}` : '');

        await sock.sendMessage(chatId, { text: summary }, { quoted: msg });
    } catch (error) {
        console.error('Error in clearsession command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to clear session files!'
        }, { quoted: msg });
    }
}

module.exports = clearSessionCommand;
