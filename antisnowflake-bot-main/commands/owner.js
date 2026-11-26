const settings = require('../settings');

async function ownerCommand(sock, chatId, message = null) {
    const cleanDigits = String(settings.ownerNumber || '').replace(/[^0-9]/g, '');
    const displayName = settings.botOwner || 'Tchuek Bot Owner';
    const vcard =
        `BEGIN:VCARD\n` +
        `VERSION:3.0\n` +
        `FN:${displayName}\n` +
        `TEL;type=CELL;type=VOICE;waid=${cleanDigits}:+${cleanDigits}\n` +
        `END:VCARD`;

    await sock.sendMessage(
        chatId,
        {
            contacts: { displayName, contacts: [{ vcard }] },
        },
        message ? { quoted: message } : undefined
    );
}

module.exports = ownerCommand;
