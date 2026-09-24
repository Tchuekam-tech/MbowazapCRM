const settings = require('./settings');
require('./config.js');
const { isBanned } = require('./lib/isBanned');
const yts = require('yt-search');
const { fetchBuffer } = require('./lib/myfunc');
const fs = require('fs');
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
const { handleAntideleteCommand, handleMessageRevocation, storeMessage } = require('./commands/antidelete');
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

// Global settings
global.packname = settings.packname;
global.author = settings.author;
global.channelLink = "https://whatsapp.com/channel/0029VbAnuvT6RGJ9Qrf3NJ0L";
global.ytch = "TCHUEK-TECH";

// Add this near the top of main.js with other global configurations
const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363420656466131@newsletter',
            newsletterName: 'Tchuek Bot',
            serverMessageId: -1
        }
    }
};

async function handleMessages(sock, messageUpdate, printLog) {
    try {
        const { messages, type } = messageUpdate;
        if (type !== 'notify') return;

        const message = messages[0];
        if (!message?.message) return;

        // Handle autoread functionality
        await handleAutoread(sock, message);

        // Store message for antidelete feature
        if (message.message) {
            await storeMessage(sock, message);
        }

        // Handle message revocation
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message);
            return;
        }

        const chatId = message.key.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        const senderIsSudo = await isSudo(senderId);

        const userMessage = (
            message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            ''
        ).toLowerCase().replace(/\.\s+/g, '.').trim();

        // Preserve raw message for commands like .tag that need original casing
        const rawText = message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            '';

        // Only log command usage
        if (userMessage.startsWith('.')) {
            console.log(`Ã°Å¸â€œÂ Command used in ${isGroup ? 'group' : 'private'}: ${userMessage}`);
        }
        // Enforce private mode BEFORE any replies (except owner/sudo)
        try {
            const data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
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
                    text: 'Ã¢ÂÅ’ You are banned from using the bot. Contact an admin to get unbanned.',
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

        /*  // Basic message response in private chat
          if (!isGroup && (userMessage === 'hi' || userMessage === 'hello' || userMessage === 'bot' || userMessage === 'hlo' || userMessage === 'hey' || userMessage === 'bro')) {
              await sock.sendMessage(chatId, {
                  text: 'Hi, How can I help you?\nYou can use .menu for more info and commands.',
                  ...channelInfo
              });
              return;
          } */

        if (!message.key.fromMe) incrementMessageCount(chatId, senderId);

        // Check for bad words FIRST, before ANY other processing
        if (isGroup && userMessage) {
            await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
        }

        // PM blocker: block non-owner DMs when enabled (do not ban)
        if (!isGroup && !message.key.fromMe && !senderIsSudo) {
            // 1. Lead Capture System (Removed: Sales Rapport Disabled)

            // 2. Auto-Reply System
            try {
                const autoReplyManager = require('./lib/autoReplyManager');
                await autoReplyManager.handleAutoReply(sock, chatId, senderId, message, settings);
            } catch (err) {
                console.error('Auto Reply Error:', err);
            }


            try {
                const pmState = readPmBlockerState();
                if (pmState.enabled) {
                    // Inform user, delay, then block without banning globally
                    await sock.sendMessage(chatId, { text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.' });
                    await new Promise(r => setTimeout(r, 1500));
                    try { await sock.updateBlockStatus(chatId, 'block'); } catch (e) { }
                    return;
                }
            } catch (e) { }
        }

        // Then check for command prefix
        if (!userMessage.startsWith('.')) {
            // Show typing indicator if autotyping is enabled
            await handleAutotypingForMessage(sock, chatId, userMessage);
            // Show recording indicator if autorecording is enabled
            await handleAutorecordingForMessage(sock, chatId, userMessage);

            if (isGroup) {
                // Process non-command messages first
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
                await sock.sendMessage(chatId, { text: 'Ã¢ÂÅ’ This command is only available for the owner or sudo!' }, { quoted: message });
                return;
            }
        }

        // Command handlers - Execute commands immediately without waiting for typing indicator
        // We'll show typing indicator after command execution if needed
        let commandExecuted = false;

        switch (true) {
            case userMessage === '.simage':
                await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¥Â¸", key: message.key } });
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
             await new Promise(resolve => setTimeout(resolve, 500));
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œâ€¹", key: message.key } });
    {
        const q = userMessage.split(' ').slice(1).join(' ');
        await readBlocklistCommand(sock, chatId, message, q);
    }
    break;
            
            case userMessage.startsWith('.kick'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢ÂÅ’", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const mentionedJidListKick = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await kickCommand(sock, chatId, senderId, mentionedJidListKick, message);
                break;
            case userMessage.startsWith('.mute'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€â€¢", key: message.key } });
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
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€Â", key: message.key } });
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
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÅ“", key: message.key } });
    await new Promise(resolve => setTimeout(resolve, 500));
    {
        await bibleListCommand(sock, chatId, message);
    }
    break;
    case userMessage === '.' + ['lu', 'cky'].join('') || userMessage === '.ask' || userMessage === '.':
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â§Â ", key: message.key } });
    await new Promise(resolve => setTimeout(resolve, 500));
  {
    const q = userMessage.split(" ").slice(1).join(" ");
    await l\u0075ckyCommand(sock, chatId, message, q);
  }
  break;

case userMessage.startsWith(".llama3"):
await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Â¡", key: message.key } });
await new Promise(resolve => setTimeout(resolve, 500));
  {
    const q = userMessage.split(" ").slice(1).join(" ");
    await llama3Command(sock, chatId, message, q);
  }
  break;
                case userMessage.startsWith('.newsletter'):
case userMessage.startsWith('.cjid'):
case userMessage.startsWith('.id'):
await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â©Âº", key: message.key } });
await new Promise(resolve => setTimeout(resolve, 500));
    {
        const q = userMessage.split(' ').slice(1).join(' ');
        await newsletterCommand(sock, chatId, message, q);
    }
    break;
    case userMessage.startsWith('.dev'):
case userMessage.startsWith('.developer'):
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€˜Â¨Ã¢â‚¬ÂÃ°Å¸â€™Â»", key: message.key } });
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
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â", key: message.key } });
    await new Promise(resolve => setTimeout(resolve, 500));
    {
        const q = rawText.split(" ").slice(1).join(" ");
        await countryinfoCommand(sock, chatId, message, q);
    }
    break;
    
    case userMessage.startsWith('.status'):
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÂ²", key: message.key } });
    await new Promise(resolve => setTimeout(resolve, 500));
    await statusDownloadCommand(sock, chatId, message);
    break;
    
    case userMessage.startsWith('.epl'):
    await sock.sendMessage(chatId, { react: { text: "Ã¢Å¡Â½", key: message.key } });
    await new Promise(resolve => setTimeout(resolve, 500));
    {
        const q = userMessage.split(" ").slice(1).join(" ");
        await eplCommand(sock, chatId, message, q);
    }
    break;
    case userMessage.startsWith('.bible'):
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œâ€“", key: message.key } });
    await new Promise(resolve => setTimeout(resolve, 500));
    {
        const q = userMessage.split(" ").slice(1).join(" ");
        await bibleCommand(sock, chatId, message, q);
    }
    break;
    case userMessage.startsWith(".check"):
  await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â", key: message.key } });
  await new Promise(resolve => setTimeout(resolve, 500));
  {
    const q = userMessage.split(" ").slice(1).join(" ");
    await checkCommand(sock, chatId, message, q);
  }
  break;
    
    
            case userMessage === '.unmute':
                await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÂ¢", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await unmuteCommand(sock, chatId, senderId);
                break;
                
                case userMessage.startsWith('.apk'):
               await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÂ¦", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await apkCommand(sock, chatId, message);
                break;
                case userMessage.startsWith('.block') || userMessage.startsWith('.unblock'):
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å¡Â«", key: message.key } });
    await new Promise(resolve => setTimeout(resolve, 500));
    {
        const q = userMessage.split(' ').slice(1).join(' ');
        await blockUnblockCommand(sock, chatId, message, q);
    }
    break;
               case userMessage.startsWith('.kill'):
               case userMessage.startsWith('.crush'):
               case userMessage.startsWith('.218'):
                await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¦Â ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await killCommand(sock, chatId, message);
    
    break;
    
                
            case userMessage.startsWith('.ban'):
               await sock.sendMessage(chatId, { react: { text: "Ã¢ÂÅ’", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await banCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.unban'):
                await sock.sendMessage(chatId, { react: { text: "Ã¢Å“â€¦", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await unbanCommand(sock, chatId, message);
                break;
            case userMessage === '.allmenu' || userMessage === '.listall' || userMessage === '.fullcmd' || userMessage === '.fullmenu':
                await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤â€“", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await menu2Command(sock, chatId, message, global.channelLink);
                commandExecuted = true;
                break;
                case userMessage === '.menu' || userMessage === '.bot' || userMessage === '.list':
                await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤â€“", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await menuCommand(sock, chatId, message, global.channelLink);
                commandExecuted = true;                                     
                break;
            case userMessage === '.sticker' || userMessage === '.s':
               await sock.sendMessage(chatId, { react: { text: "Ã¢Ëœâ€žÃ¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await stickerCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.warnings'):
                const mentionedJidListWarnings = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await sock.sendMessage(chatId, { react: { text: "Ã¢Å¡Â Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await warningsCommand(sock, chatId, mentionedJidListWarnings);
                break;
            case userMessage.startsWith('.warn'):
                const mentionedJidListWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await sock.sendMessage(chatId, { react: { text: "Ã¢Å¡Â Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await warnCommand(sock, chatId, senderId, mentionedJidListWarn, message);
                break;
                
                
                case userMessage.startsWith('.pair'):
                const q = userMessage.slice(5).trim();
                await sock.sendMessage(chatId, { react: { text: "Ã¢ÂÂ³", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await pairCommand(sock, chatId, message, q);
                
                break;
                
            case userMessage.startsWith('.tts'):
                const text = userMessage.slice(4).trim();
                await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€Å ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await ttsCommand(sock, chatId, text, message);
                break;
            case userMessage.startsWith('.delete') || userMessage.startsWith('.del'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢ÂÅ’", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await deleteCommand(sock, chatId, message, senderId);
                break;
            case userMessage.startsWith('.attp'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢Å“Â¨", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await attpCommand(sock, chatId, message);
                break;

            case userMessage === '.settings':
            await sock.sendMessage(chatId, { react: { text: "Ã¢Å¡â„¢Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await settingsCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.mode'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ËœÅ½", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                // Check if sender is the owner
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { text: 'Only bot owner can use this command!', ...channelInfo }, { quoted: message });
                    return;
                }
                // Read current data first
                let data;
                try {
                    data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
                } catch (error) {
                    console.error('Error reading access mode:', error);
                    await sock.sendMessage(chatId, { text: 'Failed to read bot mode status', ...channelInfo });
                    return;
                }

                const action = userMessage.split(' ')[1]?.toLowerCase();
                // If no argument provided, show current status
                if (!action) {
                    const currentMode = data.isPublic ? 'Ã°Å¸â€˜Â¥public' : 'Ã°Å¸â€˜Â¤private';
                    await sock.sendMessage(chatId, {
                        text: `Ã¢â€¢Â­Ã¢â€¢ÂÃ¢â€¢ÂÃ¢Å“Â¦Ã£â‚¬â€ *ÃŠâ„¢Ã¡Â´ÂÃ¡Â´â€º Ã¡Â´ÂÃ¡Â´ÂÃ¡Â´â€¦Ã¡Â´â€¡* Ã£â‚¬â€¢Ã¢Å“Â¦Ã¢â€¢ÂÃ¢â€¢Â®\nÃ¢â€â€š\nÃ¢â€â€š Ã¡Â´â€žÃ¡Â´Å“ÃŠâ‚¬ÃŠâ‚¬Ã¡Â´â€¡Ã‰Â´Ã¡Â´â€º ÃŠâ„¢Ã¡Â´ÂÃ¡Â´â€º Ã¡Â´ÂÃ¡Â´ÂÃ¡Â´â€¦Ã¡Â´â€¡: *${currentMode}*\nÃ¢â€â€š\nÃ¢â€â€š Ã¡Â´Å“ÃªÅ“Â±Ã¡Â´â‚¬Ã‰Â¢Ã¡Â´â€¡: .mode public/private\nÃ¢â€â€š\nÃ¢â€â€šÃ¡Â´â€¡xÃ¡Â´â‚¬Ã¡Â´ÂÃ¡Â´ËœÃŠÅ¸Ã¡Â´â€¡:\nÃ¢â€â€š.mode public - Allow everyone to use bot\nÃ¢â€â€š.mode private - Restrict to owner only\nÃ¢â€â€š\nÃ¢â€¢Â°Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢â€¢Â¯`,
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }

                if (action !== 'public' && action !== 'private') {
                    await sock.sendMessage(chatId, {
                        text: 'Ã¢â€¢Â­Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢â€¢Â®\nÃ¢â€â€š \nÃ¢â€â€š *Ã¡Â´Å“ÃªÅ“Â±Ã¡Â´â‚¬Ã‰Â¢Ã¡Â´â€¡*: .mode public/private\nÃ¢â€â€š \nÃ¢â€â€š *Ã¡Â´â€¡xÃ¡Â´â‚¬Ã¡Â´ÂÃ¡Â´ËœÃŠÅ¸Ã¡Â´â€¡*:\nÃ¢â€â€š .mode public - Allow everyone to use bot\nÃ¢â€â€š .mode private - Restrict to owner only\n\nÃ¢â€¢Â°Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢â€¢Â¯',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }

                try {
                    // Update access mode
                    data.isPublic = action === 'public';

                    // Save updated data
                    fs.writeFileSync('./data/messageCount.json', JSON.stringify(data, null, 2));

                    await sock.sendMessage(chatId, { text: `Bot is now in *${action}* mode`, ...channelInfo });
                } catch (error) {
                    console.error('Error updating access mode:', error);
                    await sock.sendMessage(chatId, { text: 'Failed to update bot access mode', ...channelInfo });
                }
                break;
            case userMessage.startsWith('.anticall'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÂµ", key: message.key } });
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
    await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Â»", key: message.key } });
    await new Promise(r => setTimeout(r, 500));
    await hackCommand(sock, chatId, message, null);
    break;
            case userMessage.startsWith('.pmblocker'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â§Â¨", key: message.key } });
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
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€˜Â®", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await ownerCommand(sock, chatId);
                break;
            case userMessage === '.tagall':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å½Â³", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isSenderAdmin || message.key.fromMe) {
                    await tagAllCommand(sock, chatId, senderId, message);
                } else {
                    await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use the .tagall command.', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage === '.tagnotadmin':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Âªâ€ ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await tagNotAdminCommand(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.hidetag'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¥Â½", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const messageText = rawText.slice(8).trim();
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                break;
            case userMessage.startsWith('.tag'):
                const messageText = rawText.slice(4).trim();  // use rawText here, not userMessage
                const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÂ¡", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await tagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                break;
            case userMessage.startsWith('.antilink'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢â€ºâ€œÃ¯Â¸ÂÃ¢â‚¬ÂÃ°Å¸â€™Â¥", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, {
                        text: 'This command can only be used in groups.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: 'Please make the bot an admin first.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                await handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break;
            case userMessage.startsWith('.antitag'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€ºÂ°Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, {
                        text: 'This command can only be used in groups.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: 'Please make the bot an admin first.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                await handleAntitagCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break;
            case userMessage === '.meme':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œâ€˜", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await memeCommand(sock, chatId, message);
                break;
            case userMessage === '.joke':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤Â£", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await jokeCommand(sock, chatId, message);
                break;
            case userMessage === '.quote':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â«Â¡", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await quoteCommand(sock, chatId, message);
                break;
            case userMessage === '.fact':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€˜Â½", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await factCommand(sock, chatId, message, message);
                break;
            case userMessage.startsWith('.weather'):
  await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â¤", key: message.key } });
  {
    const q = userMessage.split(" ").slice(1).join(" ");
    await weatherCommand(sock, chatId, message, q);
  }
  break;
            case userMessage === '.news':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÂº", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await newsCommand(sock, chatId);
                break;
            case userMessage.startsWith('.ttt') || userMessage.startsWith('.tictactoe'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å½Â®", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const tttText = userMessage.split(' ').slice(1).join(' ');
                await tictactoeCommand(sock, chatId, senderId, tttText);
                break;
            case userMessage.startsWith('.move'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å½Â¬", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const position = parseInt(userMessage.split(' ')[1]);
                if (isNaN(position)) {
                    await sock.sendMessage(chatId, { text: 'Please provide a valid position number for Tic-Tac-Toe move.', ...channelInfo }, { quoted: message });
                } else {
                    tictactoeMove(sock, chatId, senderId, position);
                }
                break;
            case userMessage === '.topmembers':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å½Â­", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                topMembers(sock, chatId, isGroup);
                break;
            case userMessage.startsWith('.hangman'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¦Â¸", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                startHangman(sock, chatId);
                break;
            case userMessage.startsWith('.guess'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€¢ÂµÃ¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const guessedLetter = userMessage.split(' ')[1];
                if (guessedLetter) {
                    guessLetter(sock, chatId, guessedLetter);
                } else {
                    sock.sendMessage(chatId, { text: 'Please guess a letter using .guess <letter>', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage.startsWith('.trivia'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™â€š", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                startTrivia(sock, chatId);
                break;
            case userMessage.startsWith('.answer'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â§â€˜Ã¢â‚¬ÂÃ°Å¸â€™Â»", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const answer = userMessage.split(' ').slice(1).join(' ');
                if (answer) {
                    answerTrivia(sock, chatId, answer);
                } else {
                    sock.sendMessage(chatId, { text: 'Please provide an answer using .answer <answer>', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage.startsWith('.compliment'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await complimentCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.insult'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â¬Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await insultCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.8ball'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å½Â±", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const question = userMessage.split(' ').slice(1).join(' ');
                await eightBallCommand(sock, chatId, question);
                break;
            case userMessage.startsWith('.lyrics'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÂ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const songTitle = userMessage.split(' ').slice(1).join(' ');
                await lyricsCommand(sock, chatId, songTitle, message);
                break;
            case userMessage.startsWith('.simp'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œâ€", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await simpCommand(sock, chatId, quotedMsg, mentionedJid, senderId);
                break;
            case userMessage.startsWith('.stupid') || userMessage.startsWith('.itssostupid') || userMessage.startsWith('.iss'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â„¢â€°", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const stupidQuotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const stupidMentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const stupidArgs = userMessage.split(' ').slice(1);
                await stupidCommand(sock, chatId, stupidQuotedMsg, stupidMentionedJid, senderId, stupidArgs);
                break;
            case userMessage === '.dare':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â„¢Ë†", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await dareCommand(sock, chatId, message);
                break;
            case userMessage === '.truth':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Â¯", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await truthCommand(sock, chatId, message);
                break;
            case userMessage === '.clear':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Â¨", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isGroup) await clearCommand(sock, chatId);
                break;
            case userMessage.startsWith('.promote'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢Â¬â€ Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const mentionedJidListPromote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await promoteCommand(sock, chatId, mentionedJidListPromote, message);
                break;
            case userMessage.startsWith('.demote'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢Â¬â€¡Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const mentionedJidListDemote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await demoteCommand(sock, chatId, mentionedJidListDemote, message);
                break;
            case userMessage === '.ping' || userMessage === '.speed' || userMessage === '.test':
                await sock.sendMessage(chatId, { react: { text: "Ã¢Å¡Â¡", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await pingCommand(sock, chatId, message);
                break;
            case userMessage === '.alive':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€¢Å½", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await aliveCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.blur'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€˜ÂÃ¯Â¸ÂÃ¢â‚¬ÂÃ°Å¸â€”Â¨Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                await blurCommand(sock, chatId, message, quotedMessage);
                break;
            case userMessage.startsWith('.welcome'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢ÂÂºÃ¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isGroup) {
                    // Check admin status if not already checked
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }

                    if (isSenderAdmin || message.key.fromMe) {
                        await welcomeCommand(sock, chatId, message);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage.startsWith('.goodbye'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢â„¢Â¨Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isGroup) {
                    // Check admin status if not already checked
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }

                    if (isSenderAdmin || message.key.fromMe) {
                        await goodbyeCommand(sock, chatId, message);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage === '.git':
            case userMessage === '.github':
            case userMessage === '.sc':
            case userMessage === '.script':
            case userMessage === '.repo':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â§â€˜Ã¢â‚¬ÂÃ°Å¸â€™Â»", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await githubCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.antibadword'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â„¢â€¦", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }

                const adminStatus = await isAdmin(sock, chatId, senderId);
                isSenderAdmin = adminStatus.isSenderAdmin;
                isBotAdmin = adminStatus.isBotAdmin;

                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, { text: '*Bot must be admin to use this feature*', ...channelInfo }, { quoted: message });
                    return;
                }

                await antibadwordCommand(sock, chatId, message, senderId, isSenderAdmin);
                break;
            case userMessage.startsWith('.chatbot'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€˜Â¾", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }

                // Check if sender is admin or bot owner
                const chatbotAdminStatus = await isAdmin(sock, chatId, senderId);
                if (!chatbotAdminStatus.isSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, { text: '*Only admins or bot owner can use this command*', ...channelInfo }, { quoted: message });
                    return;
                }

                const match = userMessage.slice(8).trim();
                await handleChatbotCommand(sock, chatId, message, match);
                break;
            case userMessage.startsWith('.take'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€˜Â»", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const takeArgs = rawText.slice(5).trim().split(' ');
                await takeCommand(sock, chatId, message, takeArgs);
                break;
            case userMessage === '.flirt':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™â€¹", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await flirtCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.character'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â§â€˜Ã¢â‚¬ÂÃ°Å¸Â§â€˜Ã¢â‚¬ÂÃ°Å¸Â§â€™", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await characterCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.waste'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å¡Â©", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await wastedCommand(sock, chatId, message);
                break;
            case userMessage === '.ship':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å¡Â¢", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await shipCommand(sock, chatId, message);
                break;
            case userMessage === '.groupinfo' || userMessage === '.infogp' || userMessage === '.infogrupo':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€”Â¿", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await groupInfoCommand(sock, chatId, message);
                break;
            case userMessage === '.resetlink' || userMessage === '.revoke' || userMessage === '.anularlink':
            await sock.sendMessage(chatId, { react: { text: "Ã¢â€ºâ€œÃ¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await resetlinkCommand(sock, chatId, senderId);
                break;
            case userMessage === '.staff' || userMessage === '.admins' || userMessage === '.listadmin':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€ºÂ°Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await staffCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.tourl') || userMessage.startsWith('.url'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€“â€¡Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await urlCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.emojimix') || userMessage.startsWith('.emix'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â«Â¨", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await emojimixCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.tg') || userMessage.startsWith('.stickertelegram') || userMessage.startsWith('.tgsticker') || userMessage.startsWith('.telesticker'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ËœÂµÃ¢â‚¬ÂÃ°Å¸â€™Â«", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await stickerTelegramCommand(sock, chatId, message);
                break;

            case userMessage === '.vv' || userMessage === '.ok' || userMessage === '.wow':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤â€œ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await viewOnceCommand(sock, chatId, message);
                break;
            case userMessage === '.clearsession' || userMessage === '.clearsesi':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤Â®", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await clearSessionCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.autostatus'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ËœÂ¶Ã¢â‚¬ÂÃ°Å¸Å’Â«Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const autoStatusArgs = userMessage.split(' ').slice(1);
                await autoStatusCommand(sock, chatId, message, autoStatusArgs);
                break;
            case userMessage.startsWith('.simp'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤Âª", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await simpCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.metallic'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¦Â¾", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'metallic');
                break;
            case userMessage.startsWith('.ice'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â§Å ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'ice');
                break;
            case userMessage.startsWith('.snow'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Ââ€Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'snow');
                break;
            case userMessage.startsWith('.impressive'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â«Â§", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'impressive');
                break;
            case userMessage.startsWith('.matrix'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’â‚¬", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'matrix');
                break;
            case userMessage.startsWith('.light'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’â€¦", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'light');
                break;
            case userMessage.startsWith('.neon'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Å’", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'neon');
                break;
            case userMessage.startsWith('.devil'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ËœË†", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'devil');
                break;
            case userMessage.startsWith('.purple'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Å“", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'purple');
                break;
            case userMessage.startsWith('.thunder'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â©Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'thunder');
                break;
            case userMessage.startsWith('.leaves'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â¿", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'leaves');
                break;
            case userMessage.startsWith('.1917'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ÂªÂ¨", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, '1917');
                break;
            case userMessage.startsWith('.arena'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ÂÂ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'arena');
                break;
            case userMessage.startsWith('.hacker'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’â€ ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'hacker');
                break;
            case userMessage.startsWith('.sand'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ÂÅ½Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'sand');
                break;
            case userMessage.startsWith('.blackpink'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¦Æ’", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'blackpink');
                break;
            case userMessage.startsWith('.glitch'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¦â€°", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'glitch');
                break;
            case userMessage.startsWith('.fire'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€Â¥", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await textmakerCommand(sock, chatId, message, userMessage, 'fire');
                break;
            case userMessage.startsWith('.antidelete'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€Â¬", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const antideleteMatch = userMessage.slice(11).trim();
                await handleAntideleteCommand(sock, chatId, message, antideleteMatch);
                break;
            case userMessage === '.surrender':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â©Â¹", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                // Handle surrender command for tictactoe game
                await handleTicTacToeMove(sock, chatId, senderId, 'surrender');
                break;
            case userMessage === '.cleartmp':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤Â§", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await clearTmpCommand(sock, chatId, message);
                break;
            case userMessage === '.setpp':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Å¸", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await setProfilePicture(sock, chatId, message);
                break;
            case userMessage.startsWith('.setgdesc'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤Â¹", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const text = rawText.slice(9).trim();
                    await setGroupDescription(sock, chatId, senderId, text, message);
                }
                break;
            case userMessage.startsWith('.setgname'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤Âº", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const text = rawText.slice(9).trim();
                    await setGroupName(sock, chatId, senderId, text, message);
                }
                break;
            case userMessage.startsWith('.setgpp'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€˜Â¼", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await setGroupPhoto(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.instagram') || userMessage.startsWith('.insta') || (userMessage === '.ig' || userMessage.startsWith('.ig ')):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â§â€œ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await instagramCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.igsc'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€¢Â´Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await igsCommand(sock, chatId, message, true);
                break;
            case userMessage.startsWith('.igs'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â§â€˜Ã¢â‚¬ÂÃ°Å¸ÂÂ³", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await igsCommand(sock, chatId, message, false);
                break;
            case userMessage.startsWith('.fb') || userMessage.startsWith('.facebook'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢â„¢Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await facebookCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.play'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å½Â¶", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await playCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.ai'):
            case userMessage.startsWith('.gpt'):
            case userMessage.startsWith('.gemini'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤â€“", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await aiCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.spotify'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å½Âµ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await spotifyCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.mp3') || userMessage.startsWith('.ytmp3') || userMessage.startsWith('.song'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢ÂÂ¯Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await songCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.video') || userMessage.startsWith('.ytmp4'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å½Â¦", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await videoCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.tiktok') || userMessage.startsWith('.tt'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Ë†Â²", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await tiktokCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.translate') || userMessage.startsWith('.trt'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€°Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const commandLength = userMessage.startsWith('.translate') ? 10 : 4;
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€°Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await handleTranslateCommand(sock, chatId, message, userMessage.slice(commandLength));
                return;
            case userMessage.startsWith('.ss') || userMessage.startsWith('.ssweb') || userMessage.startsWith('.screenshot'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÂ²", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const ssCommandLength = userMessage.startsWith('.screenshot') ? 11 : (userMessage.startsWith('.ssweb') ? 6 : 3);
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œÂ²", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await handleSsCommand(sock, chatId, message, userMessage.slice(ssCommandLength).trim());
                break;
            case userMessage.startsWith('.areact') || userMessage.startsWith('.autoreact') || userMessage.startsWith('.autoreaction'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢ËœÂ£Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                const isOwnerOrSudo = message.key.fromMe || senderIsSudo;
                await handleAreactCommand(sock, chatId, message, isOwnerOrSudo);
                break;
            case userMessage.startsWith('.sudo'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¥Â³", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await sudoCommand(sock, chatId, message);
                break;
            case userMessage === '.goodnight' || userMessage === '.lovenight' || userMessage === '.gn':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await goodnightCommand(sock, chatId, message);
                break;
            case userMessage === '.shayari' || userMessage === '.shayri':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’â€“", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await shayariCommand(sock, chatId, message);
                break;
            case userMessage === '.roseday':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â¹", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await rosedayCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.imagine') || userMessage.startsWith('.flux') || userMessage.startsWith('.dalle'): 
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤â€", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
               await imagineCommand(sock, chatId, message);
                break;
            case userMessage === '.jid':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤â€™", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
             await groupJidCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.autotyping'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢Å“â€™Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await autotypingCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                case userMessage.startsWith('.autorecording'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€“Â²Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await autorecordingCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autoread'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œâ€ž", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await autoreadCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.heart'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Ëœ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await handleHeart(sock, chatId, message);
                break;
            case userMessage.startsWith('.horny'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™â€¢", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['horny', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.circle'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€¢Â³Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['circle', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.lgbt'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€”Â£Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lgbt', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.lolice'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â«Â¦", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lolice', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.simpcard'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€˜â€ž", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['simpcard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.tonikawa'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤Å¾", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tonikawa', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.its-so-stupid'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¤Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['its-so-stupid', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.namecard'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â«Â±", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['namecard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;

            case userMessage.startsWith('.oogway2'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢Å“Å ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.oogway'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€˜Å ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = userMessage.startsWith('.oogway2') ? 'oogway2' : 'oogway';
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.tweet'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¦Â»", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tweet', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.ytcomment'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢â€ºÂ°Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.comrade'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢Ëœâ€", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.gay'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢ËœÆ’Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.glass'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¦Âª", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.jail'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ÂÆ’", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.passed'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Âµ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.triggered'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ÂÅ¾Ã¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = userMessage.slice(1).split(/\s+/)[0];
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.animu'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Â®", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await animeCommand(sock, chatId, message, args);
                }
                break;
            // animu aliases
            case userMessage.startsWith('.nom'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â¸", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.poke'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â¥Â±", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.cry'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ËœÂ¥", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.kiss'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ËœËœ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.pat'):
            await sock.sendMessage(chatId, { react: { text: "Ã¢ËœÂºÃ¯Â¸Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.hug'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â«â€š", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.wink'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Â©Â¸", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.facepalm'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â„¢â‚¬", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.face-palm'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ËœÂ±", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.animuquote'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ËœÂ®Ã¢â‚¬ÂÃ°Å¸â€™Â¨", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.quote'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Å¡", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
            case userMessage.startsWith('.loli'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸ËœÂ¾", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = userMessage.trim().split(/\s+/);
                    let sub = parts[0].slice(1);
                    if (sub === 'facepalm') sub = 'face-palm';
                    if (sub === 'quote' || sub === 'animuquote') sub = 'quote';
                    await animeCommand(sock, chatId, message, [sub]);
                }
                break;
            case userMessage === '.crop':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™â€“", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await stickercropCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pies'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Å¸", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = rawText.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await piesCommand(sock, chatId, message, args);
                    commandExecuted = true;
                }
                break;
            case userMessage === '.china':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€¡Â¹Ã°Å¸â€¡Â³", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await piesAlias(sock, chatId, message, 'china');
                commandExecuted = true;
                break;
            case userMessage === '.indonesia':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å½Å’", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await piesAlias(sock, chatId, message, 'indonesia');
                commandExecuted = true;
                break;
            case userMessage === '.japan':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€¡Â²Ã°Å¸â€¡Â°", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await piesAlias(sock, chatId, message, 'japan');
                commandExecuted = true;
                break;
            case userMessage === '.korea':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€¡Â»Ã°Å¸â€¡Âº", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await piesAlias(sock, chatId, message, 'korea');
                commandExecuted = true;
                break;
            case userMessage === '.hijab':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€¡Â¹Ã°Å¸â€¡Â·", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await piesAlias(sock, chatId, message, 'hijab');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.update'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€™Â ", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                {
                    const parts = rawText.trim().split(/\s+/);
                    const zipArg = parts[1] && parts[1].startsWith('http') ? parts[1] : '';
                    await updateCommand(sock, chatId, message, senderIsSudo, zipArg);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.removebg') || userMessage.startsWith('.rmbg') || userMessage.startsWith('.nobg'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€Â·", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await removebgCommand.exec(sock, message, userMessage.split(' ').slice(1));
                break;
            case userMessage.startsWith('.remini') || userMessage.startsWith('.enhance') || userMessage.startsWith('.upscale'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Ë†Â³", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await reminiCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                break;
            case userMessage.startsWith('.sora'):
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸Å’Â", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await soraCommand(sock, chatId, message);
                break;
            case userMessage === '.help' || userMessage === '.commands' || userMessage === '.cmds':
            await sock.sendMessage(chatId, { react: { text: "Ã°Å¸â€œâ€¹", key: message.key } });
                await new Promise(resolve => setTimeout(resolve, 500));
                await sock.sendMessage(chatId, {
                    text: `Ã¢â€¢Â­Ã¢â€¢ÂÃ¢â€¢ÂÃ¢Å“Â¦Ã£â‚¬â€ *Tchuek Bot Ã¢â‚¬â€ Commands* Ã£â‚¬â€¢Ã¢Å“Â¦Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â®
Ã¢â€â€š
Ã¢â€â€š Ã°Å¸Â¤â€“ *AI Commands*
Ã¢â€â€š  .ai <question>       Ã¢â‚¬â€ Ask Gemini AI
Ã¢â€â€š  .gpt <question>      Ã¢â‚¬â€ Same as .ai
Ã¢â€â€š
Ã¢â€â€š Ã°Å¸Å½Â® *Fun*
Ã¢â€â€š  .joke  .dare  .truth  .8ball <q>
Ã¢â€â€š  .meme  .quote  .fact  .ttt
Ã¢â€â€š
Ã¢â€â€š Ã°Å¸Å½Âµ *Media*
Ã¢â€â€š  .play <song>         Ã¢â‚¬â€ YouTube audio
Ã¢â€â€š  .song <title>        Ã¢â‚¬â€ MP3 download
Ã¢â€â€š  .tiktok <url>        Ã¢â‚¬â€ TikTok video
Ã¢â€â€š
Ã¢â€â€š Ã°Å¸â€ºÂ¡Ã¯Â¸Â *Group Admin*
Ã¢â€â€š  .ban  .unban  .kick
Ã¢â€â€š  .promote  .demote
Ã¢â€â€š  .antilink on/off
Ã¢â€â€š  .antibadword on/off
Ã¢â€â€š  .chatbot on/off      Ã¢â‚¬â€ AI group chat
Ã¢â€â€š
Ã¢â€â€š Ã°Å¸â€Â§ *Tools*
Ã¢â€â€š  .sticker / .s        Ã¢â‚¬â€ Make sticker
Ã¢â€â€š  .tts <text>          Ã¢â‚¬â€ Text to speech
Ã¢â€â€š  .translate <text>    Ã¢â‚¬â€ Translate
Ã¢â€â€š  .weather <city>      Ã¢â‚¬â€ Weather info
Ã¢â€â€š  .ping                Ã¢â‚¬â€ Bot speed test
Ã¢â€â€š  .alive               Ã¢â‚¬â€ Bot status
Ã¢â€â€š
Ã¢â€â€š Ã¢â€žÂ¹Ã¯Â¸Â *Info*
Ã¢â€â€š  .owner  .menu  .settings
Ã¢â€â€š
Ã¢â€¢Â°Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢Å“Â¦Ã¢â€¢ÂÃ¢â€¢Â¯`,
                    ...channelInfo
                }, { quoted: message });
                commandExecuted = true;
                break;

            default:
                // Unknown command starting with '.' Ã¢â‚¬â€ silent ignore, no crash
                commandExecuted = false;
                break;
        }

        // If a command was executed, show typing status after command execution
        if (commandExecuted !== false) {
            // Command was executed, now show typing status after command execution
            await showTypingAfterCommand(sock, chatId);
        }

if (commandExecuted !== false) {
            // Command was executed, now show recording status after command execution
            await showRecordingAfterCommand(sock, chatId);
        }

        // Function to handle .groupjid command
        async function groupJidCommand(sock, chatId, message) {
            const groupJid = message.key.remoteJid;

            if (!groupJid.endsWith('@g.us')) {
                return await sock.sendMessage(chatId, {
                    text: "Ã¢ÂÅ’ This command can only be used in a group."
                });
            }

            await sock.sendMessage(chatId, {
                text: `Ã¢Å“â€¦ Group JID: ${groupJid}`
            }, {
                quoted: message
            });
        }

        if (userMessage.startsWith('.')) {
            // After command is processed successfully
            await addCommandReaction(sock, message);
        }
    } catch (error) {
        console.error('Ã¢ÂÅ’ Error in message handler:', error.message);
        // Only try to send error message if we have a valid chatId
        if (chatId) {
            await sock.sendMessage(chatId, {
                text: 'Ã¢ÂÅ’ Failed to process command!',
                ...channelInfo
            });
        }
    }
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update;

        // Check if it's a group
        if (!id.endsWith('@g.us')) return;

        // Respect bot mode: only announce promote/demote in public mode
        let isPublic = true;
        try {
            const modeData = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            if (typeof modeData.isPublic === 'boolean') isPublic = modeData.isPublic;
        } catch (e) {
            // If reading fails, default to public behavior
        }

        // Handle promotion events
        if (action === 'promote') {
            if (!isPublic) return;
            await handlePromotionEvent(sock, id, participants, author);
            return;
        }

        // Handle demotion events
        if (action === 'demote') {
            if (!isPublic) return;
            await handleDemotionEvent(sock, id, participants, author);
            return;
        }

        // Handle join events
        if (action === 'add') {
            // Check if welcome is enabled for this group
            const isWelcomeEnabled = await isWelcomeOn(id);
            if (!isWelcomeEnabled) return;

            // Get group metadata
            const groupMetadata = await sock.groupMetadata(id);
            const groupName = groupMetadata.subject;
            const groupDesc = groupMetadata.desc || 'No description available';

            // Use simple default welcome message
            const welcomeMessage = 'Welcome {user} to {group}! Ã°Å¸Å½â€°';

            // Send welcome message for each new participant
            for (const participant of participants) {
                const user = participant.split('@')[0];
                const formattedMessage = welcomeMessage
                    .replace('{user}', `@${user}`)
                    .replace('{group}', groupName)
                    .replace('{description}', groupDesc);

                await sock.sendMessage(id, {
                    text: formattedMessage,
                    mentions: [participant]
                });
            }
        }

        // Handle leave events
        if (action === 'remove') {
            // Check if goodbye is enabled for this group
            const isGoodbyeEnabled = await isGoodByeOn(id);
            if (!isGoodbyeEnabled) return;

            // Get group metadata
            const groupMetadata = await sock.groupMetadata(id);
            const groupName = groupMetadata.subject;

            // Use simple default goodbye message
            const goodbyeMessage = 'Goodbye {user} Ã°Å¸â€˜â€¹';

            // Send goodbye message for each leaving participant
            for (const participant of participants) {
                const user = participant.split('@')[0];
                const formattedMessage = goodbyeMessage
                    .replace('{user}', `@${user}`)
                    .replace('{group}', groupName);

                await sock.sendMessage(id, {
                    text: formattedMessage,
                    mentions: [participant]
                });
            }
        }
    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error);
    }
}

// Instead, export the handlers along with handleMessages
module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus: async (sock, status) => {
        await handleStatusUpdate(sock, status);
    }
};
