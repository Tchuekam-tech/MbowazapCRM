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
let slotQueue = Promise.resolve();

function refillTokens() {
    const now = Date.now();
    const elapsed = now - lastRefillTime;
    const tokensToAdd = Math.floor(elapsed / REFILL_RATE_MS);
    if (tokensToAdd > 0) {
        currentTokens = Math.min(BUCKET_CAPACITY, currentTokens + tokensToAdd);
        lastRefillTime += tokensToAdd * REFILL_RATE_MS;
        if (currentTokens === BUCKET_CAPACITY) {
            lastRefillTime = now;
        }
    }
}

/**
 * Ensures global dispatch rate does not exceed 15 messages/minute.
 * Serialized so concurrent callers cannot all fire simultaneously after one sleep.
 */
function acquireGlobalSendSlot() {
    const next = slotQueue.then(async () => {
        refillTokens();
        if (currentTokens > 0) {
            currentTokens--;
            return;
        }

        const elapsed = Date.now() - lastRefillTime;
        const waitTime = Math.max(250, REFILL_RATE_MS - elapsed);
        console.log(chalk.yellow(`[TokenBucket] ⏳ Global bucket exhausted. Pacing message by ${(waitTime / 1000).toFixed(1)}s...`));
        await new Promise(resolve => setTimeout(resolve, waitTime));
        refillTokens();
        currentTokens = Math.max(0, currentTokens - 1);
    });
    slotQueue = next.catch(() => {});
    return next;
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

function extractDigitsFromJid(senderId) {
    if (typeof senderId !== 'string' || !senderId) return '';
    return senderId.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

function isContactOptedOut(senderId) {
    const clean = extractDigitsFromJid(senderId);
    if (!clean) return false;
    return optOutContacts.has(clean);
}

function registerOptOut(senderId) {
    const clean = extractDigitsFromJid(senderId);
    if (!clean) return;
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

let warmupWriteTimer = null;
function pruneOldWarmupDays(data) {
    if (!data?.dailyCounts || typeof data.dailyCounts !== 'object') return;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const dayKey of Object.keys(data.dailyCounts)) {
        const ts = Date.parse(dayKey);
        if (Number.isFinite(ts) && ts < cutoff) {
            delete data.dailyCounts[dayKey];
        }
    }
}

function saveWarmupState(data) {
    pruneOldWarmupDays(data);
    if (warmupWriteTimer) return;
    warmupWriteTimer = setTimeout(() => {
        warmupWriteTimer = null;
        const tmp = `${WARMUP_FILE}.${process.pid}.tmp`;
        fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
            .then(() => fs.promises.rename(tmp, WARMUP_FILE))
            .catch(() => {});
    }, 500);
    if (typeof warmupWriteTimer.unref === 'function') warmupWriteTimer.unref();
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
