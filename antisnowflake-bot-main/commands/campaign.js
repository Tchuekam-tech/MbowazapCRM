const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const { getPolicyConfig, isPolicyGuardEnabled } = require('../lib/policyGuard');

const CAMPAIGN_HISTORY_FILE = path.join(__dirname, '../data/campaignHistory.json');

let isCampaignRunning = false;

/**
 * Load campaign history from disk fallback
 */
function loadCampaignHistoryFile() {
    try {
        if (fs.existsSync(CAMPAIGN_HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(CAMPAIGN_HISTORY_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[Campaign] Failed to read campaign history file:', e.message);
    }
    return {};
}

/**
 * Save campaign history to disk fallback
 */
function saveCampaignHistoryFile(history) {
    try {
        const dir = path.dirname(CAMPAIGN_HISTORY_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CAMPAIGN_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
        console.error('[Campaign] Failed to write campaign history file:', e.message);
    }
}

/**
 * Highly accurate estimated campaign duration calculator
 */
function estimateCompletionTime(totalContacts) {
    if (totalContacts === 0) return "0 minutes";

    let totalSeconds = 0;
    let activeHours = 0;
    
    for (let i = 1; i <= totalContacts; i++) {
        // Random delay average: 12.5 seconds (between 5s and 20s)
        totalSeconds += 12.5; 
        
        // Every 60 messages, sliding rate limit wait kicks in to cap 60/hour limit
        if (i % 60 === 0 && i < totalContacts) {
            // Average active sending time for 60 messages is 750 seconds (12.5 mins).
            // Rate limit forces cooldown of the remaining 2850 seconds to complete the hour.
            totalSeconds += (3600 - 750); 
        }

        // Add 2-hour active sending block pauses
        const currentActiveHours = Math.floor(totalSeconds / 7200);
        if (currentActiveHours > activeHours) {
            activeHours = currentActiveHours;
            // Add average pause duration: 32.5 minutes (1950 seconds)
            totalSeconds += 1950;
        }
    }

    const minutes = Math.ceil(totalSeconds / 60);
    if (minutes < 60) {
        return `${minutes} minute(s)`;
    } else {
        const hrs = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hrs} hour(s) and ${mins} minute(s)`;
    }
}

/**
 * Asynchronous background campaign loop
 */
async function runCampaign(sock, chatId, ownerJid, limit, campaignMessage) {
    isCampaignRunning = true;
    let sentCount = 0;
    let skippedCount = 0;
    
    const store = require('../lib/lightweight_store');
    
    // Filter and sanitize JIDs from the Baileys session store
    const allContacts = Object.keys(store.contacts).filter(jid => {
        if (!jid.endsWith('@s.whatsapp.net')) return false;
        
        // Exclude bot's own number
        const botNum = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        if (jid === botNum) return false;
        
        // Exclude owner number
        const ownerNum = (settings.ownerNumber || '237653683174').replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        if (jid === ownerNum) return false;
        
        return true;
    });

    const localHistory = loadCampaignHistoryFile();
    const targets = [];
    
    // Apply strict weekly frequency limits and single campaign limits
    for (const jid of allContacts) {
        if (targets.length >= limit) break;

        let alreadyReceived = false;
        let lastSent = 0;

        const record = localHistory[jid];
        if (record) {
            alreadyReceived = true;
            lastSent = record.lastSent;
        }

        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        const isWithinWeek = alreadyReceived && (Date.now() - lastSent < oneWeek);

        if (alreadyReceived || isWithinWeek) {
            skippedCount++;
            continue;
        }

        targets.push(jid);
    }

    // Send initiation report to owner
    const estimatedTime = estimateCompletionTime(targets.length);
    await sock.sendMessage(chatId, {
        text: `📢 *[CAMPAIGN INITIATED]*\n` +
              `═════════════════════════════\n` +
              `🎯 *Target Contacts*: ${targets.length}\n` +
              `⏳ *Estimated Duration*: ${estimatedTime}\n` +
              `🚀 *Status*: Active in background...\n` +
              `═════════════════════════════`
    });

    if (targets.length === 0) {
        isCampaignRunning = false;
        const summary = `📊 *[CAMPAIGN COMPLETED]*\n` +
                        `═════════════════════════════\n` +
                        `✅ *Sent Successfully*: 0\n` +
                        `⏭️ *Skipped / Already Sent*: ${skippedCount}\n` +
                        `ℹ️ Reason: No new eligible contacts found.\n` +
                        `═════════════════════════════`;
        await sock.sendMessage(chatId, { text: summary });
        return;
    }

    let campaignStartTime = Date.now();
    const sentTimestamps = [];

    for (let i = 0; i < targets.length; i++) {
        const jid = targets[i];

        // 1. Sliding window rate limiter (max 60/hour)
        let now = Date.now();
        while (sentTimestamps.length > 0 && now - sentTimestamps[0] > 3600000) {
            sentTimestamps.shift();
        }
        if (sentTimestamps.length >= 60) {
            const oldestTime = sentTimestamps[0];
            const timeToWait = 3600000 - (Date.now() - oldestTime);
            if (timeToWait > 0) {
                console.log(`[Campaign] Sliding hour limit reached (60/hr). Pausing campaign for ${Math.ceil(timeToWait / 1000 / 60)} minutes...`);
                await new Promise(r => setTimeout(r, timeToWait));
            }
        }

        // 2. Continuous sending block check (pause 25-40 mins after 2h of sending)
        const elapsedActive = Date.now() - campaignStartTime;
        if (elapsedActive >= 2 * 60 * 60 * 1000) {
            const pauseMinutes = Math.floor(Math.random() * (40 - 25 + 1)) + 25;
            console.log(`[Campaign] 2-hour sending threshold exceeded. Pausing campaign for ${pauseMinutes} minutes...`);
            await new Promise(r => setTimeout(r, pauseMinutes * 60 * 1000));
            campaignStartTime = Date.now(); // reset timer
        }

        // 3. Dispatch message
        try {
            await sock.sendMessage(jid, { text: campaignMessage });
            sentCount++;
            sentTimestamps.push(Date.now());

            // 4. Save campaign history state to disk
            const timestamp = Date.now();
            const history = loadCampaignHistoryFile();
            history[jid] = { jid, lastSent: timestamp };
            saveCampaignHistoryFile(history);

            console.log(`[Campaign] [${i + 1}/${targets.length}] Dispatched message successfully to ${jid}`);
        } catch (sendErr) {
            console.error(`[Campaign] Failed to dispatch to ${jid}:`, sendErr.message);
            skippedCount++;
        }

        // 5. Anti-spam delay: 5 to 20 seconds randomized
        if (i < targets.length - 1) {
            const randomDelay = Math.floor(Math.random() * (20000 - 5000 + 1)) + 5000;
            await new Promise(r => setTimeout(r, randomDelay));
        }
    }

    isCampaignRunning = false;

    // Send execution report
    const summary = `📊 *[CAMPAIGN COMPLETED]*\n` +
                    `═════════════════════════════\n` +
                    `✅ *Sent Successfully*: ${sentCount}\n` +
                    `⏭️ *Skipped / Already Sent*: ${skippedCount}\n` +
                    `═════════════════════════════`;
    
    await sock.sendMessage(chatId, { text: summary });
    if (chatId !== ownerJid) {
        await sock.sendMessage(ownerJid, { text: summary });
    }
}

/**
 * Entry command trigger for the broadcast campaign module
 */
async function handleCampaignCommand(sock, chatId, message) {
    const policy = getPolicyConfig();
    if (isPolicyGuardEnabled() && policy.blockHighRiskCommands) {
        return sock.sendMessage(chatId, {
            text: '⚠️ Campaign broadcasts are disabled in compliance mode because bulk messaging creates a high ban risk.'
        }, { quoted: message });
    }

    const senderId = message.key.participant || message.key.remoteJid;
    
    const ownerNum = settings.ownerNumber || '237653683174';
    const cleanedOwner = ownerNum.replace(/[^0-9]/g, '');
    const cleanedSender = senderId.split('@')[0].replace(/[^0-9]/g, '');

    const isOwner = cleanedSender === cleanedOwner || message.key.fromMe;

    if (!isOwner) {
        return sock.sendMessage(chatId, { text: '❌ Access Denied: Only the bot owner can execute broadcast campaigns.' }, { quoted: message });
    }

    if (isCampaignRunning) {
        return sock.sendMessage(chatId, { text: '❌ Active Campaign Block: Another campaign is currently running in the background.' }, { quoted: message });
    }

    const msgContent = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    
    // Command format: .campaign @100 "your message here"
    const regex = /^\.campaign\s+@(\d+)\s+["'“”](.*?)["'“”]/is;
    let match = msgContent.match(regex);

    if (!match) {
        // Fallback for relaxed quotes or no quotes
        const fallbackRegex = /^\.campaign\s+@(\d+)\s+(.+)/is;
        match = msgContent.match(fallbackRegex);
        if (!match) {
            return sock.sendMessage(chatId, { text: '❌ Invalid Command Format. Use:\n`.campaign @100 "your message here"`' }, { quoted: message });
        }
    }

    const limit = parseInt(match[1]);
    const campaignMessage = match[2].trim();

    if (isNaN(limit) || limit <= 0) {
        return sock.sendMessage(chatId, { text: '❌ Invalid Parameter: The contact limit must be a positive integer.' }, { quoted: message });
    }

    const ownerJid = cleanedOwner + '@s.whatsapp.net';

    // Spawn the non-blocking background campaign executor loop
    runCampaign(sock, chatId, ownerJid, limit, campaignMessage).catch(err => {
        console.error('[Campaign] Asynchronous execution failed:', err.message);
        isCampaignRunning = false;
    });
}

module.exports = handleCampaignCommand;
