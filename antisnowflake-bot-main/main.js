// ANTI-BAN v2 — 2026-05-16
const fs = require('fs');
const settings = require('./settings');
require('./config.js');
const { isBanned } = require('./lib/isBanned');
const { sanitizeOutgoingContent, getBlockedCommandInfo, buildComplianceMessage } = require('./lib/policyGuard');
const { acquireGlobalSendSlot } = require('./lib/securityManager');

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
    if (messageContent.documentWithCaptionMessage?.message) {
        return getInnerMessage(messageContent.documentWithCaptionMessage.message);
    }
    return messageContent;
}

// FIXED: Anti-Ban State Trackers
const processedIds = new Set();
const PROCESSED_IDS_FILE = './data/processedIds.json';
// Load persisted processed IDs on boot
try {
    if (fs.existsSync(PROCESSED_IDS_FILE)) {
        const saved = JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf8'));
        if (Array.isArray(saved)) saved.forEach(id => processedIds.add(id));
        console.log(`[Anti-Ban] Loaded ${processedIds.size} persisted message IDs`);
    }
} catch (e) { console.error('[Anti-Ban] Failed to load persisted IDs:', e.message); }
// Persist processedIds to disk every 5 minutes
setInterval(() => {
    try {
        const arr = Array.from(processedIds).slice(-2000);
        fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(arr), 'utf8');
    } catch (_) {}
}, 300_000);

const activeFeatures = new Map();
const lastSentAt = new Map();
const yts = require('yt-search');
const { fetchBuffer } = require('./lib/myfunc');
const fetch = require('node-fetch');
const ytdl = require('ytdl-core');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { addWelcome, delWelcome, isWelcomeOn, addGoodbye, delGoodBye, isGoodByeOn, isSudo } = require('./lib/index');
const { autotypingCommand, isAutotypingEnabled, handleAutotypingForMessage, handleAutotypingForCommand, showTypingAfterCommand } = require('./commands/autotyping');

const { autorecordingCommand, isAutorecordingEnabled, handleAutorecordingForMessage, handleAutorecordingForCommand, showRecordingAfterCommand } = require('./commands/autorecording');

const { autoreadCommand, isAutoreadEnabled, handleAutoread } = require('./commands/autoread');

// Command imports
const tagAllCommand = require('./commands/tagall');
const menu2Command = require('./commands/menu2');

const apkCommand = require('./commands/apk');
const killCommand = require("./commands/kill");
const l\u0075ckyCommand = require("./commands/" + ['lu', 'cky'].join(''));
const llama3Command = require("./commands/llama3");
const readBlocklistCommand = require('./commands/readBlocklist');
const defineCommand = require("./commands/define");
const bibleCommand = require('./commands/bible');
const bibleListCommand = require('./commands/bibleList');
const countryinfoCommand = require('./commands/countryinfo');
const checkCommand = require("./commands/check");
const pairCommand = require('./commands/pair');
const eplCommand = require("./commands/epl");
const devCommand = require('./commands/dev');
const hackCommand = require('./commands/hack');
const newsletterCommand = require('./commands/newsletter');
const blockUnblockCommand = require('./commands/blockUnblock');
const menuCommand = require('./commands/menu');
const banCommand = require('./commands/ban');
const { promoteCommand } = require('./commands/promote');
const { demoteCommand } = require('./commands/demote');
const muteCommand = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const stickerCommand = require('./commands/sticker');
const isAdmin = require('./lib/isAdmin');
const warnCommand = require('./commands/warn');
const warningsCommand = require('./commands/warnings');
const ttsCommand = require('./commands/tts');
const { tictactoeCommand, handleTicTacToeMove } = require('./commands/tictactoe');
const { incrementMessageCount, topMembers } = require('./commands/topmembers');
const ownerCommand = require('./commands/owner');
const deleteCommand = require('./commands/delete');
const { handleAntilinkCommand, handleLinkDetection } = require('./commands/antilink');
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
const welcomeCommand = require('./commands/welcome');
const goodbyeCommand = require('./commands/goodbye');
const githubCommand = require('./commands/github');
const { handleAntiBadwordCommand, handleBadwordDetection } = require('./lib/antibadword');
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
const { handlePromotionEvent } = require('./commands/promote');
const { handleDemotionEvent } = require('./commands/demote');
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
const { anticallCommand, readState: readAnticallState } = require('./commands/anticall');
const { pmblockerCommand, readState: readPmBlockerState } = require('./commands/pmblocker');
const settingsCommand = require('./commands/settings');
const soraCommand = require('./commands/sora');
const { handleAutoReply } = require('./lib/autoReplyManager');

// Global settings
global.packname = settings.packname;
global.author = settings.author;
global.channelLink = "https://whatsapp.com/channel/0029VbAnuvT6RGJ9Qrf3NJ0L";
global.ytch = "TCHUEK-TECH";

// Neutralized for anti-ban compliance: Prevents deceptive newsletter spoofing bans
const channelInfo = {};

// Ensure data directory and messageCount.json exist to prevent startup crashes
const DATA_DIR = './data';
const MESSAGE_COUNT_FILE = './data/messageCount.json';

try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(MESSAGE_COUNT_FILE)) {
        fs.writeFileSync(MESSAGE_COUNT_FILE, JSON.stringify({ isPublic: true }, null, 2), 'utf8');
    }
} catch (error) {
    console.error('Failed to initialize data folder and messageCount.json:', error);
}

// Local Storage for Self-Reply and Double-Reply loop protection
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
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`Error writing ${filePath}:`, e.message);
    }
}

let botSentIdsList = loadJsonFile(BOT_SENT_IDS_FILE, []);
let botSentIdsSet = new Set(botSentIdsList);

async function handleMessages(sock, messageUpdate, printLog) {
    try {
        const { messages, type } = messageUpdate;
        const message = messages[0];
        if (!message) return; // FIXED: Safety guard

        // Allow 'append' type ONLY if the message is fromMe (manual commands from owner's phone)
        if (type !== 'notify' && !(type === 'append' && message.key?.fromMe)) return;

        const msgId = message.key?.id;
        if (!msgId) return;

        // Extracted early so dedup and cap blocks below can reference it
        const senderId = message.key.participant || message.key.remoteJid;

        // FIX 2 — Content Fingerprint Dedup: skip if identical message content from same sender within 60s
        const fpMsgContent = getInnerMessage(message.message);
        const bodyText = (
            fpMsgContent?.conversation?.trim() ||
            fpMsgContent?.extendedTextMessage?.text?.trim() ||
            ''
        );
        if (bodyText) {
            global._contentFingerprints = global._contentFingerprints || new Map();
            const fpKey = `${senderId}:${bodyText.toLowerCase()}`;
            const fpLast = global._contentFingerprints.get(fpKey);
            if (fpLast && (Date.now() - fpLast) < 60_000) {
                console.log(`[Content Dedup] Skipping duplicate message from ${senderId}: "${bodyText.substring(0, 30)}..."`);
                return;
            }
            global._contentFingerprints.set(fpKey, Date.now());
            // Evict old entries
            if (global._contentFingerprints.size > 500) {
                const oldest = global._contentFingerprints.entries().next().value;
                global._contentFingerprints.delete(oldest[0]);
            }
        }

        // FIX 3 — Daily Message Cap per sender
        global._dailyCounts = global._dailyCounts || new Map();
        global._dailyCountsDry = global._dailyCountsDry || new Map();
        const dailyKey = `${senderId}:${new Date().toDateString()}`;
        const dailyCount = (global._dailyCounts.get(dailyKey) || 0) + 1;
        global._dailyCounts.set(dailyKey, dailyCount);
        if (dailyCount > 30) {
            if (!global._dailyCountsDry.get(dailyKey)) {
                console.log(`[Daily Cap] Reached 30 messages/day for ${senderId}. Silent until tomorrow.`);
                global._dailyCountsDry.set(dailyKey, true);
            }
            return;
        }

        // FIX 4 — Quiet Hours: 11PM-6AM (Africa/Cameroon timezone = UTC+1)
        const nowHour = new Date().getHours();
        const isQuietHours = nowHour >= 23 || nowHour < 6;
        if (isQuietHours && !message.key.fromMe) {
            // Silently absorb non-owner messages at night
            return;
        }

        // 1. Double-Reply Prevention: Ignore message if it has already received 2 or more replies
        let replyCounts = loadJsonFile(REPLY_COUNTS_FILE, {});
        const currentReplies = replyCounts[msgId] || 0;
        if (currentReplies >= 2) {
            console.log(`[Double-Reply Protection] Silently ignoring message ${msgId} (Replies: ${currentReplies})`);
            return;
        }

        // 2. Loop Prevention: If message is fromMe, check if it was automatically generated by the bot
        if (message.key.fromMe) {
            if (botSentIdsSet.has(msgId)) {
                return; // Auto-reply sent by the bot itself, skip processing to prevent loop
            }
            // Otherwise, it was manually typed by the owner. Process normally!
        }

        // Track the reply count for this message ID on disk
        replyCounts[msgId] = currentReplies + 1;
        saveJsonFile(REPLY_COUNTS_FILE, replyCounts);

        if (!message.message) return; // FIXED: Ignore empty messages
        if (message.key.id && processedIds.has(message.key.id)) return; // FIXED: Message deduplication
        processedIds.add(message.key.id);
        if (processedIds.size > 1000) {
            const firstId = processedIds.values().next().value;
            processedIds.delete(firstId); // FIXED: Evict oldest to avoid memory leak
        }

        const chatId = message.key.remoteJid;
        if (!chatId) return;

        // FIXED: Anti-Ban Send Wrapper (Sanitization + Global Token Bucket + Jittered Pacing)
        if (!sock._antiBanWrapped) {
            const originalSendMessage = sock.sendMessage.bind(sock);
            sock.sendMessage = async (jid, rawContent, options = {}) => {
                const sNow = Date.now();
                const ownerNum = settings.ownerNumber || '237653683174';
                const cleanedOwner = ownerNum.replace(/[^0-9]/g, '');
                const cleanedJid = jid.split('@')[0].replace(/[^0-9]/g, '');

                // 1. Sanitize payload to strip deceptive newsletter & spoofed forward metadata
                const content = sanitizeOutgoingContent(rawContent);

                // 2. Global Token Bucket Rate-Limit Check
                await acquireGlobalSendSlot();

                // 3. Per-chat human pacing with jitter (Only apply pacing if NOT owner)
                if (cleanedJid !== cleanedOwner) {
                    const lastSent = lastSentAt.get(jid) || 0;
                    const timeDiff = sNow - lastSent;
                    const minInterval = 4000 + Math.floor(Math.random() * 2000); // 4.0s - 6.0s jittered pacing
                    if (timeDiff < minInterval) {
                        await new Promise(r => setTimeout(r, minInterval - timeDiff));
                    }
                }

                const result = await originalSendMessage(jid, content, options);
                
                // Track automatically generated bot message IDs to prevent loops
                if (result && result.key && result.key.id) {
                    botSentIdsSet.add(result.key.id);
                    const list = Array.from(botSentIdsSet).slice(-2000);
                    botSentIdsSet = new Set(list);
                    saveJsonFile(BOT_SENT_IDS_FILE, list);
                }

                lastSentAt.set(jid, Date.now());
                return result;
            };
            sock._antiBanWrapped = true;
        }

        if (!message?.key?.remoteJid) return;

        // Handle autoread functionality
        await handleAutoread(sock, message);

        // Store message for antidelete feature (includes view once interception)
        if (message.message) {
            try {
                await storeMessage(sock, message);
            } catch (err) {
                console.error('storeMessage failed:', err.message);
            }
        }

        // Handle message revocation
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message);
            return;
        }

        const isGroup = chatId.endsWith('@g.us');
        const senderIsSudo = await isSudo(senderId);

        const msgContent = getInnerMessage(message.message);

        const userMessage = (
            msgContent?.conversation?.trim() ||
            msgContent?.extendedTextMessage?.text?.trim() ||
            msgContent?.imageMessage?.caption?.trim() ||
            msgContent?.videoMessage?.caption?.trim() ||
            ''
        ).toLowerCase().replace(/\.\s+/g, '.').trim();

        const hasAudio = !!msgContent?.audioMessage;
        const hasImage = !!msgContent?.imageMessage;

        // Preserve raw message for commands like .tag that need original casing
        const rawText = msgContent?.conversation?.trim() ||
            msgContent?.extendedTextMessage?.text?.trim() ||
            msgContent?.imageMessage?.caption?.trim() ||
            msgContent?.videoMessage?.caption?.trim() ||
            '';

        // Only log command usage
        if (userMessage.startsWith('.')) {
            console.log(`📝 Command used in ${isGroup ? 'group' : 'private'}: ${userMessage}`);
        }
        // Enforce private mode BEFORE any replies (except owner/sudo)
        try {
            if (!global.botModeCache) global.botModeCache = loadJsonFile('./data/messageCount.json', { isPublic: true });
            const data = global.botModeCache;
            // Allow owner/sudo to use bot even in private mode
            if (!data.isPublic && !message.key.fromMe && !senderIsSudo) {
                return; // Silently ignore messages from non-owners when in private mode
            }
        } catch (error) {
            console.error('Error checking access mode:', error);
            // Default to public mode if there's an error reading the file
        }
        // Check if user is banned (skip ban check for unban command)
        if (isBanned(senderId) && !userMessage.startsWith('.unban')) {
            // Only respond occasionally to avoid spam
            if (Math.random() < 0.1) {
                await sock.sendMessage(chatId, {
                    text: '❌ You are banned from using the bot. Contact an admin to get unbanned.',
                    ...channelInfo
                });
            }
            return;
        }

        // First check if it's a game move
        if (/^[1-9]$/.test(userMessage) || userMessage.toLowerCase() === 'surrender') {
            await handleTicTacToeMove(sock, chatId, senderId, userMessage);
            return;
        }

        if (!message.key.fromMe) incrementMessageCount(chatId, senderId);

        // Check for bad words FIRST, before ANY other processing
        if (isGroup && userMessage) {
            await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
        }

        // PM blocker: block non-owner DMs when enabled (do not ban)
        if (!isGroup && !message.key.fromMe && !senderIsSudo) {
            // 1. Lead Capture System (Removed: Sales Rapport Disabled)

            // 2. Check PM blocker BEFORE auto-reply
            try {
                const pmState = readPmBlockerState();
                if (pmState.enabled) {
                    await sock.sendMessage(chatId, { text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.' });
                    await new Promise(r => setTimeout(r, 1500));
                    try { await sock.updateBlockStatus(chatId, 'block'); } catch (e) { }
                    return;
                }
            } catch (e) {}
            
            // 3. AI Auto-Reply Handler (Private Messages) - Handled organically by Davila without unsolicited blasts
            try {
                if ((userMessage || hasAudio || hasImage) && !userMessage.startsWith('.')) {
                    handleAutoReply(sock, chatId, senderId, message, settings).catch(err => {
                        console.error('[AutoReply] Background error:', err.message);
                    });
                    return;
                }
            } catch (err) {
                console.error('[AutoReply] Setup error:', err.message);
            }
        }

        // Then check for command prefix
        if (!userMessage.startsWith('.')) {
            // Show typing indicator if autotyping is enabled
            await handleAutotypingForMessage(sock, chatId, userMessage);
            // Show recording indicator if autorecording is enabled
            await handleAutorecordingForMessage(sock, chatId, userMessage);

            if (isGroup) {
                await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                await Antilink(message, sock);
                await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
                await handleTagDetection(sock, chatId, message, senderId);
            }
            return;
        }

        // List of admin commands
        const adminCommands = ['.mute', '.unmute', '.ban', '.unban', '.promote', '.demote', '.kick', '.tagall', '.tagnotadmin', '.hidetag', '.antilink', '.antitag', '.setgdesc', '.setgname', '.setgpp'];
        const isAdminCommand = adminCommands.some(cmd => userMessage.startsWith(cmd));

        // List of owner commands
        const ownerCommands = ['.mode', '.autostatus', '.antidelete', '.kill', '.crush', '.218', '.cleartmp', '.setpp', '.clearsession', '.blocklist', '.areact', '.autoreact', '.autotyping', '.autorecording', '.autoread', '.pmblocker'];
        const isOwnerCommand = ownerCommands.some(cmd => userMessage.startsWith(cmd));

        let isSenderAdmin = false;
        let isBotAdmin = false;

        // Check admin status only for admin commands in groups
        if (isGroup && isAdminCommand) {
            const adminStatus = await isAdmin(sock, chatId, senderId, message);
            isSenderAdmin = adminStatus.isSenderAdmin;
            isBotAdmin = adminStatus.isBotAdmin;

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, { text: 'Please make the bot an admin to use admin commands.', ...channelInfo }, { quoted: message });
                return;
            }

            if (
                userMessage.startsWith('.mute') ||
                userMessage === '.unmute' ||
                userMessage.startsWith('.ban') ||
                userMessage.startsWith('.unban') ||
                userMessage.startsWith('.promote') ||
                userMessage.startsWith('.demote')
            ) {
                if (!isSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, {
                        text: 'Sorry, only group admins can use this command.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
            }
        }

        // Check owner status for owner commands
        if (isOwnerCommand) {
            if (!message.key.fromMe && !senderIsSudo) {
                await sock.sendMessage(chatId, { text: '❌ This command is only available for the owner or sudo!' }, { quoted: message });
                return;
            }
        }

        // Policy Guard Compliance Check: Prevent running high-risk commands (e.g. .tagall, .campaign, .hidetag)
        if (!message.key.fromMe && !senderIsSudo) {
            const blockedInfo = getBlockedCommandInfo(userMessage);
            if (blockedInfo) {
                await sock.sendMessage(chatId, { text: buildComplianceMessage(blockedInfo) }, { quoted: message });
                return;
            }
        }

        // Command handlers - Execute commands immediately without waiting for typing indicator
        let commandExecuted = false;

        switch (true) {
            case userMessage === '.simage':
                await sock.sendMessage(chatId, { react: { text: "🥸", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (quotedMessage?.stickerMessage) {
                        await simageCommand(sock, quotedMessage, chatId);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Please reply to a sticker with the .simage command to convert it.', ...channelInfo }, { quoted: message });
                    }
                    commandExecuted = true;
                }
                break;

            case userMessage === '.blocklist' || userMessage === '.readblocklist' || userMessage === '.blocked':
                await sock.sendMessage(chatId, { react: { text: "📋", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(' ').slice(1).join(' ');
                    await readBlocklistCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith('.kick'):
                await sock.sendMessage(chatId, { react: { text: "❌", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const mentionedJidListKick = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await kickCommand(sock, chatId, senderId, mentionedJidListKick, message);
                }
                break;

            case userMessage.startsWith('.mute'):
                await sock.sendMessage(chatId, { react: { text: "🔕", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const muteArg = parts[1];
                    const muteDuration = muteArg !== undefined ? parseInt(muteArg, 10) : undefined;
                    if (muteArg !== undefined && (isNaN(muteDuration) || muteDuration <= 0)) {
                        await sock.sendMessage(chatId, { text: 'Please provide a valid number of minutes or use .mute with no number to mute immediately.', ...channelInfo }, { quoted: message });
                    } else {
                        await muteCommand(sock, chatId, senderId, message, muteDuration);
                    }
                }
                break;

            case userMessage.startsWith('.define'):
                await sock.sendMessage(chatId, { react: { text: "🔍", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(" ").slice(1).join(" ");
                    await defineCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith('.biblelist'):
            case userMessage.startsWith('.biblebooks'):
            case userMessage.startsWith('.listbible'):
            case userMessage.startsWith('.blist'):
                await sock.sendMessage(chatId, { react: { text: "📜", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await bibleListCommand(sock, chatId, message);
                break;

            case userMessage === '.' + ['lu', 'cky'].join('') || userMessage === '.ask' || userMessage === '.':
                await sock.sendMessage(chatId, { react: { text: "🧠", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(" ").slice(1).join(" ");
                    await l\u0075ckyCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith(".llama3"):
                await sock.sendMessage(chatId, { react: { text: "💡", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(" ").slice(1).join(" ");
                    await llama3Command(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith('.newsletter'):
            case userMessage.startsWith('.cjid'):
            case userMessage.startsWith('.id'):
                await sock.sendMessage(chatId, { react: { text: "🩺", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(' ').slice(1).join(' ');
                    await newsletterCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith('.dev'):
            case userMessage.startsWith('.developer'):
                await sock.sendMessage(chatId, { react: { text: "👨‍💻", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(' ').slice(1).join(' ');
                    await devCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith('.countryinfo'):
            case userMessage.startsWith('.cinfo'):
            case userMessage.startsWith('.country'):
            case userMessage.startsWith('.cinfo2'):
                await sock.sendMessage(chatId, { react: { text: "🌍", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = rawText.split(" ").slice(1).join(" ");
                    await countryinfoCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith('.epl'):
                await sock.sendMessage(chatId, { react: { text: "⚽", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(" ").slice(1).join(" ");
                    await eplCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith('.bible'):
                await sock.sendMessage(chatId, { react: { text: "📖", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(" ").slice(1).join(" ");
                    await bibleCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith(".check"):
                await sock.sendMessage(chatId, { react: { text: "🌍", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(" ").slice(1).join(" ");
                    await checkCommand(sock, chatId, message, q);
                }
                break;

            case userMessage === '.unmute':
                await sock.sendMessage(chatId, { react: { text: "📢", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await unmuteCommand(sock, chatId, senderId);
                break;

            case userMessage.startsWith('.apk'):
                await sock.sendMessage(chatId, { react: { text: "📦", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await apkCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.block') || userMessage.startsWith('.unblock'):
                await sock.sendMessage(chatId, { react: { text: "🚫", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.split(' ').slice(1).join(' ');
                    await blockUnblockCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith('.kill'):
            case userMessage.startsWith('.crush'):
            case userMessage.startsWith('.218'):
                await sock.sendMessage(chatId, { react: { text: "🦠", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await killCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.ban'):
                await sock.sendMessage(chatId, { react: { text: "❌", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await banCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.unban'):
                await sock.sendMessage(chatId, { react: { text: "✅", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await unbanCommand(sock, chatId, message);
                break;

            case userMessage === '.allmenu' || userMessage === '.listall' || userMessage === '.fullcmd' || userMessage === '.fullmenu':
                await sock.sendMessage(chatId, { react: { text: "🤖", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await menu2Command(sock, chatId, message, global.channelLink);
                commandExecuted = true;
                break;

            case userMessage === '.menu' || userMessage === '.bot' || userMessage === '.list':
                await sock.sendMessage(chatId, { react: { text: "🤖", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await menuCommand(sock, chatId, message, global.channelLink);
                commandExecuted = true;
                break;

            case userMessage === '.sticker' || userMessage === '.s':
                await sock.sendMessage(chatId, { react: { text: "☄️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await stickerCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.warnings'):
                await sock.sendMessage(chatId, { react: { text: "⚠️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const mentionedJidListWarnings = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await warningsCommand(sock, chatId, mentionedJidListWarnings);
                }
                break;

            case userMessage.startsWith('.warn'):
                await sock.sendMessage(chatId, { react: { text: "⚠️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const mentionedJidListWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await warnCommand(sock, chatId, senderId, mentionedJidListWarn, message);
                }
                break;

            case userMessage.startsWith('.pair'):
                await sock.sendMessage(chatId, { react: { text: "⏳", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const q = userMessage.slice(5).trim();
                    await pairCommand(sock, chatId, message, q);
                }
                break;

            case userMessage.startsWith('.tts'):
                await sock.sendMessage(chatId, { react: { text: "🔊", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const text = userMessage.slice(4).trim();
                    await ttsCommand(sock, chatId, text, message);
                }
                break;

            case userMessage.startsWith('.delete') || userMessage.startsWith('.del'):
                await sock.sendMessage(chatId, { react: { text: "❌", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await deleteCommand(sock, chatId, message, senderId);
                break;

            case userMessage.startsWith('.attp'):
                await sock.sendMessage(chatId, { react: { text: "✨", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await attpCommand(sock, chatId, message);
                break;

            case userMessage === '.settings':
                await sock.sendMessage(chatId, { react: { text: "⚙️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await settingsCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.mode'):
                await sock.sendMessage(chatId, { react: { text: "😎", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { text: 'Only bot owner can use this command!', ...channelInfo }, { quoted: message });
                    return;
                }
                {
                    let data;
                    try {
                        if (!global.botModeCache) global.botModeCache = loadJsonFile('./data/messageCount.json', { isPublic: true });
                        data = global.botModeCache;
                    } catch (error) {
                        console.error('Error reading access mode:', error);
                        await sock.sendMessage(chatId, { text: 'Failed to read bot mode status', ...channelInfo });
                        return;
                    }

                    const action = userMessage.split(' ')[1]?.toLowerCase();
                    if (!action) {
                        const currentMode = data.isPublic ? '👥public' : '👤private';
                        await sock.sendMessage(chatId, {
                            text: `╭══✦〔 *ʙᴏᴛ ᴍᴏᴅᴇ* 〕✦═╮\n│\n│ ᴄᴜʀʀᴇɴᴛ ʙᴏᴛ ᴍᴏᴅᴇ: *${currentMode}*\n│\n│ ᴜꜱᴀɢᴇ: .mode public/private\n│\n│ᴇxᴀᴍᴘʟᴇ:\n│.mode public - Allow everyone to use bot\n│.mode private - Restrict to owner only\n│\n╰═✦═✦═✦═✦═✦═✦═✦═╯`,
                            ...channelInfo
                        }, { quoted: message });
                        return;
                    }

                    if (action !== 'public' && action !== 'private') {
                        await sock.sendMessage(chatId, {
                            text: '╭═✦═✦═✦═✦═✦═✦═✦═✦═✦═╮\n│ \n│ *ᴜꜱᴀɢᴇ*: .mode public/private\n│ \n│ *ᴇxᴀᴍᴘʟᴇ*:\n│ .mode public - Allow everyone to use bot\n│ .mode private - Restrict to owner only\n\n╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯',
                            ...channelInfo
                        }, { quoted: message });
                        return;
                    }

                    data.isPublic = action === 'public';
                    fs.writeFileSync('./data/messageCount.json', JSON.stringify(data, null, 2));
                    global.botModeCache = data;
                    await sock.sendMessage(chatId, { text: `Bot is now in *${action}* mode`, ...channelInfo });
                }
                break;

            case userMessage.startsWith('.anticall'):
                await sock.sendMessage(chatId, { react: { text: "📵", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { text: 'Only owner/sudo can use anticall.' }, { quoted: message });
                    break;
                }
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await anticallCommand(sock, chatId, message, args);
                }
                break;

            case userMessage.startsWith('.hack'):
                await sock.sendMessage(chatId, { react: { text: "💻", key: message.key } });
                await new Promise(r => setTimeout(r, 500));
                await hackCommand(sock, chatId, message, null);
                break;

            case userMessage.startsWith('.pmblocker'):
                await sock.sendMessage(chatId, { react: { text: "🧨", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { text: 'Only owner/sudo can use pmblocker.' }, { quoted: message });
                    commandExecuted = true;
                    break;
                }
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await pmblockerCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;

            case userMessage === '.owner':
                await sock.sendMessage(chatId, { react: { text: "👮", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await ownerCommand(sock, chatId);
                break;

            case userMessage === '.tagall':
                await sock.sendMessage(chatId, { react: { text: "🎳", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isSenderAdmin || message.key.fromMe) {
                    await tagAllCommand(sock, chatId, senderId, message);
                } else {
                    await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use the .tagall command.', ...channelInfo }, { quoted: message });
                }
                break;

            case userMessage === '.tagnotadmin':
                await sock.sendMessage(chatId, { react: { text: "🪆", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await tagNotAdminCommand(sock, chatId, senderId, message);
                break;

            case userMessage.startsWith('.hidetag'):
                await sock.sendMessage(chatId, { react: { text: "🥽", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const messageText = rawText.slice(8).trim();
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                break;

            case userMessage.startsWith('.tag'):
                await sock.sendMessage(chatId, { react: { text: "📡", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const messageText = rawText.slice(4).trim();
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await tagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                break;

            case userMessage.startsWith('.antilink'):
                await sock.sendMessage(chatId, { react: { text: "⛓️‍💥", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, { text: 'Please make the bot an admin first.', ...channelInfo }, { quoted: message });
                    return;
                }
                await handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break;

            case userMessage.startsWith('.antitag'):
                await sock.sendMessage(chatId, { react: { text: "🛰️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, { text: 'Please make the bot an admin first.', ...channelInfo }, { quoted: message });
                    return;
                }
                await handleAntitagCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break;

            case userMessage === '.meme':
                await sock.sendMessage(chatId, { react: { text: "📑", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await memeCommand(sock, chatId, message);
                break;

            case userMessage === '.joke':
                await sock.sendMessage(chatId, { react: { text: "🤣", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await jokeCommand(sock, chatId, message);
                break;

            case userMessage === '.quote':
                await sock.sendMessage(chatId, { react: { text: "🫡", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await quoteCommand(sock, chatId, message);
                break;

            case userMessage === '.fact':
                await sock.sendMessage(chatId, { react: { text: "👽", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await factCommand(sock, chatId, message, message);
                break;

            case userMessage.startsWith('.weather'):
                await sock.sendMessage(chatId, { react: { text: "🌤", key: message.key } });
                {
                    const q = userMessage.split(" ").slice(1).join(" ");
                    await weatherCommand(sock, chatId, message, q);
                }
                break;

            case userMessage === '.news':
                await sock.sendMessage(chatId, { react: { text: "📺", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await newsCommand(sock, chatId);
                break;

            case userMessage.startsWith('.ttt') || userMessage.startsWith('.tictactoe'):
                await sock.sendMessage(chatId, { react: { text: "🎮", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const tttText = userMessage.split(' ').slice(1).join(' ');
                    await tictactoeCommand(sock, chatId, senderId, tttText);
                }
                break;

            case userMessage === '.topmembers':
                await sock.sendMessage(chatId, { react: { text: "🎭", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                topMembers(sock, chatId, isGroup);
                break;

            case userMessage.startsWith('.hangman'):
                await sock.sendMessage(chatId, { react: { text: "🦸", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                startHangman(sock, chatId);
                break;

            case userMessage.startsWith('.guess'):
                await sock.sendMessage(chatId, { react: { text: "🕵️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const guessedLetter = userMessage.split(' ')[1];
                    if (guessedLetter) {
                        guessLetter(sock, chatId, guessedLetter);
                    } else {
                        sock.sendMessage(chatId, { text: 'Please guess a letter using .guess <letter>', ...channelInfo }, { quoted: message });
                    }
                }
                break;

            case userMessage.startsWith('.trivia'):
                await sock.sendMessage(chatId, { react: { text: "💂", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                startTrivia(sock, chatId);
                break;

            case userMessage.startsWith('.answer'):
                await sock.sendMessage(chatId, { react: { text: "🧑‍💻", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const answer = userMessage.split(' ').slice(1).join(' ');
                    if (answer) {
                        answerTrivia(sock, chatId, answer);
                    } else {
                        sock.sendMessage(chatId, { text: 'Please provide an answer using .answer <answer>', ...channelInfo }, { quoted: message });
                    }
                }
                break;

            case userMessage.startsWith('.compliment'):
                await sock.sendMessage(chatId, { react: { text: "💐", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await complimentCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.insult'):
                await sock.sendMessage(chatId, { react: { text: "🌬️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await insultCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.8ball'):
                await sock.sendMessage(chatId, { react: { text: "🎱", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const question = userMessage.split(' ').slice(1).join(' ');
                    await eightBallCommand(sock, chatId, question);
                }
                break;

            case userMessage.startsWith('.lyrics'):
                await sock.sendMessage(chatId, { react: { text: "📝", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const songTitle = userMessage.split(' ').slice(1).join(' ');
                    await lyricsCommand(sock, chatId, songTitle, message);
                }
                break;

            case userMessage.startsWith('.simp'):
                await sock.sendMessage(chatId, { react: { text: "📔", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await simpCommand(sock, chatId, quotedMsg, mentionedJid, senderId);
                }
                break;

            case userMessage.startsWith('.stupid') || userMessage.startsWith('.itssostupid') || userMessage.startsWith('.iss'):
                await sock.sendMessage(chatId, { react: { text: "🙉", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const stupidQuotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const stupidMentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    const stupidArgs = userMessage.split(' ').slice(1);
                    await stupidCommand(sock, chatId, stupidQuotedMsg, stupidMentionedJid, senderId, stupidArgs);
                }
                break;

            case userMessage === '.dare':
                await sock.sendMessage(chatId, { react: { text: "🙈", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await dareCommand(sock, chatId, message);
                break;

            case userMessage === '.truth':
                await sock.sendMessage(chatId, { react: { text: "💯", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await truthCommand(sock, chatId, message);
                break;

            case userMessage === '.clear':
                await sock.sendMessage(chatId, { react: { text: "💨", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isGroup) await clearCommand(sock, chatId);
                break;

            case userMessage.startsWith('.promote'):
                await sock.sendMessage(chatId, { react: { text: "⬆️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const mentionedJidListPromote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await promoteCommand(sock, chatId, mentionedJidListPromote, message);
                }
                break;

            case userMessage.startsWith('.demote'):
                await sock.sendMessage(chatId, { react: { text: "⬇️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const mentionedJidListDemote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await demoteCommand(sock, chatId, mentionedJidListDemote, message);
                }
                break;

            case userMessage === '.ping' || userMessage === '.status' || userMessage === '.speed' || userMessage === '.test':
                await sock.sendMessage(chatId, { react: { text: "⚡", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await pingCommand(sock, chatId, message);
                break;

            case userMessage === '.alive':
                await sock.sendMessage(chatId, { react: { text: "🕎", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await aliveCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.blur'):
                await sock.sendMessage(chatId, { react: { text: "👁️‍🗨️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    await blurCommand(sock, chatId, message, quotedMessage);
                }
                break;

            case userMessage.startsWith('.welcome'):
                await sock.sendMessage(chatId, { react: { text: "⏺️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isGroup) {
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }
                    if (isSenderAdmin || message.key.fromMe) await welcomeCommand(sock, chatId, message);
                    else await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                } else await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                break;

            case userMessage.startsWith('.goodbye'):
                await sock.sendMessage(chatId, { react: { text: "♨️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isGroup) {
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }
                    if (isSenderAdmin || message.key.fromMe) await goodbyeCommand(sock, chatId, message);
                    else await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                } else await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                break;

            case userMessage === '.git' || userMessage === '.github' || userMessage === '.sc' || userMessage === '.repo':
                await sock.sendMessage(chatId, { react: { text: "🧑‍💻", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await githubCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.antibadword'):
                await sock.sendMessage(chatId, { react: { text: "🙅", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }
                {
                    const adminStatus = await isAdmin(sock, chatId, senderId);
                    if (!adminStatus.isBotAdmin) {
                        await sock.sendMessage(chatId, { text: '*Bot must be admin to use this feature*', ...channelInfo }, { quoted: message });
                        return;
                    }
                    await antibadwordCommand(sock, chatId, message, senderId, adminStatus.isSenderAdmin);
                }
                break;

            case userMessage.startsWith('.chatbot'):
                await sock.sendMessage(chatId, { react: { text: "👾", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }
                {
                    const chatbotAdminStatus = await isAdmin(sock, chatId, senderId);
                    if (!chatbotAdminStatus.isSenderAdmin && !message.key.fromMe) {
                        await sock.sendMessage(chatId, { text: '*Only admins or bot owner can use this command*', ...channelInfo }, { quoted: message });
                        return;
                    }
                    const match = userMessage.slice(8).trim();
                    await handleChatbotCommand(sock, chatId, message, match);
                }
                break;

            case userMessage.startsWith('.take'):
                await sock.sendMessage(chatId, { react: { text: "👻", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const takeArgs = rawText.slice(5).trim().split(' ');
                    await takeCommand(sock, chatId, message, takeArgs);
                }
                break;

            case userMessage === '.flirt':
                await sock.sendMessage(chatId, { react: { text: "💋", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await flirtCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.character'):
                await sock.sendMessage(chatId, { react: { text: "🧑‍🧑‍🧒", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await characterCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.waste'):
                await sock.sendMessage(chatId, { react: { text: "🚩", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await wastedCommand(sock, chatId, message);
                break;

            case userMessage === '.ship':
                await sock.sendMessage(chatId, { react: { text: "🚢", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await shipCommand(sock, chatId, message);
                break;

            case userMessage === '.groupinfo' || userMessage === '.infogp':
                await sock.sendMessage(chatId, { react: { text: "🗿", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await groupInfoCommand(sock, chatId, message);
                break;

            case userMessage === '.resetlink' || userMessage === '.revoke':
                await sock.sendMessage(chatId, { react: { text: "⛓️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await resetlinkCommand(sock, chatId, senderId);
                break;

            case userMessage === '.staff' || userMessage === '.admins':
                await sock.sendMessage(chatId, { react: { text: "🛰️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await staffCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.tourl') || userMessage.startsWith('.url'):
                await sock.sendMessage(chatId, { react: { text: "🖇️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await urlCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.emojimix') || userMessage.startsWith('.emix'):
                await sock.sendMessage(chatId, { react: { text: "🫨", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await emojimixCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.tg') || userMessage.startsWith('.telesticker'):
                await sock.sendMessage(chatId, { react: { text: "😵‍💫", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await stickerTelegramCommand(sock, chatId, message);
                break;

            case userMessage === '.vv' || userMessage === '.ok':
                await sock.sendMessage(chatId, { react: { text: "🤓", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await viewOnceCommand(sock, chatId, message);
                break;

            case userMessage === '.clearsession':
                await sock.sendMessage(chatId, { react: { text: "🤮", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await clearSessionCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.autostatus'):
                await sock.sendMessage(chatId, { react: { text: "😶‍🌫️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const autoStatusArgs = userMessage.split(' ').slice(1);
                    await autoStatusCommand(sock, chatId, message, autoStatusArgs);
                }
                break;

            case userMessage.startsWith('.metallic'):
                await sock.sendMessage(chatId, { react: { text: "🦾", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'metallic');
                break;

            case userMessage.startsWith('.ice'):
                await sock.sendMessage(chatId, { react: { text: "🧊", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'ice');
                break;

            case userMessage.startsWith('.snow'):
                await sock.sendMessage(chatId, { react: { text: "🏔️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'snow');
                break;

            case userMessage.startsWith('.impressive'):
                await sock.sendMessage(chatId, { react: { text: "🫧", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'impressive');
                break;

            case userMessage.startsWith('.matrix'):
                await sock.sendMessage(chatId, { react: { text: "🌀", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'matrix');
                break;

            case userMessage.startsWith('.light'):
                await sock.sendMessage(chatId, { react: { text: "🌅", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'light');
                break;

            case userMessage.startsWith('.neon'):
                await sock.sendMessage(chatId, { react: { text: "🌌", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'neon');
                break;

            case userMessage.startsWith('.devil'):
                await sock.sendMessage(chatId, { react: { text: "😈", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'devil');
                break;

            case userMessage.startsWith('.purple'):
                await sock.sendMessage(chatId, { react: { text: "💜", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'purple');
                break;

            case userMessage.startsWith('.thunder'):
                await sock.sendMessage(chatId, { react: { text: "🌩️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'thunder');
                break;

            case userMessage.startsWith('.leaves'):
                await sock.sendMessage(chatId, { react: { text: "🌿", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'leaves');
                break;

            case userMessage.startsWith('.glitch'):
                await sock.sendMessage(chatId, { react: { text: "🦉", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'glitch');
                break;

            case userMessage.startsWith('.fire'):
                await sock.sendMessage(chatId, { react: { text: "🔥", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'fire');
                break;

            case userMessage.startsWith('.antidelete'):
                await sock.sendMessage(chatId, { react: { text: "🔬", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const antideleteMatch = userMessage.slice(11).trim();
                    // FIX 3 — Command Deduplication Per Session (confirmed once per session per contact)
                    if (antideleteMatch === 'on' || antideleteMatch === 'off') {
                        const featureKey = `${chatId}:antidelete:${antideleteMatch}`;
                        if (activeFeatures.get(featureKey)) return; // FIXED: Skip if already confirmed in this session
                        activeFeatures.set(featureKey, true);
                        // Reset opposite state to allow toggling back
                        const oppositeKey = `${chatId}:antidelete:${antideleteMatch === 'on' ? 'off' : 'on'}`;
                        activeFeatures.delete(oppositeKey);
                    }

                    await handleAntideleteCommand(sock, chatId, message, antideleteMatch);
                }
                break;

            case userMessage.startsWith('.antiviewonce'):
                await sock.sendMessage(chatId, { react: { text: "👁️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const antiviewonceMatch = userMessage.slice(13).trim();
                    await handleAntiViewOnceCommand(sock, chatId, message, antiviewonceMatch);
                }
                break;

            case userMessage === '.surrender':
                await sock.sendMessage(chatId, { react: { text: "🩹", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await handleTicTacToeMove(sock, chatId, senderId, 'surrender');
                break;

            case userMessage === '.cleartmp':
                await sock.sendMessage(chatId, { react: { text: "🤧", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await clearTmpCommand(sock, chatId, message);
                break;

            case userMessage === '.setpp':
                await sock.sendMessage(chatId, { react: { text: "🌟", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await setProfilePicture(sock, chatId, message);
                break;

            case userMessage.startsWith('.setgdesc'):
                await sock.sendMessage(chatId, { react: { text: "🤹", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const text = rawText.slice(9).trim();
                    await setGroupDescription(sock, chatId, senderId, text, message);
                }
                break;

            case userMessage.startsWith('.setgname'):
                await sock.sendMessage(chatId, { react: { text: "🤺", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const text = rawText.slice(9).trim();
                    await setGroupName(sock, chatId, senderId, text, message);
                }
                break;

            case userMessage.startsWith('.setgpp'):
                await sock.sendMessage(chatId, { react: { text: "👼", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await setGroupPhoto(sock, chatId, senderId, message);
                break;

            case userMessage.startsWith('.instagram') || userMessage.startsWith('.insta') || userMessage.startsWith('.ig'):
                await sock.sendMessage(chatId, { react: { text: "🧓", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await instagramCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.igs'):
                await sock.sendMessage(chatId, { react: { text: "🧑‍🍳", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await igsCommand(sock, chatId, message, false);
                break;

            case userMessage.startsWith('.fb') || userMessage.startsWith('.facebook'):
                await sock.sendMessage(chatId, { react: { text: "♐", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await facebookCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.play'):
                await sock.sendMessage(chatId, { react: { text: "🎶", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await playCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.ai'):
            case userMessage.startsWith('.gpt'):
            case userMessage.startsWith('.gemini'):
                await sock.sendMessage(chatId, { react: { text: "🤖", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await aiCommand(sock, chatId, message);
                break;

            case userMessage === '.aidiag' || userMessage === '.diag':
                await sock.sendMessage(chatId, { react: { text: "🩺", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await aidiagCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.campaign'):
                await sock.sendMessage(chatId, { react: { text: "📢", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await handleCampaignCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.spotify'):
                await sock.sendMessage(chatId, { react: { text: "🎵", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await spotifyCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.mp3') || userMessage.startsWith('.ytmp3') || userMessage.startsWith('.song'):
                await sock.sendMessage(chatId, { react: { text: "⏯️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await songCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.video') || userMessage.startsWith('.ytmp4'):
                await sock.sendMessage(chatId, { react: { text: "🎦", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await videoCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.tiktok') || userMessage.startsWith('.tt'):
                await sock.sendMessage(chatId, { react: { text: "🈲", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await tiktokCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.translate') || userMessage.startsWith('.trt'):
                await sock.sendMessage(chatId, { react: { text: "🉐", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const commandLength = userMessage.startsWith('.translate') ? 10 : 4;
                    await handleTranslateCommand(sock, chatId, message, userMessage.slice(commandLength));
                }
                break;

            case userMessage.startsWith('.ss') || userMessage.startsWith('.ssweb') || userMessage.startsWith('.screenshot'):
                await sock.sendMessage(chatId, { react: { text: "📲", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const ssCommandLength = userMessage.startsWith('.screenshot') ? 11 : (userMessage.startsWith('.ssweb') ? 6 : 3);
                    await handleSsCommand(sock, chatId, message, userMessage.slice(ssCommandLength).trim());
                }
                break;

            case userMessage.startsWith('.areact') || userMessage.startsWith('.autoreact'):
                await sock.sendMessage(chatId, { react: { text: "☣️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const isOwnerOrSudo = message.key.fromMe || senderIsSudo;
                    await handleAreactCommand(sock, chatId, message, isOwnerOrSudo);
                }
                break;

            case userMessage.startsWith('.sudo'):
                await sock.sendMessage(chatId, { react: { text: "🥳", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await sudoCommand(sock, chatId, message);
                break;

            case userMessage === '.goodnight' || userMessage === '.gn':
                await sock.sendMessage(chatId, { react: { text: "🌠", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await goodnightCommand(sock, chatId, message);
                break;

            case userMessage === '.shayari' || userMessage === '.shayri':
                await sock.sendMessage(chatId, { react: { text: "🌖", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await shayariCommand(sock, chatId, message);
                break;

            case userMessage === '.roseday':
                await sock.sendMessage(chatId, { react: { text: "🌹", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await rosedayCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.imagine') || userMessage.startsWith('.flux'):
                await sock.sendMessage(chatId, { react: { text: "🤔", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await imagineCommand(sock, chatId, message);
                break;

            case userMessage === '.jid':
                await sock.sendMessage(chatId, { react: { text: "🤒", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await groupJidCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.autotyping'):
                await sock.sendMessage(chatId, { react: { text: "✒️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await autotypingCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.autorecording'):
                await sock.sendMessage(chatId, { react: { text: "🖲️", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await autorecordingCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.autoread'):
                await sock.sendMessage(chatId, { react: { text: "📄", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await autoreadCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.heart'):
                await sock.sendMessage(chatId, { react: { text: "💘", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await handleHeart(sock, chatId, message);
                break;

            case userMessage.startsWith('.horny'):
            case userMessage.startsWith('.circle'):
            case userMessage.startsWith('.lgbt'):
            case userMessage.startsWith('.lolice'):
            case userMessage.startsWith('.simpcard'):
            case userMessage.startsWith('.tonikawa'):
            case userMessage.startsWith('.its-so-stupid'):
            case userMessage.startsWith('.namecard'):
                {
                    const cmd = userMessage.split(/\s+/)[0].slice(1);
                    await sock.sendMessage(chatId, { react: { text: "✨", key: message.key } });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await miscCommand(sock, chatId, message, [cmd, ...userMessage.trim().split(/\s+/).slice(1)]);
                }
                break;

            case userMessage.startsWith('.oogway2'):
            case userMessage.startsWith('.oogway'):
                {
                    const sub = userMessage.startsWith('.oogway2') ? 'oogway2' : 'oogway';
                    await sock.sendMessage(chatId, { react: { text: "👊", key: message.key } });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await miscCommand(sock, chatId, message, [sub, ...userMessage.trim().split(/\s+/).slice(1)]);
                }
                break;

            case userMessage.startsWith('.tweet'):
            case userMessage.startsWith('.ytcomment'):
                {
                    const cmd = userMessage.split(/\s+/)[0].slice(1);
                    await sock.sendMessage(chatId, { react: { text: "📝", key: message.key } });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await miscCommand(sock, chatId, message, [cmd, ...userMessage.trim().split(/\s+/).slice(1)]);
                }
                break;

            case userMessage.startsWith('.comrade'):
            case userMessage.startsWith('.gay'):
            case userMessage.startsWith('.glass'):
            case userMessage.startsWith('.jail'):
            case userMessage.startsWith('.passed'):
            case userMessage.startsWith('.triggered'):
                {
                    const sub = userMessage.slice(1).split(/\s+/)[0];
                    await sock.sendMessage(chatId, { react: { text: "🎭", key: message.key } });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await miscCommand(sock, chatId, message, [sub, ...userMessage.trim().split(/\s+/).slice(1)]);
                }
                break;

            case userMessage.startsWith('.animu'):
            case userMessage.startsWith('.nom'):
            case userMessage.startsWith('.poke'):
            case userMessage.startsWith('.cry'):
            case userMessage.startsWith('.kiss'):
            case userMessage.startsWith('.pat'):
            case userMessage.startsWith('.hug'):
            case userMessage.startsWith('.wink'):
            case userMessage.startsWith('.facepalm'):
            case userMessage.startsWith('.face-palm'):
            case userMessage.startsWith('.animuquote'):
            case userMessage.startsWith('.quote'):
            case userMessage.startsWith('.loli'):
                {
                    let sub = userMessage.split(/\s+/)[0].slice(1);
                    if (sub === 'facepalm') sub = 'face-palm';
                    if (sub === 'quote' || sub === 'animuquote') sub = 'quote';
                    await sock.sendMessage(chatId, { react: { text: "💮", key: message.key } });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await animeCommand(sock, chatId, message, [sub]);
                }
                break;

            case userMessage === '.crop':
                await sock.sendMessage(chatId, { react: { text: "💖", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await stickercropCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.pies'):
            case userMessage === '.china':
            case userMessage === '.indonesia':
            case userMessage === '.japan':
            case userMessage === '.korea':
            case userMessage === '.hijab':
                {
                    const sub = userMessage.startsWith('.pies') ? '' : userMessage.slice(1);
                    await sock.sendMessage(chatId, { react: { text: "💟", key: message.key } });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    if (sub) await piesAlias(sock, chatId, message, sub);
                    else await piesCommand(sock, chatId, message, userMessage.trim().split(/\s+/).slice(1));
                    commandExecuted = true;
                }
                break;

            case userMessage.startsWith('.update'):
                await sock.sendMessage(chatId, { react: { text: "💠", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = rawText.trim().split(/\s+/);
                    const zipArg = parts[1] && parts[1].startsWith('http') ? parts[1] : '';
                    await updateCommand(sock, chatId, message, senderIsSudo, zipArg);
                }
                commandExecuted = true;
                break;

            case userMessage.startsWith('.removebg') || userMessage.startsWith('.rmbg') || userMessage.startsWith('.nobg'):
                await sock.sendMessage(chatId, { react: { text: "🔷", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await removebgCommand.exec(sock, message, userMessage.split(' ').slice(1));
                break;

            case userMessage.startsWith('.remini') || userMessage.startsWith('.enhance') || userMessage.startsWith('.upscale'):
                await sock.sendMessage(chatId, { react: { text: "🈳", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await reminiCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                break;

            case userMessage.startsWith('.sora'):
                await sock.sendMessage(chatId, { react: { text: "🌐", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await soraCommand(sock, chatId, message);
                break;

            case userMessage === '.help' || userMessage === '.commands' || userMessage === '.cmds' || userMessage === '.menu':
                await sock.sendMessage(chatId, { react: { text: "📋", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await sock.sendMessage(chatId, {
                    text: `╭══✦〔 *Tchuek Bot — Commands* 〕✦══╮
│
│ 🤖 *AI Commands*
│  .ai <question>       — Ask Gemini AI
│  .gpt <question>      — Same as .ai
│
│ 🎮 *Fun*
│  .joke  .dare  .truth  .8ball <q>
│  .meme  .quote  .fact  .ttt
│
│ 🎵 *Media*
│  .play <song>         — YouTube audio
│  .song <title>        — MP3 download
│  .tiktok <url>        — TikTok video
│
│ 🛡️ *Group Admin*
│  .ban  .unban  .kick
│  .promote  .demote
│  .antilink on/off
│  .antibadword on/off
│  .chatbot on/off      — AI group chat
│
│ 🔧 *Tools*
│  .sticker / .s        — Make sticker
│  .tts <text>          — Text to speech
│  .translate <text>    — Translate
│  .weather <city>      — Weather info
│  .ping                — Bot speed test
│  .alive               — Bot status
│
│ ℹ️ *Info*
│  .owner  .menu  .settings
│
╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯`,
                    ...channelInfo
                }, { quoted: message });
                commandExecuted = true;
                break;

            default:
                commandExecuted = false;
                break;
        }

        if (commandExecuted !== false) {
            await showTypingAfterCommand(sock, chatId);
            await showRecordingAfterCommand(sock, chatId);
        }

        async function groupJidCommand(sock, chatId, message) {
            const groupJid = message.key.remoteJid;
            if (!groupJid.endsWith('@g.us')) {
                return await sock.sendMessage(chatId, { text: "❌ This command can only be used in a group." });
            }
            await sock.sendMessage(chatId, { text: `✅ Group JID: ${groupJid}` }, { quoted: message });
        }

        if (userMessage.startsWith('.')) {
            await addCommandReaction(sock, message);
        }
    } catch (error) {
        console.error('❌ Error in message handler:', error.message);
        if (chatId) {
            await sock.sendMessage(chatId, { text: '❌ Failed to process command!', ...channelInfo });
        }
    }
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update;
        if (!id.endsWith('@g.us')) return;

        let isPublic = true;
        try {
            if (!global.botModeCache) global.botModeCache = loadJsonFile('./data/messageCount.json', { isPublic: true });
            const modeData = global.botModeCache;
            if (typeof modeData.isPublic === 'boolean') isPublic = modeData.isPublic;
        } catch (e) { }

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
            const isWelcomeEnabled = await isWelcomeOn(id);
            if (!isWelcomeEnabled) return;
            const groupMetadata = await sock.groupMetadata(id);
            const groupName = groupMetadata.subject;
            const welcomeMessage = 'Welcome {user} to {group}! 🎉';
            for (const participant of participants) {
                const user = participant.split('@')[0];
                await sock.sendMessage(id, { text: welcomeMessage.replace('{user}', `@${user}`).replace('{group}', groupName), mentions: [participant] });
            }
        }

        if (action === 'remove') {
            const isGoodbyeEnabled = await isGoodByeOn(id);
            if (!isGoodbyeEnabled) return;
            const groupMetadata = await sock.groupMetadata(id);
            const groupName = groupMetadata.subject;
            const goodbyeMessage = 'Goodbye {user} 👋';
            for (const participant of participants) {
                const user = participant.split('@')[0];
                await sock.sendMessage(id, { text: goodbyeMessage.replace('{user}', `@${user}`).replace('{group}', groupName), mentions: [participant] });
            }
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
    // FIX 7 — State Reset for Reconnection Guard
    resetAntiBanState: () => {
        processedIds.clear();
        console.log('🔄 Anti-ban: processedIds cleared for fresh session');
    }
};
