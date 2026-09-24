const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBridgeState, PAUSE_FOREVER, contactKeyFromJid } = require('../../lib/bridge/state');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-state-'));
}

function makeState(overrides = {}) {
    const clock = { now: 1_700_000_000_000 };
    const state = createBridgeState({ baseDir: tempDir(), now: () => clock.now, getAllSockets: () => [], ...overrides });
    return { state, clock };
}

test('crm-sent ids expire after 10 minutes', () => {
    const { state, clock } = makeState();
    state.markCrmSent('3EB0AAA');
    assert.equal(state.wasSentByCrm('3EB0AAA'), true);
    assert.equal(state.wasSentByCrm('3EB0BBB'), false);
    clock.now += 10 * 60 * 1000 + 1;
    assert.equal(state.wasSentByCrm('3EB0AAA'), false);
});

test('pairing refs can be moved from temp_qr to the scanned number', () => {
    const { state } = makeState();
    state.setPairingRef('temp_qr', 'ref-1');
    state.movePairingRef('temp_qr', '237600000001');
    assert.equal(state.getPairingRef('temp_qr'), null);
    assert.equal(state.getPairingRef('237600000001'), 'ref-1');
    state.clearPairingRef('237600000001');
    assert.equal(state.getPairingRef('237600000001'), null);
});

test('Davila is on by default and the switch persists on disk', () => {
    const baseDir = tempDir();
    const first = createBridgeState({ baseDir, getAllSockets: () => [] });
    assert.equal(first.isDavilaEnabled('237600000001'), true);
    first.setDavilaEnabled('237600000001', false);
    assert.equal(first.isDavilaEnabled('237600000001'), false);

    const afterRestart = createBridgeState({ baseDir, getAllSockets: () => [] });
    assert.equal(afterRestart.isDavilaEnabled('237600000001'), false);
    assert.equal(afterRestart.isDavilaEnabled('237600000002'), true);
    assert.throws(() => first.setDavilaEnabled('../../etc', false), /Invalid session key/);
});

test('isDavilaEnabledForSocket resolves the socket to its paired number', () => {
    const sock = {};
    const { state } = makeState({ getAllSockets: () => [['237600000001', sock]] });
    state.setDavilaEnabled('237600000001', false);
    assert.equal(state.isDavilaEnabledForSocket(sock), false);
    assert.equal(state.isDavilaEnabledForSocket({}), true);
});

test('contact pauses: timed, forever, resumed, and persisted', () => {
    const baseDir = tempDir();
    const clock = { now: 1_700_000_000_000 };
    const state = createBridgeState({ baseDir, now: () => clock.now, getAllSockets: () => [] });

    state.setContactPause('237699999999', clock.now + 60_000);
    assert.equal(state.isContactPaused('237699999999'), true);
    clock.now += 60_001;
    assert.equal(state.isContactPaused('237699999999'), false);

    state.setContactPause('237699999999', PAUSE_FOREVER);
    const afterRestart = createBridgeState({ baseDir, now: () => clock.now, getAllSockets: () => [] });
    assert.equal(afterRestart.getContactPause('237699999999'), PAUSE_FOREVER);

    afterRestart.setContactPause('237699999999', null);
    assert.equal(afterRestart.isContactPaused('237699999999'), false);
    assert.throws(() => state.setContactPause('abc', null), /Invalid contact key/);
});

test('contactKeyFromJid strips the device and server parts', () => {
    assert.equal(contactKeyFromJid('237600000001:12@s.whatsapp.net'), '237600000001');
    assert.equal(contactKeyFromJid('123456789012@lid'), '123456789012');
});

test('concurrent Davila runs for one contact: a finishing run removes only itself, cancel stops them all', () => {
    const state = createBridgeState({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-runs-')) });
    const contact = '237611111111';
    const first = { cancelled: false };
    const second = { cancelled: false };

    state.registerActiveDavilaRun(contact, first);
    state.registerActiveDavilaRun(contact, second);

    // The first run finishes while the second is still generating.
    state.unregisterActiveDavilaRun(contact, first);
    assert.equal(state.cancelActiveDavilaRun(contact, 'agent_send'), true);
    assert.equal(second.cancelled, true);
    assert.equal(first.cancelled, false);

    // Both register again; a takeover cancels both.
    const third = { cancelled: false };
    const fourth = { cancelled: false };
    state.registerActiveDavilaRun(contact, third);
    state.registerActiveDavilaRun(contact, fourth);
    state.cancelActiveDavilaRun(contact, 'phone_outbound_detected');
    assert.equal(third.cancelled, true);
    assert.equal(fourth.cancelled, true);
    assert.equal(state.cancelActiveDavilaRun(contact), false);
});
