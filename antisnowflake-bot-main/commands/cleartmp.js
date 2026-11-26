const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

const PRESERVED_DIRS = new Set(['pair_sessions']);

function clearDirectory(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            return { success: true, message: `${path.basename(dirPath)} already clean (0 files)`, count: 0 };
        }
        const files = fs.readdirSync(dirPath);
        let deletedCount = 0;
        for (const file of files) {
            if (PRESERVED_DIRS.has(file)) continue;
            try {
                const filePath = path.join(dirPath, file);
                const stat = fs.lstatSync(filePath);
                if (stat.isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(filePath);
                }
                deletedCount++;
            } catch (err) {
                console.error(`Error deleting file ${file}:`, err);
            }
        }
        return { success: true, message: `Cleared ${deletedCount} item(s) in ${path.basename(dirPath)}`, count: deletedCount };
    } catch (error) {
        console.error('Error in clearDirectory:', error);
        return { success: false, message: `Failed to clear files in ${path.basename(dirPath)}`, error: error.message };
    }
}

async function clearTmpDirectory() {
    const tmpDir = path.join(process.cwd(), 'tmp');
    const tempDir = path.join(process.cwd(), 'temp');
    const results = [clearDirectory(tmpDir), clearDirectory(tempDir)];
    const success = results.every(r => r.success);
    const totalDeleted = results.reduce((sum, r) => sum + (r.count || 0), 0);
    const message = results.map(r => r.message).join(' | ');
    return { success, message, count: totalDeleted };
}

async function clearTmpCommand(sock, chatId, msg) {
    try {
        const senderId = msg?.key?.participant || msg?.key?.remoteJid || '';
        const allowed = Boolean(msg?.key?.fromMe) || await isOwnerOrSudo(senderId, sock, chatId);
        if (!allowed) {
            await sock.sendMessage(chatId, {
                text: '❌ This command is only available for the owner or sudo!'
            }, { quoted: msg });
            return;
        }

        const result = await clearTmpDirectory();
        await sock.sendMessage(chatId, {
            text: result.success ? `✅ ${result.message}` : `❌ ${result.message}`
        }, { quoted: msg });
    } catch (error) {
        console.error('Error in cleartmp command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to clear temporary files!'
        }, { quoted: msg });
    }
}

// Schedule periodic cleanup without wiping files synchronously on require() and without keeping tests alive
const autoClearTimer = setInterval(() => {
    void clearTmpDirectory();
}, 6 * 60 * 60 * 1000);
if (typeof autoClearTimer.unref === 'function') autoClearTimer.unref();

module.exports = clearTmpCommand;
