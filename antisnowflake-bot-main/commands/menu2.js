const settings = require('../settings');
const fs = require('fs');
const path = require('path');

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

async function allMenuCommand(sock, chatId, message) {
    const sender = message?.key?.participant || message?.key?.remoteJid || '';
    const displayName =
        message?.pushName || (sender ? sender.split('@')[0] : 'there') || 'there';

    const fullText =
        `╭═✦〔 *${settings.botName || 'Tchuek Bot'}* 〕✦═╮\n` +
        `│ 👤 ᴏᴡɴᴇʀ   : ${settings.botOwner || 'TCHUEK-TECH'}\n` +
        `│ 🌍 ᴍᴏᴅᴇ    : ${getCurrentMode()}\n` +
        `│ 🔄 ᴜᴘᴛɪᴍᴇ  : ${runtime(process.uptime())}\n` +
        `│ 🌐 ᴛɪᴍᴇᴢᴏɴᴇ : ${settings.timezone || 'Africa/Douala'}\n` +
        `│ 🛠️ ᴘʀᴇғɪx   : [ ${settings.prefix || '.'} ]\n` +
        `│ 👑 ᴅᴇᴠ      : *TCHUEK-TECH*\n` +
        `│ 🚀 ᴠᴇʀsɪᴏɴ  : *${settings.version || '1.0.0'}*\n` +
        `╰═══⭘═══════════⚬═╯\n\n` +
        `Hello 👋, *${displayName}*!\n\n` +
        `╭══✦〔 *ᴀᴠᴀɪʟᴀʙʟᴇ ᴄᴍᴅꜱ* 〕✦══╮\n` +
        `│\n` +
        `│ 🌐 *General*: .menu .allmenu .help .ping .alive .dev .bible .biblelist .cinfo .check .epl .tts .owner .joke .define .quote .fact .weather .news .attp .lyrics .8ball .groupinfo .staff .vv .trt .ss .jid .url\n` +
        `│ 👮‍♂️ *Admin*: .ban .unban .promote .demote .mute .unmute .delete .kick .warnings .warn .antilink .antibadword .clear .tag .tagall .tagnotadmin .hidetag .chatbot .resetlink .antitag .welcome .goodbye .setgdesc .setgname .setgpp\n` +
        `│ 🔒 *Owner*: .mode .block .unblock .blocklist .autostatus .clearsession .antidelete .antiviewonce .cleartmp .update .settings .setpp .autotyping .autorecording .autoread .anticall .pmblocker .pair .sudo .aidiag\n` +
        `│ 🎨 *Stickers/Img*: .blur .simage .sticker .removebg .remini .crop .tg .meme .take .emojimix .igs\n` +
        `│ 🖼️ *Pics*: .pies .china .indonesia .japan .korea .hijab\n` +
        `│ 🎮 *Games*: .ttt .hangman .guess .trivia .answer .truth .dare .surrender\n` +
        `│ 🤖 *AI*: .ai .gpt .gemini .ask .llama3 .imagine .flux .sora\n` +
        `│ 🎯 *Fun*: .compliment .insult .flirt .hack .shayari .goodnight .roseday .character .waste .ship .simp .stupid\n` +
        `│ 🔤 *Text Maker*: .metallic .ice .snow .impressive .matrix .light .neon .devil .purple .thunder .leaves .1917 .arena .hacker .sand .blackpink .glitch .fire\n` +
        `│ 📥 *Downloads*: .apk .play .song .instagram .facebook .tiktok .spotify .video\n` +
        `│ 🧩 *Misc*: .heart .horny .circle .lgbt .lolice .simpcard .tonikawa .its-so-stupid .namecard .oogway .oogway2 .tweet .ytcomment .comrade .gay .glass .jail .passed .triggered\n` +
        `│ 🌸 *Anime*: .animu .nom .poke .cry .kiss .pat .hug .wink .facepalm .animuquote .loli\n` +
        `│ 💻 *GitHub*: .git .github .sc .repo\n` +
        `╰═🔸═🔹═🔸═🔹═🔸═🔹`;

    try {
        const imagePath = path.join(__dirname, '../assets/bot_image.jpg');
        if (fs.existsSync(imagePath)) {
            const buf = fs.readFileSync(imagePath);
            await sock.sendMessage(chatId, { image: buf, caption: fullText }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text: fullText }, { quoted: message });
        }
    } catch (err) {
        console.error('Error in allMenuCommand:', err);
        await sock.sendMessage(chatId, { text: fullText }, { quoted: message });
    }
}

module.exports = allMenuCommand;
