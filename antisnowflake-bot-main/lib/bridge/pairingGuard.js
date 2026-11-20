/** Exclusive ownership of each code socket and the shared QR socket. */
const { BridgeError, TEMP_QR_SESSION } = require('./protocol');
const PAIRING_TTL_MS = 120_000;

function createPairingGuard({ state, now, resetPairingSession }) {
    const inFlight = new Set();
    async function withPairing(session, ref, generate) {
        const statusSession = session !== TEMP_QR_SESSION ? session : undefined;
        const lease = state.getPairingLease(session);
        if (inFlight.has(session) || (lease && lease.ref !== ref && now() < lease.at + PAIRING_TTL_MS)) {
            throw new BridgeError(409, 'pairing_busy', 'Another pairing is in progress. Wait for it to finish or expire.');
        }
        if (lease?.ref === ref && now() >= lease.at + PAIRING_TTL_MS) {
            throw new BridgeError(409, 'pairing_expired', 'This pairing has expired. Start a new pairing.');
        }
        const isNewLease = !lease || lease.ref !== ref;
        if (isNewLease) {
            // Synchronous: discard every old QR/code before changing ownership.
            // Never delete credentials for a device that has already linked.
            resetPairingSession(session);
            state.setPairingRef(session, ref);
            state.recordPairingStatus?.(ref, { state: 'waiting', session: statusSession });
        }
        const startedAt = state.getPairingLease(session)?.at ?? now();
        inFlight.add(session);
        try {
            const result = await generate();
            if (now() >= startedAt + PAIRING_TTL_MS) {
                if (state.getPairingRef(session) === ref) state.clearPairingRef(session);
                throw new BridgeError(409, 'pairing_expired', 'This pairing has expired. Start a new pairing.');
            }
            return result;
        } catch (err) {
            // Keep the lease only while the QR socket is still booting
            // (`pairing_pending`) so the caller can retry with the same ref.
            // Terminal failures release the lease immediately so a failed
            // attempt cannot block retries with 409 pairing_busy for 2 minutes.
            const code = err instanceof BridgeError ? err.code : null;
            if (code !== 'pairing_pending') {
                if ((isNewLease || code === 'pairing_failed') && state.getPairingRef(session) === ref) {
                    state.clearPairingRef(session);
                }
                if (code === 'pairing_failed') {
                    state.recordPairingStatus?.(ref, {
                        state: 'failed',
                        session: statusSession,
                        reason: err.message,
                    });
                }
            }
            throw err;
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
        state.clearPairingStatus?.(ref);
    };
    return withPairing;
}
module.exports = { createPairingGuard, PAIRING_TTL_MS };
