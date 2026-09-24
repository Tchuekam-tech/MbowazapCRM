const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');
const { getPolicyConfig, isPolicyGuardEnabled } = require('../lib/policyGuard');

const messageStore = new Map();
const CONFIG_PATH = path.join(__dirname, '../data/antidelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp');

// Ensure tmp dir exists
if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

// Function to get folder size in MB
const getFolderSizeInMB = (folderPath) => {
    try {
        const files = fs.readdirSync(folderPath);
        let totalSize = 0;

        for (const file of files) {
            const filePath = path.join(folderPath, file);
            if (fs.statSync(filePath).isFile()) {
                totalSize += fs.statSync(filePath).size;
            }
        }

        return totalSize / (1024 * 1024); // Convert bytes to MB
    } catch (err) {
        console.error('Error getting folder size:', err);
        return 0;
    }
};

// Function to clean temp folder if size exceeds 10MB
const cleanTempFolderIfLarge = () => {
    try {
        const sizeMB = getFolderSizeInMB(TEMP_MEDIA_DIR);
        
        if (sizeMB > 200) {
            const files = fs.readdirSync(TEMP_MEDIA_DIR);
            for (const file of files) {
                const filePath = path.join(TEMP_MEDIA_DIR, file);
                fs.unlinkSync(filePath);
            }
        }
    } catch (err) {
        console.error('Temp cleanup error:', err);
    }
};

// Start periodic cleanup check every 1 minute
setInterval(cleanTempFolderIfLarge, 60 * 1000);

// Load config
function loadAntideleteConfig() {
    const policy = getPolicyConfig();
    if (isPolicyGuardEnabled() && policy.disablePrivacyBypass) {
        return { enabled: false, antiViewOnce: false };
    }

    try {
        if (!fs.existsSync(CONFIG_PATH)) return { enabled: false };
        return JSON.parse(fs.readFileSync(CONFIG_PATH));
    } catch {
        return { enabled: false };
    }
}

// Save config
function saveAntideleteConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('Config save error:', err);
    }
}

const isOwnerOrSudo = require('../lib/isOwner');

// Command Handler
async function handleAntideleteCommand(sock, chatId, message, match) {
    const policy = getPolicyConfig();
    if (isPolicyGuardEnabled() && policy.disablePrivacyBypass) {
        if (match === 'off') {
            saveAntideleteConfig({ enabled: false, antiViewOnce: false });
        }

        return sock.sendMessage(chatId, {
            text: '⚠️ Antidelete is disabled in compliance mode because it stores deleted messages.'
        }, { quoted: message });
    }

    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    
    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId, { text: '*Only the bot owner can use this command.*' }, { quoted: message });
    }

    const config = loadAntideleteConfig();

    if (!match) {
        return sock.sendMessage(chatId, {
                        text: `╭══✦〔 *ᴀɴᴛɪᴅᴇʟᴇᴛᴇ ꜱᴇᴛᴜᴘ* 〕✦═╮\n│\n│ *ᴄᴜʀʀᴇɴᴛ ꜱᴛᴀᴛᴜꜱ*: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n│\n│ *.antidelete on* - Enable\n│ *.antidelete off* - Disable\n│\n╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯`
        }, {quoted: message});
    }

    if (match === 'on') {
        config.enabled = true;
    } else if (match === 'off') {
        config.enabled = false;
    } else {
        return sock.sendMessage(chatId, { text: '*Invalid command. Use .antidelete to see usage.*' }, {quoted:message});
    }

    saveAntideleteConfig(config);
    return sock.sendMessage(chatId, { text: `*Antidelete ${match === 'on' ? 'enabled' : 'disabled'}*` }, {quoted:message});
}

// Store incoming messages (also handles anti-view-once by forwarding immediately)
async function storeMessage(sock, message) {
    try {
        const config = loadAntideleteConfig();

        // Anti-ViewOnce runs independently of antidelete
        const antideleteEnabled = config.enabled === true;
        const antiViewOnceEnabled = config.antiViewOnce === true;

        // If neither feature is on, skip entirely
        if (!antideleteEnabled && !antiViewOnceEnabled) return;

        if (!message.key?.id) return;

        const messageId = message.key.id;
        let content = '';
        let mediaType = '';
        let mediaPath = '';
        let isViewOnce = false;

        const sender = message.key.participant || message.key.remoteJid;

        // Detect content (including view-once wrappers)
        const viewOnceContainer = message.message?.viewOnceMessageV2?.message || message.message?.viewOnceMessage?.message;
        if (viewOnceContainer) {
            // unwrap view-once content
            if (viewOnceContainer.imageMessage) {
                mediaType = 'image';
                content = viewOnceContainer.imageMessage.caption || '';
                const stream = await downloadContentFromMessage(viewOnceContainer.imageMessage, 'image');
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                const buffer = Buffer.concat(chunks);
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
                await writeFile(mediaPath, buffer);
                isViewOnce = true;
            } else if (viewOnceContainer.videoMessage) {
                mediaType = 'video';
                content = viewOnceContainer.videoMessage.caption || '';
                const stream = await downloadContentFromMessage(viewOnceContainer.videoMessage, 'video');
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                const buffer = Buffer.concat(chunks);
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
                await writeFile(mediaPath, buffer);
                isViewOnce = true;
            }
        } else if (message.message?.conversation) {
            content = message.message.conversation;
        } else if (message.message?.extendedTextMessage?.text) {
            content = message.message.extendedTextMessage.text;
        } else if (message.message?.imageMessage) {
            mediaType = 'image';
            content = message.message.imageMessage.caption || '';
            const stream = await downloadContentFromMessage(message.message.imageMessage, 'image');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.stickerMessage) {
            mediaType = 'sticker';
            const stream = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.webp`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.videoMessage) {
            mediaType = 'video';
            content = message.message.videoMessage.caption || '';
            const stream = await downloadContentFromMessage(message.message.videoMessage, 'video');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.audioMessage) {
            mediaType = 'audio';
            const mime = message.message.audioMessage.mimetype || '';
            const ext = mime.includes('mpeg') ? 'mp3' : (mime.includes('ogg') ? 'ogg' : 'mp3');
            const stream = await downloadContentFromMessage(message.message.audioMessage, 'audio');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.${ext}`);
            await writeFile(mediaPath, buffer);
        }

        // Only store in messageStore if antidelete is enabled (for revocation recovery)
        if (antideleteEnabled) {
            messageStore.set(messageId, {
                content,
                mediaType,
                mediaPath,
                sender,
                group: message.key.remoteJid.endsWith('@g.us') ? message.key.remoteJid : null,
                timestamp: new Date().toISOString()
            });
        }

        // Anti-ViewOnce: forward immediately to owner if captured
        if (isViewOnce && mediaType && fs.existsSync(mediaPath) && antiViewOnceEnabled) {
            try {
                const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const senderName = sender.split('@')[0];
                const mediaOptions = {
                    caption: `*Anti-ViewOnce ${mediaType}*\nFrom: @${senderName}`,
                    mentions: [sender]
                };
                if (mediaType === 'image') {
                    await sock.sendMessage(ownerNumber, { image: { url: mediaPath }, ...mediaOptions });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(ownerNumber, { video: { url: mediaPath }, ...mediaOptions });
                }
                console.log(`[AntiViewOnce] Forwarded ${mediaType} from ${senderName} to owner`);
                // Cleanup immediately for view-once forward
                try { fs.unlinkSync(mediaPath); } catch {}
            } catch (e) {
                console.error('[AntiViewOnce] Forward failed:', e.message);
            }
        }

    } catch (err) {
        console.error('storeMessage error:', err);
    }
}

// Handle message deletion
async function handleMessageRevocation(sock, revocationMessage) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled) return;

        const messageId = revocationMessage.message.protocolMessage.key.id;
        const deletedBy = revocationMessage.participant || revocationMessage.key.participant || revocationMessage.key.remoteJid;
        const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        if (deletedBy.includes(sock.user.id) || deletedBy === ownerNumber) return;

        const original = messageStore.get(messageId);
        if (!original) return;

        const sender = original.sender;
        const senderName = sender.split('@')[0];
        const groupName = original.group ? (await sock.groupMetadata(original.group)).subject : '';

        const time = new Date().toLocaleString('en-US', {
            timeZone: 'Africa/Kampala',
            hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        const deletedLogPath = path.join(__dirname, '../data/deleted.json');
        try {
            let deletedLogs = [];
            if (fs.existsSync(deletedLogPath)) {
                deletedLogs = JSON.parse(fs.readFileSync(deletedLogPath));
            }
            deletedLogs.push({
                messageId,
                deletedBy,
                sender: original.sender,
                group: original.group,
                content: original.content,
                timestamp: new Date().toISOString()
            });
            fs.writeFileSync(deletedLogPath, JSON.stringify(deletedLogs, null, 2));
        } catch (e) {
            console.error('Failed to log deleted message', e);
        }


              let text = `╭══✦〔 *🔰 ᴀɴᴛɪᴅᴇʟᴇᴛᴇ ʀᴇᴘᴏʀᴛ 🔰* 〕✦═╮\n│\n` +
            `│ *🗑️ Deleted By:* @${deletedBy.split('@')[0]}\n` +
            `│ *👤 Sender:* @${senderName}\n` +
            `│ *📱 Number:* ${sender}\n` +
            `│ *🕒 Time:* ${time}\n`;

        if (groupName) text += `│ *👥 Group:* ${groupName}\n`;

        if (original.content) {
            text += `\n│ *💬 Deleted Message:*\n${original.content}\n│\n`+
            `╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯`;
        }

        await sock.sendMessage(ownerNumber, {
            text,
            mentions: [deletedBy, sender]
        });

        // Media sending
        if (original.mediaType && fs.existsSync(original.mediaPath)) {
            const mediaOptions = {
                caption: `*Deleted ${original.mediaType}*\nFrom: @${senderName}`,
                mentions: [sender]
            };

            try {
                switch (original.mediaType) {
                    case 'image':
                        await sock.sendMessage(ownerNumber, {
                            image: { url: original.mediaPath },
                            ...mediaOptions
                        });
                        break;
                    case 'sticker':
                        await sock.sendMessage(ownerNumber, {
                            sticker: { url: original.mediaPath },
                            ...mediaOptions
                        });
                        break;
                    case 'video':
                        await sock.sendMessage(ownerNumber, {
                            video: { url: original.mediaPath },
                            ...mediaOptions
                        });
                        break;
                    case 'audio':
                        await sock.sendMessage(ownerNumber, {
                            audio: { url: original.mediaPath },
                            mimetype: 'audio/mpeg',
                            ptt: false,
                            ...mediaOptions
                        });
                        break;
                }
            } catch (err) {
                await sock.sendMessage(ownerNumber, {
                    text: `⚠️ Error sending media: ${err.message}`
                });
            }

            // Cleanup
            try {
                fs.unlinkSync(original.mediaPath);
            } catch (err) {
                console.error('Media cleanup error:', err);
            }
        }

        messageStore.delete(messageId);

    } catch (err) {
        console.error('handleMessageRevocation error:', err);
    }
}

async function handleAntiViewOnceCommand(sock, chatId, message, match) {
    const policy = getPolicyConfig();
    if (isPolicyGuardEnabled() && policy.disablePrivacyBypass) {
        if (match === 'off') {
            saveAntideleteConfig({ enabled: false, antiViewOnce: false });
        }

        return sock.sendMessage(chatId, {
            text: '⚠️ Anti-view-once is disabled in compliance mode because it captures private media.'
        }, { quoted: message });
    }

    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId, {
            text: '*Only the bot owner can use this command.*'
        }, { quoted: message });
    }

    const config = loadAntideleteConfig();

    if (!match) {
        return sock.sendMessage(chatId, {
            text: `╭══✦〔 *ᴀɴᴛɪᴠɪᴇᴡᴏɴᴄᴇ ꜱᴇᴛᴜᴘ* 〕✦═╮\n│\n│ *ᴄᴜʀʀᴇɴᴛ ꜱᴛᴀᴛᴜꜱ*: ${config.antiViewOnce ? '✅ Enabled' : '❌ Disabled'}\n│\n│ *.antiviewonce on* - Enable\n│ *.antiviewonce off* - Disable\n│\n╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯`
        }, { quoted: message });
    }

    if (match === 'on') {
        config.antiViewOnce = true;
    } else if (match === 'off') {
        config.antiViewOnce = false;
    } else {
        return sock.sendMessage(chatId, {
            text: '*Invalid. Use .antiviewonce on or .antiviewonce off*'
        }, { quoted: message });
    }

    saveAntideleteConfig(config);
    return sock.sendMessage(chatId, {
        text: `*Anti-ViewOnce ${match === 'on' ? 'enabled ✅' : 'disabled ❌'}*`
    }, { quoted: message });
}

module.exports = {
    handleAntideleteCommand,
    handleAntiViewOnceCommand,
    handleMessageRevocation,
    storeMessage
};
