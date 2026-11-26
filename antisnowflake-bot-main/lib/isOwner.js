const settings = require('../settings');
const { isSudo } = require('./index');

function cleanNumericId(jid) {
    if (!jid || typeof jid !== 'string') return '';
    return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    if (!senderId || typeof senderId !== 'string') return false;

    const ownerNumberClean = cleanNumericId(String(settings.ownerNumber || ''));
    const ownerJid = ownerNumberClean ? `${ownerNumberClean}@s.whatsapp.net` : '';

    // Direct JID match
    if (ownerJid && senderId === ownerJid) {
        return true;
    }

    // Extract sender's numeric parts
    const senderIdClean = cleanNumericId(senderId);
    const senderLidNumeric = senderId.includes('@lid') ? cleanNumericId(senderId) : '';

    // Check if sender's phone number matches owner number
    if (ownerNumberClean && senderIdClean && senderIdClean === ownerNumberClean) {
        return true;
    }

    // In groups, check if sender's LID matches bot's LID or owner's participant record
    if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
        try {
            const botLid = sock.user?.lid || '';
            const botLidNumeric = cleanNumericId(botLid);

            // Check if sender's LID numeric matches bot's LID numeric
            if (senderLidNumeric && botLidNumeric && senderLidNumeric === botLidNumeric) {
                return true;
            }

            // Look up THIS sender in group participants (NEVER match by ownerNumberClean here!)
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata?.participants || [];

            const participant = participants.find(p => {
                const pLid = p.lid || '';
                const pLidNumeric = cleanNumericId(pLid);
                const pId = p.id || '';
                const pIdClean = cleanNumericId(pId);

                return (
                    (pLid && pLid === senderId) ||
                    (pId && pId === senderId) ||
                    (senderLidNumeric && pLidNumeric && pLidNumeric === senderLidNumeric) ||
                    (senderIdClean && pIdClean && pIdClean === senderIdClean)
                );
            });

            if (participant) {
                const participantId = participant.id || '';
                const participantLid = participant.lid || '';
                const participantPhone = participant.phoneNumber || '';
                const participantIdClean = cleanNumericId(participantId);
                const participantPhoneClean = cleanNumericId(participantPhone);
                const participantLidNumeric = cleanNumericId(participantLid);

                if (
                    (ownerJid && participantId === ownerJid) ||
                    (ownerNumberClean && participantIdClean && participantIdClean === ownerNumberClean) ||
                    (ownerNumberClean && participantPhoneClean && participantPhoneClean === ownerNumberClean) ||
                    (botLidNumeric && participantLidNumeric && participantLidNumeric === botLidNumeric)
                ) {
                    return true;
                }
            }
        } catch (e) {
            console.error('❌ [isOwner] Error checking participant data:', e);
        }
    }

    // Check sudo status
    try {
        return await isSudo(senderId);
    } catch (e) {
        console.error('❌ [isOwner] Error checking sudo:', e);
        return false;
    }
}

module.exports = isOwnerOrSudo;
