const settings = require('../settings');
const fs = require('fs');
const path = require('path');

const imagePath = path.join(__dirname, '../assets/bot_image.jpg');

function runtime(seconds) {
    seconds = Math.floor(seconds);
    const d = Math.floor(seconds / 86400);
    seconds %= 86400;
    const h = Math.floor(seconds / 3600);
    seconds %= 3600;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    let out = '';
    if (d > 0) out += `${d}d `;
    if (h > 0 || d > 0) out += `${h}h `;
    if (m > 0 || h > 0 || d > 0) out += `${m}m `;
    return `${out}${s}s`.trim();
}

function getCurrentMode() {
    try {
        if (global.botModeCache && typeof global.botModeCache.isPublic === 'boolean') {
            return global.botModeCache.isPublic ? '👥 Public' : '👤 Private';
        }
        const data = JSON.parse(fs.readFileSync('./data/messageCount.json', 'utf8'));
        return data.isPublic ? '👥 Public' : '👤 Private';
    } catch {
        return '👥 Public';
    }
}

const categoryMap = {
    '1': 'general.js',
    '2': 'admin.js',
    '3': 'owner.js',
    '4': 'imgstkr.js',
    '5': 'pics.js',
    '6': 'games.js',
    '7': 'ai.js',
    '8': 'fun.js',
    '9': 'tmaker.js',
    '10': 'download.js',
    '11': 'misc.js',
    '12': 'anime.js',
    '13': 'github.js',
    '14': 'bug.js',
};

// Track active interactive listener per chat so repeated .menu calls replace instead of stacking listeners
const activeMenuSessions = new Map();

async function helpCommand(sock, chatId, message) {
    const sender = message?.key?.participant || message?.key?.remoteJid || '';
    const displayName =
        message?.pushName || (sender ? sender.split('@')[0] : 'there') || 'there';

    const menuText =
        `╭═✦〔 *${settings.botName || 'Tchuek Bot'}* 〕✦═╮\n` +
        `│ 👤 ᴏᴡɴᴇʀ  : ${settings.botOwner || 'TCHUEK-TECH'}\n` +
        `│ 🌍 ᴍᴏᴅᴇ   : ${getCurrentMode()}\n` +
        `│ 🔄 ᴜᴘᴛɪᴍᴇ : ${runtime(process.uptime())}\n` +
        `│ 🌐 ᴛɪᴍᴇᴢᴏɴᴇ : ${settings.timezone || 'Africa/Douala'}\n` +
        `│ 🛠️ ᴘʀᴇғɪx  : [ ${settings.prefix || '.'} ]\n` +
        `│ 👑 ᴅᴇᴠ     : *TCHUEK-TECH*\n` +
        `│ 🚀 ᴠᴇʀsɪᴏɴ : *${settings.version || '1.0.0'}*\n` +
        `╰═══⭘═══════════⚬═╯\n\n` +
        `Hello 👋, *${displayName}*!\n\n` +
        `📚 *ᴍᴇɴᴜ ɴᴀᴠɪɢᴀᴛɪᴏɴ:*\n` +
        `> Reply to this menu with a number (1–14) to open that category:\n\n` +
        `╭═✦〔 🧾 *ᴄᴀᴛᴇɢᴏʀʏ ʟɪsᴛ* 〕✦═╮\n` +
        `│ 1. 🌐 *General Commands*\n` +
        `│ 2. 👮‍♂️ *Admin Commands*\n` +
        `│ 3. 🔒 *Owner Commands*\n` +
        `│ 4. 🎨 *Image & Sticker Commands*\n` +
        `│ 5. 🖼️ *Pics Commands*\n` +
        `│ 6. 🎮 *Game Commands*\n` +
        `│ 7. 🤖 *AI Commands*\n` +
        `│ 8. 🎯 *Fun Commands*\n` +
        `│ 9. 🔤 *Text Maker Commands*\n` +
        `│ 10. 📥 *Download Commands*\n` +
        `│ 11. 🧩 *Misc Commands*\n` +
        `│ 12. 🌸 *Anime Commands*\n` +
        `│ 13. 💻 *GitHub Commands*\n` +
        `│ 14. 🦠 *Special Commands*\n` +
        `╰═✪═════════════✪═╯\n\n` +
        `> _Type *.allmenu* or *.fullcmd* for the full command list._\n` +
        (settings.caption ? `> ${settings.caption}` : '');

    let sentMsg = null;
    try {
        if (fs.existsSync(imagePath)) {
            const imgBuf = fs.readFileSync(imagePath);
            sentMsg = await sock.sendMessage(
                chatId,
                { image: imgBuf, caption: menuText },
                { quoted: message },
            );
        } else {
            sentMsg = await sock.sendMessage(
                chatId,
                { text: menuText },
                { quoted: message },
            );
        }
    } catch (err) {
        console.error('Menu image send failed, falling back to text:', err.message);
        sentMsg = await sock.sendMessage(chatId, { text: menuText }, { quoted: message });
    }

    // Attach scoped reply listener if sock.ev supports on/off
    if (!sock?.ev || typeof sock.ev.on !== 'function' || typeof sock.ev.off !== 'function') {
        return;
    }

    const prev = activeMenuSessions.get(chatId);
    if (prev) {
        clearTimeout(prev.timer);
        try { sock.ev.off('messages.upsert', prev.listener); } catch (_) {}
        activeMenuSessions.delete(chatId);
    }

    const sentMenuId = sentMsg?.key?.id || null;
    const listener = async (upsert) => {
        try {
            const incoming = upsert?.messages?.[0];
            if (!incoming?.message) return;
            // Scope strictly to the chat where .menu was invoked
            if (incoming.key?.remoteJid !== chatId) return;

            const inner = incoming.message.ephemeralMessage?.message || incoming.message;
            const rawReply =
                inner.conversation ||
                inner.extendedTextMessage?.text ||
                '';
            const choice = rawReply.trim();
            if (!categoryMap[choice]) return;

            const quotedStanza = inner.extendedTextMessage?.contextInfo?.stanzaId;
            // Require either replying directly to the bot's menu message OR a plain 1-14 choice in this chat
            if (quotedStanza && sentMenuId && quotedStanza !== sentMenuId) return;

            const catFile = path.join(__dirname, 'menus', categoryMap[choice]);
            if (fs.existsSync(catFile)) {
                const handler = require(catFile);
                await sock.sendMessage(chatId, { react: { text: '✅', key: incoming.key } });
                await handler(sock, chatId, incoming);
            } else {
                await sock.sendMessage(
                    chatId,
                    { text: `❌ Commands for category ${choice} are not available yet.` },
                    { quoted: incoming },
                );
            }
        } catch (err) {
            console.error('Category select error:', err);
        }
    };

    sock.ev.on('messages.upsert', listener);
    const timer = setTimeout(() => {
        try { sock.ev.off('messages.upsert', listener); } catch (_) {}
        if (activeMenuSessions.get(chatId)?.listener === listener) {
            activeMenuSessions.delete(chatId);
        }
    }, 5 * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
    activeMenuSessions.set(chatId, { listener, timer });
}

module.exports = helpCommand;
