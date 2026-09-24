const fs = require('fs');
const path = require('path');

const activeSockets = new Map();
const SESSIONS_ROOT = path.join(__dirname, '../data/sessions');

function normalizeSessionKey(phoneNumber) {
    const raw = String(phoneNumber || '').trim();
    const digits = raw.replace(/[^0-9]/g, '');
    return digits || raw;
}

/**
 * Get socket instance for a business number
 * @param {string} phoneNumber Business phone number
 * @returns {object|undefined} Baileys socket instance
 */
function getSocket(phoneNumber) {
    return activeSockets.get(normalizeSessionKey(phoneNumber));
}

/**
 * Set active socket instance for a business number
 * @param {string} phoneNumber Business phone number
 * @param {object} sock Baileys socket instance
 */
function setSocket(phoneNumber, sock) {
    activeSockets.set(normalizeSessionKey(phoneNumber), sock);
}

/**
 * Remove socket instance for a business number
 * @param {string} phoneNumber Business phone number
 */
function deleteSocket(phoneNumber) {
    activeSockets.delete(normalizeSessionKey(phoneNumber));
}

/**
 * Get all active business numbers and sockets
 * @returns {Array<[string, object]>}
 */
function getAllSockets() {
    return Array.from(activeSockets.entries());
}

/**
 * Whether the socket's WebSocket is open. Baileys' WebSocketClient exposes
 * `isOpen` (it has no `readyState` of its own — the raw ws does); fall back
 * to `readyState` for any other client implementation.
 */
function isSocketOpen(sock) {
    const ws = sock?.ws;
    if (!ws) return false;
    if (typeof ws.isOpen === 'boolean') return ws.isOpen;
    return ws.readyState === 1;
}

/** Whether the socket's WebSocket is closing or closed (i.e. dead, not merely still connecting). */
function isSocketClosed(sock) {
    const ws = sock?.ws;
    if (!ws) return true;
    if (typeof ws.isClosed === 'boolean') return ws.isClosed || ws.isClosing === true;
    return ws.readyState > 1;
}

/**
 * Finds which business phone number has an active TALLY_SENT session for a client,
 * and returns the corresponding socket instance.
 * 
 * @param {string} clientNumber Client phone number
 * @returns {object|null} Matching business socket instance
 */
function findSocketForClient(clientNumber) {
    const cleanClient = clientNumber.replace(/[^0-9]/g, '');
    const flowRoot = path.join(__dirname, '../data/flow_sessions');
    const targetRoot = fs.existsSync(flowRoot) ? flowRoot : SESSIONS_ROOT;
    if (!fs.existsSync(targetRoot)) return null;

    const businesses = fs.readdirSync(targetRoot);
    let fallbackBiz = null;

    for (const biz of businesses) {
        const sessionPath = path.join(targetRoot, biz, `${cleanClient}.json`);
        if (fs.existsSync(sessionPath)) {
            try {
                const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                if (session.state === 'TALLY_SENT' && !session.tallySubmitted) {
                    const sock = activeSockets.get(biz);
                    if (sock) return sock;
                }
                fallbackBiz = biz;
            } catch (_) {}
        }
    }

    if (fallbackBiz) {
        const sock = activeSockets.get(fallbackBiz);
        if (sock) return sock;
    }

    // Default to the first active socket if none found (as a safety fallback)
    if (activeSockets.size > 0) {
        return activeSockets.values().next().value;
    }

    return null;
}

module.exports = {
    getSocket,
    setSocket,
    deleteSocket,
    getAllSockets,
    findSocketForClient,
    normalizeSessionKey,
    isSocketOpen,
    isSocketClosed
};
