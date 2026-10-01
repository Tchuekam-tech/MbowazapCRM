/** Exclusive ownership of each code socket and the shared QR socket. */
const { BridgeError } = require('./protocol');
const PAIRING_TTL_MS = 120_000;

function createPairingGuard({ state, now, resetPairingSession }) {
    const inFlight = new Set();
    async function withPairing(session, ref, generate) {
        const lease = state.getPairingLease(session);
        if (inFlight.has(session) || (lease && lease.ref !== ref && now() < lease.at + PAIRING_TTL_MS)) {
            throw new BridgeError(409, 'pairing_busy', 'Another pairing is in progress. Wait for it to finish or expire.');
        }
        if (lease?.ref === ref && now() >= lease.at + PAIRING_TTL_MS) {
            throw new BridgeError(409, 'pairing_expired', 'This pairing has expired. Start a new pairing.');
        }
        if (!lease || lease.ref !== ref) {
            // Synchronous: discard every old QR/code before changing ownership.
            // Never delete credentials for a device that has already linked.
            resetPairingSession(session);
            state.setPairingRef(session, ref);
        }
        const startedAt = state.getPairingLease(session)?.at ?? now();
        inFlight.add(session);
        try {
            const result = await generate();
            if (now() >= startedAt + PAIRING_TTL_MS) {
                throw new BridgeError(409, 'pairing_expired', 'This pairing has expired. Start a new pairing.');
            }
            return result;
        } finally {
            inFlight.delete(session);
        }
    }
    withPairing.cancel = (session, ref) => {
        if (state.getPairingRef(session) !== ref) return;
        if (inFlight.has(session)) {
            throw new BridgeError(409, 'pairing_busy', 'Pairing is still starting. Please retry cancellation shortly.');
        }
        resetPairingSession(session);
        state.clearPairingRef(session);
    };
    return withPairing;
}
module.exports = { createPairingGuard, PAIRING_TTL_MS };
