const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

// Memory-based state store (resets cleanly on bot restart)
const state = new Map();

// File persistence paths
const DATA_DIR = path.join(__dirname, '../data');
const OPTOUT_FILE = path.join(DATA_DIR, 'optout_contacts.json');
const WARMUP_FILE = path.join(DATA_DIR, 'warmup_state.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─────────────────────────────────────────────────────────────
// 1. GLOBAL TOKEN BUCKET (Max 15 messages / minute across all chats)
// ─────────────────────────────────────────────────────────────
const BUCKET_CAPACITY = 15;
const REFILL_RATE_MS = 4000; // 1 token every 4 seconds = 15 tokens / minute
let currentTokens = BUCKET_CAPACITY;
let lastRefillTime = Date.now();

function refillTokens() {
    const now = Date.now();
    const elapsed = now - lastRefillTime;
    const tokensToAdd = Math.floor(elapsed / REFILL_RATE_MS);
    if (tokensToAdd > 0) {
        currentTokens = Math.min(BUCKET_CAPACITY, currentTokens + tokensToAdd);
        lastRefillTime = now;
    }
}

/**
 * Ensures global dispatch rate does not exceed 15 messages/minute.
 * Suspends execution asynchronously until a token slot becomes available.
 */
async function acquireGlobalSendSlot() {
    refillTokens();
    if (currentTokens > 0) {
        currentTokens--;
        return;
    }

    const waitTime = REFILL_RATE_MS;
    console.log(chalk.yellow(`[TokenBucket] ⏳ Global bucket exhausted. Pacing message by ${waitTime / 1000}s...`));
    await new Promise(resolve => setTimeout(resolve, waitTime));
    refillTokens();
    currentTokens = Math.max(0, currentTokens - 1);
}

// ─────────────────────────────────────────────────────────────
// 2. OPT-OUT & REPORT PREVENTION (STOP / ARRÊT)
// ─────────────────────────────────────────────────────────────
const EXACT_STOP_KEYWORDS = new Set([
    'stop', 'arret', 'arrêt', 'unsubscribe', 'quitter', 
    'annuler', 'desinscrire', 'désinscrire', 'bloquer'
]);

const STOP_PHRASES = [
    'ne plus mecrire', "ne plus m'écrire", "arrete de mecrire", "arrête de m'écrire",
    "arretez de mecrire", "arrêtez de m'écrire", "pas interesse", "pas intéressé",
    "laisse moi tranquille", "supprimez mon numero", "supprimez mon numéro"
];

function isStopRequested(text = '') {
    const clean = text.toLowerCase().replace(/[^\w\s\u00C0-\u017F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return false;

    // Exact single-word or two-word keyword
    if (EXACT_STOP_KEYWORDS.has(clean)) return true;

    // Phrase match in short messages (<= 8 words)
    const wordCount = clean.split(' ').length;
    if (wordCount <= 8) {
        if (STOP_PHRASES.some(phrase => clean.includes(phrase))) {
            return true;
        }
    }
    return false;
}

function loadOptOutSet() {
    try {
        if (fs.existsSync(OPTOUT_FILE)) {
            const list = JSON.parse(fs.readFileSync(OPTOUT_FILE, 'utf8'));
            return new Set(Array.isArray(list) ? list : []);
        }
    } catch (e) {
        console.error('[AntiSpam] Error reading optout file:', e.message);
    }
    return new Set();
}

function saveOptOutSet(set) {
    try {
        fs.writeFileSync(OPTOUT_FILE, JSON.stringify(Array.from(set), null, 2), 'utf8');
    } catch (e) {
        console.error('[AntiSpam] Error writing optout file:', e.message);
    }
}

let optOutContacts = loadOptOutSet();

function isContactOptedOut(senderId) {
    const clean = senderId.split('@')[0].replace(/[^0-9]/g, '');
    return optOutContacts.has(clean);
}

function registerOptOut(senderId) {
    const clean = senderId.split('@')[0].replace(/[^0-9]/g, '');
    optOutContacts.add(clean);
    saveOptOutSet(optOutContacts);
}

// ─────────────────────────────────────────────────────────────
// 3. HUMAN TAKEOVER KEYWORDS
// ─────────────────────────────────────────────────────────────
const HUMAN_KEYWORDS = [
    'humain', 'agent', 'personne', 'parler a quelquun', 
    "parler à quelqu'un", 'responsable', 'directeur', 
    'm. tchuekam', 'loic', 'conseiller', 'vrai personne'
];

function isHumanRequested(text = '') {
    const clean = text.toLowerCase().trim();
    return HUMAN_KEYWORDS.some(k => clean.includes(k));
}

// ─────────────────────────────────────────────────────────────
// 4. WARMUP RAMP CONTROLLER
// ─────────────────────────────────────────────────────────────
function loadWarmupState() {
    try {
        if (fs.existsSync(WARMUP_FILE)) {
            return JSON.parse(fs.readFileSync(WARMUP_FILE, 'utf8'));
        }
    } catch (_) {}
    const initial = {
        sessionStartedAt: Date.now(),
        dailyCounts: {}
    };
    try { fs.writeFileSync(WARMUP_FILE, JSON.stringify(initial, null, 2), 'utf8'); } catch (_) {}
    return initial;
}

function saveWarmupState(data) {
    try {
        fs.writeFileSync(WARMUP_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (_) {}
}

let warmupState = loadWarmupState();

/**
 * Returns allowed daily auto-reply limit based on account/session age
 */
function getWarmupDailyLimit() {
    const daysActive = Math.floor((Date.now() - (warmupState.sessionStartedAt || Date.now())) / (1000 * 60 * 60 * 24));
    if (daysActive <= 3) return { daysActive, limit: 15 };
    if (daysActive <= 7) return { daysActive, limit: 35 };
    if (daysActive <= 14) return { daysActive, limit: 70 };
    return { daysActive, limit: 200 }; // Standard mature limit
}

// Helper to check if a sender is the owner
function isOwner(senderId, activeSettings) {
    const ownerNum = activeSettings.ownerNumber || '237653683174';
    const cleanedOwner = ownerNum.replace(/[^0-9]/g, '');
    const cleanedSender = senderId.split('@')[0].replace(/[^0-9]/g, '');
    return cleanedSender === cleanedOwner;
}

/**
 * Comprehensive incoming message security gate
 */
async function processSecurityCheck(sock, senderId, senderName, activeSettings, incomingText = '') {
    const now = Date.now();

    // Owner Bypass Check
    if (isOwner(senderId, activeSettings)) {
        return { allowed: true };
    }

    // Check if contact already opted out
    if (isContactOptedOut(senderId)) {
        console.log(chalk.yellow(`[AntiSpam] Silently ignoring message from opted-out contact ${senderId.split('@')[0]}`));
        return { allowed: false, reason: 'ALREADY_OPTED_OUT' };
    }

    // Check for explicit Opt-Out (STOP)
    if (isStopRequested(incomingText)) {
        registerOptOut(senderId);
        console.log(chalk.bold(chalk.red(`[AntiSpam] 🛑 Contact ${senderId.split('@')[0]} requested STOP. Opted out permanently.`)));
        
        try {
            const bridgeState = require('./bridge/state');
            const { getReporter, extractChatRef } = require('./bridge/reporter');
            const session = bridgeState.sessionKeyForSocket(sock);
            if (session) {
                const chatRef = extractChatRef(senderId);
                getReporter().reportContactOptedOut(session, chatRef);
            }
        } catch (_) {}

        try {
            await sock.sendMessage(senderId, {
                text: "✅ Votre demande d'arrêt a bien été prise en compte. Vous ne recevrez plus aucun message automatique de notre part. Bonne continuation !"
            });
        } catch (_) {}

        // Notify owner
        try {
            const ownerNum = (activeSettings.ownerNumber || '237653683174').replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            await sock.sendMessage(ownerNum, {
                text: `ℹ️ *Notification Opt-Out*\n\nLe contact @${senderId.split('@')[0]} a envoyé *STOP* et a été désinscrit automatiquement pour protéger le numéro des signalements.`,
                mentions: [senderId]
            });
        } catch (_) {}

        return { allowed: false, reason: 'OPT_OUT_REQUESTED' };
    }

    // Check for Human Agent Request
    if (isHumanRequested(incomingText)) {
        console.log(chalk.bold(chalk.cyan(`[AntiSpam] 👤 Contact ${senderId.split('@')[0]} requested a human agent.`)));
        
        try {
            const bridgeState = require('./bridge/state');
            const { getReporter, extractChatRef } = require('./bridge/reporter');
            const session = bridgeState.sessionKeyForSocket(sock);
            if (session) {
                const chatRef = extractChatRef(senderId);
                getReporter().reportAiPaused(session, chatRef, Date.now() + 10 * 60 * 1000);
            }
        } catch (_) {}

        try {
            await sock.sendMessage(senderId, {
                text: "Bien reçu ! Je mets en pause mes réponses automatiques dans cette conversation. Un conseiller humain de l'équipe Tchuek-Tech prendra le relais sous peu. Merci de votre patience !"
            });
        } catch (_) {}

        // Notify owner and pause AI in memory
        try {
            const ownerNum = (activeSettings.ownerNumber || '237653683174').replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            await sock.sendMessage(ownerNum, {
                text: `🚨 *DEMANDE DE CONSEILLER HUMAIN*\n\nLe prospect @${senderId.split('@')[0]} (${senderName}) a demandé à parler à une personne.\n\n_⏸️ L'IA a été mise en pause pour vous laisser la main._`,
                mentions: [senderId]
            });
        } catch (_) {}

        return { allowed: false, reason: 'HUMAN_TAKEOVER_REQUESTED', pauseAi: true };
    }

    // Warmup Ramp Check
    const todayKey = new Date().toISOString().split('T')[0];
    const { daysActive, limit: warmupLimit } = getWarmupDailyLimit();
    const todayCount = (warmupState.dailyCounts[todayKey] || 0);

    if (todayCount >= warmupLimit) {
        console.log(chalk.red(`[Warmup Ramp] ⚠️ Daily safety ceiling reached (${todayCount}/${warmupLimit} on Day ${daysActive}). Protecting account from suspension.`));
        return { allowed: false, reason: 'WARMUP_DAILY_CAP_REACHED' };
    }

    // Initialize in-memory state if not present
    if (!state.has(senderId)) {
        state.set(senderId, {
            hourlyCount: 0,
            hourStart: now,
            unansweredCount: 0,
            blacklisted: false
        });
    }

    const contactState = state.get(senderId);

    // Rule 2 Check & Reset: If prospect messages us, lift any unanswered blacklist
    if (contactState.blacklisted) {
        contactState.blacklisted = false;
        contactState.unansweredCount = 0;
        console.log(chalk.bold(chalk.blue(`[AntiSpam] Unblacklisted ${senderId.split('@')[0]} — contact replied`)));
    } else {
        contactState.unansweredCount = 0;
    }

    // Reset hourly count if 1-hour window expired
    if (now - contactState.hourStart > 3600000) {
        contactState.hourlyCount = 0;
        contactState.hourStart = now;
    }

    // Rule 1 Enforcement: Hourly Cap per contact
    if (contactState.hourlyCount >= 20) {
        const silentUntil = new Date(contactState.hourStart + 3600000).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Douala' });
        console.log(chalk.bold(chalk.yellow(`[AntiSpam] Cap reached for ${senderId.split('@')[0]} — silent until ${silentUntil}`)));
        return { allowed: false, reason: 'HOURLY_LIMIT_EXCEEDED' };
    }

    return { allowed: true };
}

/**
 * Tracks that a bot response was successfully sent to the contact.
 */
async function recordBotResponse(sock, senderId, senderName, activeSettings) {
    if (isOwner(senderId, activeSettings)) {
        return;
    }

    // Increment warmup daily count
    const todayKey = new Date().toISOString().split('T')[0];
    warmupState.dailyCounts[todayKey] = (warmupState.dailyCounts[todayKey] || 0) + 1;
    saveWarmupState(warmupState);

    if (!state.has(senderId)) {
        state.set(senderId, {
            hourlyCount: 0,
            hourStart: Date.now(),
            unansweredCount: 0,
            blacklisted: false
        });
    }

    const contactState = state.get(senderId);

    if (Date.now() - contactState.hourStart > 3600000) {
        contactState.hourlyCount = 0;
        contactState.hourStart = Date.now();
    }

    contactState.hourlyCount++;
    contactState.unansweredCount++;

    // Blacklist prospect permanently if they ignore 2 consecutive bot messages
    if (contactState.unansweredCount >= 2) {
        contactState.blacklisted = true;
        console.log(chalk.bold(chalk.red(`[AntiSpam] Blacklisted ${senderId.split('@')[0]} — 2 unanswered messages`)));

        try {
            let ownerJid = activeSettings.ownerNumber || '237653683174';
            if (!ownerJid.endsWith('@s.whatsapp.net')) {
                ownerJid = ownerJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            }

            const alertText = `🚨 *TCHUEK-TECH SECURITY ALERT* 🚨\n\n*Prospect mis en sourdine (Lead froid)*\n👤 *Nom*: ${senderName}\n📱 *Numéro*: @${senderId.split('@')[0]}\n🕒 *Heure*: ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala' })}\n\n*Raison*: 2 messages du bot restés sans réponse. Le bot n'enverra plus de relance automatique pour éviter les signalements. Vous pouvez reprendre la main manuellement.`;

            await sock.sendMessage(ownerJid, { 
                text: alertText, 
                mentions: [senderId] 
            });
        } catch (alertErr) {
            console.error('[AntiSpam] Failed to dispatch owner alert:', alertErr.message);
        }
    }
}

module.exports = {
    processSecurityCheck,
    recordBotResponse,
    acquireGlobalSendSlot,
    isContactOptedOut,
    isStopRequested,
    isHumanRequested
};
