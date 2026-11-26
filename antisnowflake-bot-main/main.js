// ANTI-BAN v3 — Production Command Router
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
require('./config.js');
const { isBanned } = require('./lib/isBanned');
const { getBlockedCommandInfo, buildComplianceMessage } = require('./lib/policyGuard');
const { isSudo } = require('./lib/index');
const isAdmin = require('./lib/isAdmin');
const bridgeState = require('./lib/bridge/state');

// Helper to recursively unwrap standard Baileys wrappers
function getInnerMessage(messageContent) {
    if (!messageContent) return null;
    if (messageContent.ephemeralMessage?.message) {
        return getInnerMessage(messageContent.ephemeralMessage.message);
    }
    if (messageContent.viewOnceMessage?.message) {
        return getInnerMessage(messageContent.viewOnceMessage.message);
    }
    if (messageContent.viewOnceMessageV2?.message) {
        return getInnerMessage(messageContent.viewOnceMessageV2.message);
    }
    if (messageContent.viewOnceMessageV2Extension?.message) {
        return getInnerMessage(messageContent.viewOnceMessageV2Extension.message);
    }
    if (messageContent.documentWithCaptionMessage?.message) {
        return getInnerMessage(messageContent.documentWithCaptionMessage.message);
    }
    return messageContent;
}

// Anti-Ban State Trackers
const processedIds = new Set();
const PROCESSED_IDS_FILE = './data/processedIds.json';
try {
    if (fs.existsSync(PROCESSED_IDS_FILE)) {
        const saved = JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf8'));
        if (Array.isArray(saved)) saved.forEach(id => processedIds.add(id));
        console.log(`[Anti-Ban] Loaded ${processedIds.size} persisted message IDs`);
    }
} catch (e) {
    console.error('[Anti-Ban] Failed to load persisted IDs:', e.message);
}

const processedIdsTimer = setInterval(() => {
    try {
        const arr = Array.from(processedIds).slice(-2000);
        fs.mkdirSync(path.dirname(PROCESSED_IDS_FILE), { recursive: true });
        fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(arr), 'utf8');
    } catch (_) { }
}, 300_000);
if (typeof processedIdsTimer.unref === 'function') processedIdsTimer.unref();

const activeFeatures = new Map();

// Command imports
const { autotypingCommand, handleAutotypingForMessage, showTypingAfterCommand } = require('./commands/autotyping');
const { autorecordingCommand, handleAutorecordingForMessage, showRecordingAfterCommand } = require('./commands/autorecording');
const { autoreadCommand, handleAutoread } = require('./commands/autoread');

const tagAllCommand = require('./commands/tagall');
const menu2Command = require('./commands/menu2');
const apkCommand = require('./commands/apk');
const killCommand = require('./commands/kill');
const luckyCommand = require('./commands/lucky');
const llama3Command = require('./commands/llama3');
const readBlocklistCommand = require('./commands/readBlocklist');
const defineCommand = require('./commands/define');
const bibleCommand = require('./commands/bible');
const bibleListCommand = require('./commands/bibleList');
const countryinfoCommand = require('./commands/countryinfo');
const checkCommand = require('./commands/check');
const pairCommand = require('./commands/pair');
const eplCommand = require('./commands/epl');
const devCommand = require('./commands/dev');
const hackCommand = require('./commands/hack');
const newsletterCommand = require('./commands/newsletter');
const blockUnblockCommand = require('./commands/blockUnblock');
const menuCommand = require('./commands/menu');
const banCommand = require('./commands/ban');
const { promoteCommand, handlePromotionEvent } = require('./commands/promote');
const { demoteCommand, handleDemotionEvent } = require('./commands/demote');
const muteCommand = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const stickerCommand = require('./commands/sticker');
const warnCommand = require('./commands/warn');
const warningsCommand = require('./commands/warnings');
const ttsCommand = require('./commands/tts');
const { tictactoeCommand, handleTicTacToeMove } = require('./commands/tictactoe');
const { incrementMessageCount, topMembers } = require('./commands/topmembers');
const ownerCommand = require('./commands/owner');
const deleteCommand = require('./commands/delete');
const { handleAntilinkCommand } = require('./commands/antilink');
const { handleAntitagCommand, handleTagDetection } = require('./commands/antitag');
const { Antilink } = require('./lib/antilink');
const memeCommand = require('./commands/meme');
const tagCommand = require('./commands/tag');
const tagNotAdminCommand = require('./commands/tagnotadmin');
const hideTagCommand = require('./commands/hidetag');
const jokeCommand = require('./commands/joke');
const quoteCommand = require('./commands/quote');
const factCommand = require('./commands/fact');
const weatherCommand = require('./commands/weather');
const newsCommand = require('./commands/news');
const kickCommand = require('./commands/kick');
const simageCommand = require('./commands/simage');
const attpCommand = require('./commands/attp');
const { startHangman, guessLetter } = require('./commands/hangman');
const { startTrivia, answerTrivia } = require('./commands/trivia');
const { complimentCommand } = require('./commands/compliment');
const { insultCommand } = require('./commands/insult');
const { eightBallCommand } = require('./commands/eightball');
const { lyricsCommand } = require('./commands/lyrics');
const { dareCommand } = require('./commands/dare');
const { truthCommand } = require('./commands/truth');
const { clearCommand } = require('./commands/clear');
const pingCommand = require('./commands/ping');
const aliveCommand = require('./commands/alive');
const blurCommand = require('./commands/img-blur');
const { welcomeCommand, handleJoinEvent } = require('./commands/welcome');
const { goodbyeCommand, handleLeaveEvent } = require('./commands/goodbye');
const githubCommand = require('./commands/github');
const { handleBadwordDetection } = require('./lib/antibadword');
const antibadwordCommand = require('./commands/antibadword');
const { handleChatbotCommand, handleChatbotResponse } = require('./commands/chatbot');
const takeCommand = require('./commands/take');
const { flirtCommand } = require('./commands/flirt');
const characterCommand = require('./commands/character');
const wastedCommand = require('./commands/wasted');
const shipCommand = require('./commands/ship');
const groupInfoCommand = require('./commands/groupinfo');
const resetlinkCommand = require('./commands/resetlink');
const staffCommand = require('./commands/staff');
const unbanCommand = require('./commands/unban');
const emojimixCommand = require('./commands/emojimix');
const viewOnceCommand = require('./commands/viewonce');
const clearSessionCommand = require('./commands/clearsession');
const { autoStatusCommand, handleStatusUpdate } = require('./commands/autostatus');
const { simpCommand } = require('./commands/simp');
const { stupidCommand } = require('./commands/stupid');
const stickerTelegramCommand = require('./commands/stickertelegram');
const textmakerCommand = require('./commands/textmaker');
const { handleAntideleteCommand, handleAntiViewOnceCommand, handleMessageRevocation, storeMessage } = require('./commands/antidelete');
const clearTmpCommand = require('./commands/cleartmp');
const setProfilePicture = require('./commands/setpp');
const { setGroupDescription, setGroupName, setGroupPhoto } = require('./commands/groupmanage');
const instagramCommand = require('./commands/instagram');
const facebookCommand = require('./commands/facebook');
const spotifyCommand = require('./commands/spotify');
const playCommand = require('./commands/play');
const tiktokCommand = require('./commands/tiktok');
const songCommand = require('./commands/song');
const aiCommand = require('./commands/ai');
const aidiagCommand = require('./commands/aidiag');
const handleCampaignCommand = require('./commands/campaign');
const urlCommand = require('./commands/url');
const { handleTranslateCommand } = require('./commands/translate');
const { handleSsCommand } = require('./commands/ss');
const { addCommandReaction, handleAreactCommand } = require('./lib/reactions');
const { goodnightCommand } = require('./commands/goodnight');
const { shayariCommand } = require('./commands/shayari');
const { rosedayCommand } = require('./commands/roseday');
const imagineCommand = require('./commands/imagine');
const videoCommand = require('./commands/video');
const sudoCommand = require('./commands/sudo');
const { miscCommand, handleHeart } = require('./commands/misc');
const { animeCommand } = require('./commands/anime');
const { piesCommand, piesAlias } = require('./commands/pies');
const stickercropCommand = require('./commands/stickercrop');
const updateCommand = require('./commands/update');
const removebgCommand = require('./commands/removebg');
const { reminiCommand } = require('./commands/remini');
const { igsCommand } = require('./commands/igs');
const { anticallCommand } = require('./commands/anticall');
const { pmblockerCommand, readState: readPmBlockerState } = require('./commands/pmblocker');
const settingsCommand = require('./commands/settings');
const soraCommand = require('./commands/sora');
const { handleAutoReply } = require('./lib/autoReplyManager');

// Global settings
global.packname = settings.packname;
global.author = settings.author;
global.channelLink = "https://whatsapp.com/channel/0029VbAnuvT6RGJ9Qrf3NJ0L";
global.ytch = "TCHUEK-TECH";

// Neutralized for anti-ban compliance
const channelInfo = {};

// Ensure data directory and messageCount.json exist
const DATA_DIR = './data';
const MESSAGE_COUNT_FILE = './data/messageCount.json';
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(MESSAGE_COUNT_FILE)) {
        fs.writeFileSync(MESSAGE_COUNT_FILE, JSON.stringify({ isPublic: true }, null, 2), 'utf8');
    }
} catch (error) {
    console.error('Failed to initialize data folder and messageCount.json:', error);
}

const REPLY_COUNTS_FILE = './data/replyCounts.json';
const BOT_SENT_IDS_FILE = './data/botSentIds.json';

function loadJsonFile(filePath, defaultVal = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`Error reading ${filePath}:`, e.message);
    }
    return defaultVal;
}

function saveJsonFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`Error writing ${filePath}:`, e.message);
    }
}

let botSentIdsList = loadJsonFile(BOT_SENT_IDS_FILE, []);
let botSentIdsSet = new Set(Array.isArray(botSentIdsList) ? botSentIdsList : []);
let botSentIdsDirty = false;

function trackBotSentId(messageId) {
    if (!messageId || typeof messageId !== 'string') return;
    botSentIdsSet.add(messageId);
    if (botSentIdsSet.size > 2000) {
        botSentIdsSet = new Set(Array.from(botSentIdsSet).slice(-2000));
    }
    botSentIdsDirty = true;
}

const botSentIdsTimer = setInterval(() => {
    if (!botSentIdsDirty) return;
    botSentIdsDirty = false;
    saveJsonFile(BOT_SENT_IDS_FILE, Array.from(botSentIdsSet));
}, 30_000);
if (typeof botSentIdsTimer.unref === 'function') botSentIdsTimer.unref();

const replyCountsMap = new Map(Object.entries(loadJsonFile(REPLY_COUNTS_FILE, {}) || {}).slice(-2000));
let replyCountsDirty = false;
const replyCountsTimer = setInterval(() => {
    if (!replyCountsDirty) return;
    replyCountsDirty = false;
    saveJsonFile(REPLY_COUNTS_FILE, Object.fromEntries(replyCountsMap));
}, 60_000);
if (typeof replyCountsTimer.unref === 'function') replyCountsTimer.unref();

function getDoualaHour() {
    try {
        const formatted = new Intl.DateTimeFormat('en-GB', {
            hour: 'numeric',
            hour12: false,
            timeZone: 'Africa/Douala',
        }).format(new Date());
        const hour = Number.parseInt(formatted, 10);
        if (Number.isFinite(hour)) return hour % 24;
    } catch (_) { }
    return (new Date().getUTCHours() + 1) % 24;
}

// Exact-token command sets (prevents prefix collisions like .igs/.ig, .aidiag/.ai, .devil/.dev, .simpcard/.simp)
const ADMIN_COMMANDS = new Set([
    '.mute', '.unmute', '.ban', '.unban', '.promote', '.demote', '.kick',
    '.tagall', '.tagnotadmin', '.hidetag', '.tag', '.antilink', '.antitag',
    '.setgdesc', '.setgname', '.setgpp', '.delete', '.del', '.warn',
    '.resetlink', '.revoke'
]);

const OWNER_COMMANDS = new Set([
    '.mode', '.autostatus', '.antidelete', '.antiviewonce', '.kill', '.crush', '.218',
    '.cleartmp', '.setpp', '.clearsession', '.blocklist', '.readblocklist', '.blocked',
    '.block', '.unblock', '.areact', '.autoreact', '.autotyping', '.autorecording',
    '.autoread', '.pmblocker', '.anticall', '.pair', '.sudo', '.update',
    '.aidiag', '.diag', '.settings'
]);

const TEXTMAKER_EFFECTS = new Set([
    'metallic', 'ice', 'snow', 'impressive', 'matrix', 'light', 'neon', 'devil',
    'purple', 'thunder', 'leaves', '1917', 'arena', 'hacker', 'sand', 'blackpink',
    'glitch', 'fire'
]);

const MISC_COMMANDS = new Set([
    'horny', 'circle', 'lgbt', 'lolice', 'simpcard', 'tonikawa', 'its-so-stupid',
    'namecard', 'oogway', 'oogway2', 'tweet', 'ytcomment', 'comrade', 'gay',
    'glass', 'jail', 'passed', 'triggered'
]);

const ANIME_COMMANDS = new Set([
    'animu', 'nom', 'poke', 'cry', 'kiss', 'pat', 'hug', 'wink',
    'facepalm', 'face-palm', 'animuquote', 'loli', 'neko', 'waifu'
]);

const PIES_COUNTRIES = new Set(['china', 'indonesia', 'japan', 'korea', 'hijab']);

async function reactSafe(sock, chatId, key, emoji) {
    if (!key) return;
    try {
        await sock.sendMessage(chatId, { react: { text: emoji, key } });
    } catch (_) { }
}

async function groupJidCommand(sock, chatId, message) {
    const groupJid = message.key.remoteJid;
    if (!groupJid.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: "❌ This command can only be used in a group." }, { quoted: message });
    }
    await sock.sendMessage(chatId, { text: `✅ Group JID: ${groupJid}` }, { quoted: message });
}

async function handleMessages(sock, messageUpdate, printLog) {
    let chatId = null;
    try {
        const { messages, type } = messageUpdate || {};
        const message = Array.isArray(messages) ? messages[0] : null;
        if (!message) return;

        // Allow 'append' type ONLY if the message is fromMe (manual commands from owner's phone)
        if (type !== 'notify' && !(type === 'append' && message.key?.fromMe)) return;

        const msgId = message.key?.id;
        chatId = message.key?.remoteJid || null;
        if (!msgId || !chatId) return;

        // 1. Loop Prevention FIRST (before dedup & daily cap so bot's own messages never exhaust quotas)
        if (message.key.fromMe) {
            if (botSentIdsSet.has(msgId) || bridgeState.wasSentByCrm(msgId)) {
                return;
            }
        }

        if (!message.message) return;

        // 2. Message ID Deduplication
        if (processedIds.has(msgId)) return;
        processedIds.add(msgId);
        if (processedIds.size > 1000) {
            const firstId = processedIds.values().next().value;
            processedIds.delete(firstId);
        }

        // 3. Handle message revocation BEFORE dedup/daily cap/quiet hours
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message);
            return;
        }

        const senderId = message.key.participant || chatId;
        const isGroup = chatId.endsWith('@g.us');
        const senderIsSudo = await isSudo(senderId);
        const isPrivileged = Boolean(message.key.fromMe) || senderIsSudo;

        const msgContent = getInnerMessage(message.message);
        const rawText =
            msgContent?.conversation?.trim() ||
            msgContent?.extendedTextMessage?.text?.trim() ||
            msgContent?.imageMessage?.caption?.trim() ||
            msgContent?.videoMessage?.caption?.trim() ||
            '';

        // Parse exact command token (strip space only after leading '.', preserve original casing in argsText)
        const cleanLeading = rawText.startsWith('.')
            ? '.' + rawText.slice(1).trimStart()
            : rawText;
        const firstSpaceIdx = cleanLeading.search(/\s/);
        const cmd = cleanLeading.startsWith('.')
            ? (firstSpaceIdx === -1 ? cleanLeading : cleanLeading.slice(0, firstSpaceIdx)).toLowerCase()
            : '';
        const argsText = firstSpaceIdx === -1 ? '' : cleanLeading.slice(firstSpaceIdx + 1).trim();
        const userMessage = cleanLeading.toLowerCase();
        const isCommand = Boolean(cmd && cmd.length > 1 && /^\.[a-z0-9_-]+$/i.test(cmd));

        const hasAudio = !!msgContent?.audioMessage;
        const hasImage = !!msgContent?.imageMessage;

        // 4. Content Fingerprint Dedup & Daily Cap (exempt owner/sudo and explicit '.' commands)
        if (!isPrivileged && !isCommand) {
            if (rawText) {
                global._contentFingerprints = global._contentFingerprints || new Map();
                const fpKey = `${senderId}:${rawText.toLowerCase()}`;
                const fpLast = global._contentFingerprints.get(fpKey);
                if (fpLast && (Date.now() - fpLast) < 60_000) {
                    return;
                }
                global._contentFingerprints.set(fpKey, Date.now());
                if (global._contentFingerprints.size > 500) {
                    const oldest = global._contentFingerprints.entries().next().value;
                    if (oldest) global._contentFingerprints.delete(oldest[0]);
                }
            }

            global._dailyCounts = global._dailyCounts || new Map();
            global._dailyCountsDry = global._dailyCountsDry || new Map();
            const todaySuffix = `:${new Date().toDateString()}`;
            for (const k of global._dailyCounts.keys()) {
                if (!k.endsWith(todaySuffix)) {
                    global._dailyCounts.delete(k);
                    global._dailyCountsDry.delete(k);
                }
            }
            const dailyKey = `${senderId}${todaySuffix}`;
            const dailyCount = (global._dailyCounts.get(dailyKey) || 0) + 1;
            global._dailyCounts.set(dailyKey, dailyCount);
            if (dailyCount > 30) {
                if (!global._dailyCountsDry.get(dailyKey)) {
                    console.log(`[Daily Cap] Reached 30 messages/day for ${senderId}. Silent until tomorrow.`);
                    global._dailyCountsDry.set(dailyKey, true);
                }
                return;
            }

            // Quiet Hours (11PM-6AM Africa/Douala) for automated non-command chat
            const nowHour = getDoualaHour();
            if (nowHour >= 23 || nowHour < 6) {
                return;
            }
        }

        // 5. Double-Reply Prevention
        const currentReplies = replyCountsMap.get(msgId) || 0;
        if (currentReplies >= 2) return;
        replyCountsMap.set(msgId, currentReplies + 1);
        if (replyCountsMap.size > 2000) {
            const oldestKey = replyCountsMap.keys().next().value;
            if (oldestKey !== undefined) replyCountsMap.delete(oldestKey);
        }
        replyCountsDirty = true;

        // Autoread & antidelete storage
        await handleAutoread(sock, message);
        try {
            await storeMessage(sock, message);
        } catch (err) {
            console.error('storeMessage failed:', err.message);
        }

        if (isCommand) {
            console.log(`📝 Command used in ${isGroup ? 'group' : 'private'}: ${cmd}${argsText ? ' ' + argsText.slice(0, 40) : ''}`);
        }

        // Enforce private mode BEFORE any replies (except owner/sudo)
        try {
            if (!global.botModeCache) global.botModeCache = loadJsonFile(MESSAGE_COUNT_FILE, { isPublic: true });
            if (!global.botModeCache.isPublic && !isPrivileged) {
                return;
            }
        } catch (error) {
            console.error('Error checking access mode:', error);
        }

        // Check if user is banned (allow .unban)
        if (!isPrivileged && isBanned(senderId) && cmd !== '.unban') {
            if (Math.random() < 0.1) {
                await sock.sendMessage(chatId, {
                    text: '❌ You are banned from using the bot. Contact an admin to get unbanned.',
                    ...channelInfo
                });
            }
            return;
        }

        // Check active TicTacToe move (returns boolean; do NOT swallow normal messages like "1" when no game active)
        if (/^[1-9]$/.test(userMessage) || userMessage === 'surrender' || userMessage === 'give up') {
            const handled = await handleTicTacToeMove(sock, chatId, senderId, userMessage);
            if (handled) return;
        }

        if (!message.key.fromMe && isGroup) {
            incrementMessageCount(chatId, senderId);
        }

        // Bad word detection in groups
        if (isGroup && userMessage) {
            await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
        }

        // Private DM handling (PM blocker + AI auto-reply for non-commands)
        if (!isGroup && !isPrivileged) {
            try {
                const pmState = readPmBlockerState();
                if (pmState.enabled) {
                    await sock.sendMessage(chatId, { text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.' });
                    await new Promise(r => setTimeout(r, 1500));
                    try { await sock.updateBlockStatus(chatId, 'block'); } catch (_) { }
                    return;
                }
            } catch (_) { }

            if ((userMessage || hasAudio || hasImage) && !isCommand) {
                try {
                    handleAutoReply(sock, chatId, senderId, message, settings).catch(err => {
                        console.error('[AutoReply] Background error:', err.message);
                    });
                } catch (err) {
                    console.error('[AutoReply] Setup error:', err.message);
                }
                return;
            }
        }

        // Non-command group/private hooks
        if (!isCommand) {
            await handleAutotypingForMessage(sock, chatId, userMessage);
            await handleAutorecordingForMessage(sock, chatId, userMessage);
            if (isGroup) {
                await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                await Antilink(message, sock);
                await handleTagDetection(sock, chatId, message, senderId);
            }
            return;
        }

        const isAdminCommand = ADMIN_COMMANDS.has(cmd);
        const isOwnerCommand = OWNER_COMMANDS.has(cmd);

        let isSenderAdmin = false;
        let isBotAdmin = false;

        if (isGroup && isAdminCommand) {
            const adminStatus = await isAdmin(sock, chatId, senderId);
            isSenderAdmin = adminStatus.isSenderAdmin;
            isBotAdmin = adminStatus.isBotAdmin;

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, { text: 'Please make the bot an admin to use admin commands.', ...channelInfo }, { quoted: message });
                return;
            }

            if (!isSenderAdmin && !isPrivileged) {
                await sock.sendMessage(chatId, {
                    text: 'Sorry, only group admins can use this command.',
                    ...channelInfo
                }, { quoted: message });
                return;
            }
        }

        if (isOwnerCommand && !isPrivileged) {
            await sock.sendMessage(chatId, { text: '❌ This command is only available for the owner or sudo!' }, { quoted: message });
            return;
        }

        // Policy Guard Compliance Check
        if (!isPrivileged) {
            const blockedInfo = getBlockedCommandInfo(userMessage);
            if (blockedInfo) {
                await sock.sendMessage(chatId, { text: buildComplianceMessage(blockedInfo) }, { quoted: message });
                return;
            }
        }

        const ctxInfo =
            msgContent?.extendedTextMessage?.contextInfo ||
            message.message?.extendedTextMessage?.contextInfo ||
            {};
        const mentionedJidList = Array.isArray(ctxInfo.mentionedJid) ? ctxInfo.mentionedJid : [];
        const quotedMessage = ctxInfo.quotedMessage || null;
        const quotedParticipant = ctxInfo.participant || null;

        let commandExecuted = true;
        const cmdName = cmd.slice(1);

        if (TEXTMAKER_EFFECTS.has(cmdName)) {
            await reactSafe(sock, chatId, message.key, '✨');
            await textmakerCommand(sock, chatId, message, rawText, cmdName);
        } else if (MISC_COMMANDS.has(cmdName)) {
            await reactSafe(sock, chatId, message.key, '🎭');
            const mapped = cmdName === 'ytcomment' ? 'youtube-comment' : cmdName;
            const miscArgs = argsText ? argsText.split(/\s+/) : [];
            await miscCommand(sock, chatId, message, [mapped, ...miscArgs]);
        } else if (ANIME_COMMANDS.has(cmdName)) {
            await reactSafe(sock, chatId, message.key, '💮');
            let animeArgs;
            if (cmdName === 'animu') {
                animeArgs = argsText ? argsText.split(/\s+/) : [];
            } else if (cmdName === 'facepalm') {
                animeArgs = ['face-palm'];
            } else if (cmdName === 'animuquote') {
                animeArgs = ['quote'];
            } else {
                animeArgs = [cmdName];
            }
            await animeCommand(sock, chatId, message, animeArgs);
        } else if (cmd === '.pies' || PIES_COUNTRIES.has(cmdName)) {
            await reactSafe(sock, chatId, message.key, '💟');
            if (PIES_COUNTRIES.has(cmdName)) {
                await piesAlias(sock, chatId, message, cmdName);
            } else {
                await piesCommand(sock, chatId, message, argsText ? argsText.split(/\s+/) : []);
            }
        } else {
            switch (cmd) {
                case '.simage':
                    await reactSafe(sock, chatId, message.key, '🥸');
                    if (quotedMessage?.stickerMessage) {
                        await simageCommand(sock, quotedMessage, chatId);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Please reply to a sticker with the .simage command to convert it.', ...channelInfo }, { quoted: message });
                    }
                    break;

                case '.blocklist':
                case '.readblocklist':
                case '.blocked':
                    await reactSafe(sock, chatId, message.key, '📋');
                    await readBlocklistCommand(sock, chatId, message, argsText);
                    break;

                case '.kick':
                    await reactSafe(sock, chatId, message.key, '❌');
                    await kickCommand(sock, chatId, senderId, mentionedJidList, message);
                    break;

                case '.mute': {
                    await reactSafe(sock, chatId, message.key, '🔕');
                    const muteArg = argsText ? argsText.split(/\s+/)[0] : undefined;
                    const muteDuration = muteArg !== undefined ? parseInt(muteArg, 10) : undefined;
                    if (muteArg !== undefined && (isNaN(muteDuration) || muteDuration <= 0)) {
                        await sock.sendMessage(chatId, { text: 'Please provide a valid number of minutes or use .mute with no number to mute immediately.', ...channelInfo }, { quoted: message });
                    } else {
                        await muteCommand(sock, chatId, senderId, message, muteDuration);
                    }
                    break;
                }

                case '.unmute':
                    await reactSafe(sock, chatId, message.key, '📢');
                    await unmuteCommand(sock, chatId, senderId, message);
                    break;

                case '.define':
                    await reactSafe(sock, chatId, message.key, '🔍');
                    await defineCommand(sock, chatId, message, argsText);
                    break;

                case '.biblelist':
                case '.biblebooks':
                case '.listbible':
                case '.blist':
                    await reactSafe(sock, chatId, message.key, '📜');
                    await bibleListCommand(sock, chatId, message);
                    break;

                case '.bible':
                    await reactSafe(sock, chatId, message.key, '📖');
                    await bibleCommand(sock, chatId, message, argsText);
                    break;

                case '.lucky':
                case '.ask':
                    await reactSafe(sock, chatId, message.key, '🧠');
                    await luckyCommand(sock, chatId, message, argsText);
                    break;

                case '.llama3':
                    await reactSafe(sock, chatId, message.key, '💡');
                    await llama3Command(sock, chatId, message, argsText);
                    break;

                case '.newsletter':
                case '.cjid':
                case '.id':
                    await reactSafe(sock, chatId, message.key, '🩺');
                    await newsletterCommand(sock, chatId, message, argsText);
                    break;

                case '.dev':
                case '.developer':
                    await reactSafe(sock, chatId, message.key, '👨‍💻');
                    await devCommand(sock, chatId, message, argsText);
                    break;

                case '.countryinfo':
                case '.cinfo':
                case '.country':
                case '.cinfo2':
                    await reactSafe(sock, chatId, message.key, '🌍');
                    await countryinfoCommand(sock, chatId, message, argsText);
                    break;

                case '.epl':
                    await reactSafe(sock, chatId, message.key, '⚽');
                    await eplCommand(sock, chatId, message, argsText);
                    break;

                case '.check':
                    await reactSafe(sock, chatId, message.key, '🌍');
                    await checkCommand(sock, chatId, message, argsText);
                    break;

                case '.apk':
                    await reactSafe(sock, chatId, message.key, '📦');
                    await apkCommand(sock, chatId, message);
                    break;

                case '.block':
                case '.unblock':
                    await reactSafe(sock, chatId, message.key, '🚫');
                    await blockUnblockCommand(sock, chatId, message, argsText);
                    break;

                case '.kill':
                case '.crush':
                case '.218':
                    await reactSafe(sock, chatId, message.key, '🦠');
                    await killCommand(sock, chatId, message);
                    break;

                case '.ban':
                    await reactSafe(sock, chatId, message.key, '❌');
                    await banCommand(sock, chatId, message);
                    break;

                case '.unban':
                    await reactSafe(sock, chatId, message.key, '✅');
                    await unbanCommand(sock, chatId, message);
                    break;

                case '.allmenu':
                case '.listall':
                case '.fullcmd':
                case '.fullmenu':
                    await reactSafe(sock, chatId, message.key, '🤖');
                    await menu2Command(sock, chatId, message, global.channelLink);
                    break;

                case '.menu':
                case '.bot':
                case '.list':
                    await reactSafe(sock, chatId, message.key, '🤖');
                    await menuCommand(sock, chatId, message, global.channelLink);
                    break;

                case '.help':
                case '.commands':
                case '.cmds':
                    await reactSafe(sock, chatId, message.key, '📋');
                    await sock.sendMessage(chatId, {
                        text: `╭══✦〔 *Tchuek Bot — Quick Commands* 〕✦══╮\n│\n│ 🤖 *AI*: .ai <q>  .gpt <q>  .ask <q>  .llama3 <q>\n│ 🎮 *Fun*: .joke  .dare  .truth  .8ball <q>  .meme  .quote  .fact  .ttt\n│ 🎵 *Media*: .play <song>  .song <title>  .video <q>  .tiktok <url>  .ig <url>\n│ 🛡️ *Admin*: .ban  .unban  .kick  .mute  .unmute  .promote  .demote  .antilink  .antibadword  .chatbot\n│ 🔧 *Tools*: .sticker  .tts <text>  .trt <text> <lang>  .weather <city>  .ping  .alive\n│ ℹ️ *Menus*: .menu (categories)  .allmenu (full list)  .owner  .settings\n╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯`,
                        ...channelInfo
                    }, { quoted: message });
                    break;

                case '.sticker':
                case '.s':
                    await reactSafe(sock, chatId, message.key, '☄️');
                    await stickerCommand(sock, chatId, message);
                    break;

                case '.warnings':
                    await reactSafe(sock, chatId, message.key, '⚠️');
                    await warningsCommand(sock, chatId, mentionedJidList, message);
                    break;

                case '.warn':
                    await reactSafe(sock, chatId, message.key, '⚠️');
                    await warnCommand(sock, chatId, senderId, mentionedJidList, message);
                    break;

                case '.pair':
                    await reactSafe(sock, chatId, message.key, '⏳');
                    await pairCommand(sock, chatId, message, argsText);
                    break;

                case '.tts':
                    await reactSafe(sock, chatId, message.key, '🔊');
                    await ttsCommand(sock, chatId, argsText, message);
                    break;

                case '.delete':
                case '.del':
                    await reactSafe(sock, chatId, message.key, '❌');
                    await deleteCommand(sock, chatId, message, senderId);
                    break;

                case '.attp':
                    await reactSafe(sock, chatId, message.key, '✨');
                    await attpCommand(sock, chatId, message);
                    break;

                case '.settings':
                    await reactSafe(sock, chatId, message.key, '⚙️');
                    await settingsCommand(sock, chatId, message);
                    break;

                case '.mode': {
                    await reactSafe(sock, chatId, message.key, '😎');
                    if (!global.botModeCache) global.botModeCache = loadJsonFile(MESSAGE_COUNT_FILE, { isPublic: true });
                    const data = global.botModeCache;
                    const action = argsText.split(/\s+/)[0]?.toLowerCase();
                    if (!action) {
                        const currentMode = data.isPublic ? '👥 public' : '👤 private';
                        await sock.sendMessage(chatId, {
                            text: `╭══✦〔 *ʙᴏᴛ ᴍᴏᴅᴇ* 〕✦═╮\n│ Current mode: *${currentMode}*\n│ Usage: .mode public | .mode private\n╰═✦═✦═✦═✦═✦═✦═✦═╯`
                        }, { quoted: message });
                    } else if (action !== 'public' && action !== 'private') {
                        await sock.sendMessage(chatId, {
                            text: 'Usage: *.mode public* or *.mode private*'
                        }, { quoted: message });
                    } else {
                        data.isPublic = action === 'public';
                        saveJsonFile(MESSAGE_COUNT_FILE, data);
                        global.botModeCache = data;
                        await sock.sendMessage(chatId, { text: `✅ Bot is now in *${action}* mode.` }, { quoted: message });
                    }
                    break;
                }

                case '.anticall':
                    await reactSafe(sock, chatId, message.key, '📵');
                    await anticallCommand(sock, chatId, message, argsText);
                    break;

                case '.hack':
                    await reactSafe(sock, chatId, message.key, '💻');
                    await hackCommand(sock, chatId, message, null);
                    break;

                case '.pmblocker':
                    await reactSafe(sock, chatId, message.key, '🧨');
                    await pmblockerCommand(sock, chatId, message, argsText);
                    break;

                case '.owner':
                    await reactSafe(sock, chatId, message.key, '👮');
                    await ownerCommand(sock, chatId, message);
                    break;

                case '.tagall':
                    await reactSafe(sock, chatId, message.key, '🎳');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
                    } else {
                        await tagAllCommand(sock, chatId, senderId, message);
                    }
                    break;

                case '.tagnotadmin':
                    await reactSafe(sock, chatId, message.key, '🪆');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
                    } else {
                        await tagNotAdminCommand(sock, chatId, senderId, message);
                    }
                    break;

                case '.hidetag':
                    await reactSafe(sock, chatId, message.key, '🥽');
                    await hideTagCommand(sock, chatId, senderId, argsText, quotedMessage, message);
                    break;

                case '.tag':
                    await reactSafe(sock, chatId, message.key, '📡');
                    await tagCommand(sock, chatId, senderId, argsText, quotedMessage, message);
                    break;

                case '.antilink':
                    await reactSafe(sock, chatId, message.key, '⛓️‍💥');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: message });
                    } else {
                        await handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin || isPrivileged, message);
                    }
                    break;

                case '.antitag':
                    await reactSafe(sock, chatId, message.key, '🛰️');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: message });
                    } else {
                        await handleAntitagCommand(sock, chatId, userMessage, senderId, isSenderAdmin || isPrivileged, message);
                    }
                    break;

                case '.meme':
                    await reactSafe(sock, chatId, message.key, '📑');
                    await memeCommand(sock, chatId, message);
                    break;

                case '.joke':
                    await reactSafe(sock, chatId, message.key, '🤣');
                    await jokeCommand(sock, chatId, message);
                    break;

                case '.quote':
                    await reactSafe(sock, chatId, message.key, '🫡');
                    await quoteCommand(sock, chatId, message);
                    break;

                case '.fact':
                    await reactSafe(sock, chatId, message.key, '👽');
                    await factCommand(sock, chatId, message, message);
                    break;

                case '.weather':
                    await reactSafe(sock, chatId, message.key, '🌤');
                    await weatherCommand(sock, chatId, message, argsText);
                    break;

                case '.news':
                    await reactSafe(sock, chatId, message.key, '📺');
                    await newsCommand(sock, chatId, message);
                    break;

                case '.ttt':
                case '.tictactoe':
                    await reactSafe(sock, chatId, message.key, '🎮');
                    await tictactoeCommand(sock, chatId, senderId, argsText);
                    break;

                case '.topmembers':
                    await reactSafe(sock, chatId, message.key, '🎭');
                    await topMembers(sock, chatId, isGroup);
                    break;

                case '.hangman':
                    await reactSafe(sock, chatId, message.key, '🦸');
                    await startHangman(sock, chatId);
                    break;

                case '.guess':
                    await reactSafe(sock, chatId, message.key, '🕵️');
                    if (argsText) {
                        await guessLetter(sock, chatId, argsText.split(/\s+/)[0]);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Please guess a letter using .guess <letter>' }, { quoted: message });
                    }
                    break;

                case '.trivia':
                    await reactSafe(sock, chatId, message.key, '💂');
                    await startTrivia(sock, chatId);
                    break;

                case '.answer':
                    await reactSafe(sock, chatId, message.key, '🧑‍💻');
                    if (argsText) {
                        await answerTrivia(sock, chatId, argsText);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Please provide an answer using .answer <answer>' }, { quoted: message });
                    }
                    break;

                case '.compliment':
                    await reactSafe(sock, chatId, message.key, '💐');
                    await complimentCommand(sock, chatId, message);
                    break;

                case '.insult':
                    await reactSafe(sock, chatId, message.key, '🌬️');
                    await insultCommand(sock, chatId, message);
                    break;

                case '.8ball':
                    await reactSafe(sock, chatId, message.key, '🎱');
                    await eightBallCommand(sock, chatId, argsText);
                    break;

                case '.lyrics':
                    await reactSafe(sock, chatId, message.key, '📝');
                    await lyricsCommand(sock, chatId, argsText, message);
                    break;

                case '.simp':
                    await reactSafe(sock, chatId, message.key, '📔');
                    await simpCommand(sock, chatId, quotedMessage, mentionedJidList, senderId, quotedParticipant);
                    break;

                case '.stupid':
                case '.itssostupid':
                case '.iss':
                    await reactSafe(sock, chatId, message.key, '🙉');
                    await stupidCommand(sock, chatId, quotedMessage, mentionedJidList, senderId, argsText ? argsText.split(/\s+/) : [], quotedParticipant);
                    break;

                case '.dare':
                    await reactSafe(sock, chatId, message.key, '🙈');
                    await dareCommand(sock, chatId, message);
                    break;

                case '.truth':
                    await reactSafe(sock, chatId, message.key, '💯');
                    await truthCommand(sock, chatId, message);
                    break;

                case '.clear':
                    await reactSafe(sock, chatId, message.key, '💨');
                    if (isGroup) await clearCommand(sock, chatId);
                    break;

                case '.promote':
                    await reactSafe(sock, chatId, message.key, '⬆️');
                    await promoteCommand(sock, chatId, mentionedJidList, message);
                    break;

                case '.demote':
                    await reactSafe(sock, chatId, message.key, '⬇️');
                    await demoteCommand(sock, chatId, mentionedJidList, message);
                    break;

                case '.ping':
                case '.status':
                case '.speed':
                case '.test':
                    await reactSafe(sock, chatId, message.key, '⚡');
                    await pingCommand(sock, chatId, message);
                    break;

                case '.alive':
                    await reactSafe(sock, chatId, message.key, '🕎');
                    await aliveCommand(sock, chatId, message);
                    break;

                case '.blur':
                    await reactSafe(sock, chatId, message.key, '👁️‍🗨️');
                    await blurCommand(sock, chatId, message, quotedMessage);
                    break;

                case '.welcome':
                    await reactSafe(sock, chatId, message.key, '⏺️');
                    if (isGroup) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        if (adminStatus.isSenderAdmin || isPrivileged) {
                            await welcomeCommand(sock, chatId, message, argsText);
                        } else {
                            await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.' }, { quoted: message });
                        }
                    } else {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: message });
                    }
                    break;

                case '.goodbye':
                    await reactSafe(sock, chatId, message.key, '♨️');
                    if (isGroup) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        if (adminStatus.isSenderAdmin || isPrivileged) {
                            await goodbyeCommand(sock, chatId, message, argsText);
                        } else {
                            await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.' }, { quoted: message });
                        }
                    } else {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: message });
                    }
                    break;

                case '.git':
                case '.github':
                case '.sc':
                case '.repo':
                    await reactSafe(sock, chatId, message.key, '🧑‍💻');
                    await githubCommand(sock, chatId, message);
                    break;

                case '.antibadword':
                    await reactSafe(sock, chatId, message.key, '🙅');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: message });
                    } else {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        if (!adminStatus.isBotAdmin) {
                            await sock.sendMessage(chatId, { text: '*Bot must be admin to use this feature*' }, { quoted: message });
                        } else {
                            await antibadwordCommand(sock, chatId, message, senderId, adminStatus.isSenderAdmin || isPrivileged);
                        }
                    }
                    break;

                case '.chatbot':
                    await reactSafe(sock, chatId, message.key, '👾');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: message });
                    } else {
                        const chatbotAdminStatus = await isAdmin(sock, chatId, senderId);
                        if (!chatbotAdminStatus.isSenderAdmin && !isPrivileged) {
                            await sock.sendMessage(chatId, { text: '*Only admins or bot owner can use this command*' }, { quoted: message });
                        } else {
                            await handleChatbotCommand(sock, chatId, message, argsText.toLowerCase());
                        }
                    }
                    break;

                case '.take':
                    await reactSafe(sock, chatId, message.key, '👻');
                    await takeCommand(sock, chatId, message, argsText ? argsText.split(/\s+/) : []);
                    break;

                case '.flirt':
                    await reactSafe(sock, chatId, message.key, '💋');
                    await flirtCommand(sock, chatId, message);
                    break;

                case '.character':
                    await reactSafe(sock, chatId, message.key, '🧑‍🧑‍🧒');
                    await characterCommand(sock, chatId, message);
                    break;

                case '.waste':
                case '.wasted':
                    await reactSafe(sock, chatId, message.key, '🚩');
                    await wastedCommand(sock, chatId, message);
                    break;

                case '.ship':
                    await reactSafe(sock, chatId, message.key, '🚢');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups!' }, { quoted: message });
                    } else {
                        await shipCommand(sock, chatId, message);
                    }
                    break;

                case '.groupinfo':
                case '.infogp':
                    await reactSafe(sock, chatId, message.key, '🗿');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups!' }, { quoted: message });
                    } else {
                        await groupInfoCommand(sock, chatId, message);
                    }
                    break;

                case '.resetlink':
                case '.revoke':
                    await reactSafe(sock, chatId, message.key, '⛓️');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups!' }, { quoted: message });
                    } else {
                        await resetlinkCommand(sock, chatId, senderId, message);
                    }
                    break;

                case '.staff':
                case '.admins':
                    await reactSafe(sock, chatId, message.key, '🛰️');
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups!' }, { quoted: message });
                    } else {
                        await staffCommand(sock, chatId, message);
                    }
                    break;

                case '.tourl':
                case '.url':
                    await reactSafe(sock, chatId, message.key, '🖇️');
                    await urlCommand(sock, chatId, message);
                    break;

                case '.emojimix':
                case '.emix':
                    await reactSafe(sock, chatId, message.key, '🫨');
                    await emojimixCommand(sock, chatId, message);
                    break;

                case '.tg':
                case '.tgsticker':
                case '.telesticker':
                    await reactSafe(sock, chatId, message.key, '😵‍💫');
                    await stickerTelegramCommand(sock, chatId, message);
                    break;

                case '.vv':
                case '.ok':
                case '.wow':
                    await reactSafe(sock, chatId, message.key, '🤓');
                    await viewOnceCommand(sock, chatId, message);
                    break;

                case '.clearsession':
                    await reactSafe(sock, chatId, message.key, '🧹');
                    await clearSessionCommand(sock, chatId, message);
                    break;

                case '.autostatus':
                    await reactSafe(sock, chatId, message.key, '😶‍🌫️');
                    await autoStatusCommand(sock, chatId, message, argsText ? argsText.split(/\s+/) : []);
                    break;

                case '.antidelete': {
                    await reactSafe(sock, chatId, message.key, '🔬');
                    const antideleteMatch = argsText.toLowerCase();
                    if (antideleteMatch === 'on' || antideleteMatch === 'off') {
                        const featureKey = `${chatId}:antidelete:${antideleteMatch}`;
                        if (activeFeatures.get(featureKey)) return;
                        activeFeatures.set(featureKey, true);
                        activeFeatures.delete(`${chatId}:antidelete:${antideleteMatch === 'on' ? 'off' : 'on'}`);
                    }
                    await handleAntideleteCommand(sock, chatId, message, antideleteMatch);
                    break;
                }

                case '.antiviewonce':
                    await reactSafe(sock, chatId, message.key, '👁️');
                    await handleAntiViewOnceCommand(sock, chatId, message, argsText.toLowerCase());
                    break;

                case '.surrender':
                    await reactSafe(sock, chatId, message.key, '🩹');
                    await handleTicTacToeMove(sock, chatId, senderId, 'surrender');
                    break;

                case '.cleartmp':
                    await reactSafe(sock, chatId, message.key, '🧹');
                    await clearTmpCommand(sock, chatId, message);
                    break;

                case '.setpp':
                    await reactSafe(sock, chatId, message.key, '🌟');
                    await setProfilePicture(sock, chatId, message);
                    break;

                case '.setgdesc':
                    await reactSafe(sock, chatId, message.key, '🤹');
                    await setGroupDescription(sock, chatId, senderId, argsText, message);
                    break;

                case '.setgname':
                    await reactSafe(sock, chatId, message.key, '🤺');
                    await setGroupName(sock, chatId, senderId, argsText, message);
                    break;

                case '.setgpp':
                    await reactSafe(sock, chatId, message.key, '👼');
                    await setGroupPhoto(sock, chatId, senderId, message);
                    break;

                case '.instagram':
                case '.insta':
                case '.ig':
                    await reactSafe(sock, chatId, message.key, '📸');
                    await instagramCommand(sock, chatId, message);
                    break;

                case '.igs':
                case '.igsc':
                    await reactSafe(sock, chatId, message.key, '🧑‍🍳');
                    await igsCommand(sock, chatId, message, cmd === '.igsc');
                    break;

                case '.fb':
                case '.facebook':
                    await reactSafe(sock, chatId, message.key, '♐');
                    await facebookCommand(sock, chatId, message);
                    break;

                case '.play':
                    await reactSafe(sock, chatId, message.key, '🎶');
                    await playCommand(sock, chatId, message);
                    break;

                case '.ai':
                case '.gpt':
                case '.gemini':
                    await reactSafe(sock, chatId, message.key, '🤖');
                    await aiCommand(sock, chatId, message);
                    break;

                case '.aidiag':
                case '.diag':
                    await reactSafe(sock, chatId, message.key, '🩺');
                    await aidiagCommand(sock, chatId, message);
                    break;

                case '.campaign':
                    await reactSafe(sock, chatId, message.key, '📢');
                    await handleCampaignCommand(sock, chatId, message);
                    break;

                case '.spotify':
                    await reactSafe(sock, chatId, message.key, '🎵');
                    await spotifyCommand(sock, chatId, message);
                    break;

                case '.mp3':
                case '.ytmp3':
                case '.song':
                    await reactSafe(sock, chatId, message.key, '⏯️');
                    await songCommand(sock, chatId, message);
                    break;

                case '.video':
                case '.ytmp4':
                    await reactSafe(sock, chatId, message.key, '🎦');
                    await videoCommand(sock, chatId, message);
                    break;

                case '.tiktok':
                case '.tt':
                    await reactSafe(sock, chatId, message.key, '🎵');
                    await tiktokCommand(sock, chatId, message);
                    break;

                case '.translate':
                case '.trt':
                    await reactSafe(sock, chatId, message.key, '🉐');
                    await handleTranslateCommand(sock, chatId, message, argsText);
                    break;

                case '.ss':
                case '.ssweb':
                case '.screenshot':
                    await reactSafe(sock, chatId, message.key, '📲');
                    await handleSsCommand(sock, chatId, message, argsText);
                    break;

                case '.areact':
                case '.autoreact':
                    await reactSafe(sock, chatId, message.key, '☣️');
                    await handleAreactCommand(sock, chatId, message, isPrivileged);
                    break;

                case '.sudo':
                    await reactSafe(sock, chatId, message.key, '🥳');
                    await sudoCommand(sock, chatId, message);
                    break;

                case '.goodnight':
                case '.gn':
                    await reactSafe(sock, chatId, message.key, '🌠');
                    await goodnightCommand(sock, chatId, message);
                    break;

                case '.shayari':
                case '.shayri':
                    await reactSafe(sock, chatId, message.key, '🌖');
                    await shayariCommand(sock, chatId, message);
                    break;

                case '.roseday':
                    await reactSafe(sock, chatId, message.key, '🌹');
                    await rosedayCommand(sock, chatId, message);
                    break;

                case '.imagine':
                case '.flux':
                    await reactSafe(sock, chatId, message.key, '🎨');
                    await imagineCommand(sock, chatId, message);
                    break;

                case '.jid':
                    await reactSafe(sock, chatId, message.key, '🆔');
                    await groupJidCommand(sock, chatId, message);
                    break;

                case '.autotyping':
                    await reactSafe(sock, chatId, message.key, '✒️');
                    await autotypingCommand(sock, chatId, message);
                    break;

                case '.autorecording':
                    await reactSafe(sock, chatId, message.key, '🖲️');
                    await autorecordingCommand(sock, chatId, message);
                    break;

                case '.autoread':
                    await reactSafe(sock, chatId, message.key, '📄');
                    await autoreadCommand(sock, chatId, message);
                    break;

                case '.heart':
                    await reactSafe(sock, chatId, message.key, '💘');
                    await handleHeart(sock, chatId, message);
                    break;

                case '.crop':
                    await reactSafe(sock, chatId, message.key, '💖');
                    await stickercropCommand(sock, chatId, message);
                    break;

                case '.update': {
                    await reactSafe(sock, chatId, message.key, '💠');
                    const firstArg = argsText.split(/\s+/)[0] || '';
                    const zipArg = firstArg.startsWith('http') ? firstArg : '';
                    await updateCommand(sock, chatId, message, isPrivileged, zipArg);
                    break;
                }

                case '.removebg':
                case '.rmbg':
                case '.nobg':
                    await reactSafe(sock, chatId, message.key, '🔷');
                    await removebgCommand.exec(sock, message, argsText ? argsText.split(/\s+/) : []);
                    break;

                case '.remini':
                case '.enhance':
                case '.upscale':
                    await reactSafe(sock, chatId, message.key, '🈳');
                    await reminiCommand(sock, chatId, message, argsText ? argsText.split(/\s+/) : []);
                    break;

                case '.sora':
                    await reactSafe(sock, chatId, message.key, '🌐');
                    await soraCommand(sock, chatId, message);
                    break;

                default:
                    commandExecuted = false;
                    break;
            }
        }

        if (commandExecuted) {
            await showTypingAfterCommand(sock, chatId);
            await showRecordingAfterCommand(sock, chatId);
            await addCommandReaction(sock, message);
        }
    } catch (error) {
        console.error('❌ Error in message handler:', error?.message || error);
        if (chatId && sock && typeof sock.sendMessage === 'function') {
            try {
                await sock.sendMessage(chatId, { text: '❌ Failed to process command!', ...channelInfo });
            } catch (_) { }
        }
    }
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update || {};
        if (!id || !id.endsWith('@g.us')) return;

        let isPublic = true;
        try {
            if (!global.botModeCache) global.botModeCache = loadJsonFile(MESSAGE_COUNT_FILE, { isPublic: true });
            if (typeof global.botModeCache.isPublic === 'boolean') isPublic = global.botModeCache.isPublic;
        } catch (_) { }

        if (action === 'promote') {
            if (!isPublic) return;
            await handlePromotionEvent(sock, id, participants, author);
            return;
        }
        if (action === 'demote') {
            if (!isPublic) return;
            await handleDemotionEvent(sock, id, participants, author);
            return;
        }
        if (action === 'add') {
            await handleJoinEvent(sock, id, participants);
            return;
        }
        if (action === 'remove') {
            await handleLeaveEvent(sock, id, participants);
            return;
        }
    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error);
    }
}

module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus: async (sock, status) => {
        await handleStatusUpdate(sock, status);
    },
    trackBotSentId,
    resetAntiBanState: () => {
        processedIds.clear();
        console.log('🔄 Anti-ban: processedIds cleared for fresh session');
    }
};
