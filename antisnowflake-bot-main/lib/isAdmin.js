// isAdmin.js
function cleanPart(jid) {
    if (!jid || typeof jid !== 'string') return '';
    return jid.split('@')[0].split(':')[0];
}

function stripDomain(jid) {
    if (!jid || typeof jid !== 'string') return '';
    return jid.split('@')[0];
}

function nonEmptyEq(a, b) {
    return Boolean(a && b && a === b);
}

async function isAdmin(sock, chatId, senderId) {
    try {
        if (!chatId || !String(chatId).endsWith('@g.us')) {
            return { isSenderAdmin: false, isBotAdmin: false };
        }
        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata?.participants || [];

        const botId = sock.user?.id || '';
        const botLid = sock.user?.lid || '';
        const botNumber = cleanPart(botId);
        const botIdWithoutSuffix = stripDomain(botId);
        const botLidNumeric = cleanPart(botLid);
        const botLidWithoutSuffix = stripDomain(botLid);

        const senderStr = typeof senderId === 'string' ? senderId : '';
        const senderNumber = cleanPart(senderStr);
        const senderIdWithoutSuffix = stripDomain(senderStr);

        const isBotAdmin = participants.some(p => {
            if (p.admin !== 'admin' && p.admin !== 'superadmin') return false;
            const pPhoneNumber = cleanPart(p.phoneNumber || '');
            const pIdClean = cleanPart(p.id || '');
            const pIdNoDomain = stripDomain(p.id || '');
            const pLidNoDomain = stripDomain(p.lid || '');
            const pLidNumeric = cleanPart(p.lid || '');
            const pFullId = p.id || '';
            const pFullLid = p.lid || '';

            return (
                nonEmptyEq(botId, pFullId) ||
                nonEmptyEq(botId, pFullLid) ||
                nonEmptyEq(botLid, pFullLid) ||
                nonEmptyEq(botLidNumeric, pLidNumeric) ||
                nonEmptyEq(botLidWithoutSuffix, pLidNoDomain) ||
                nonEmptyEq(botNumber, pPhoneNumber) ||
                nonEmptyEq(botNumber, pIdClean) ||
                nonEmptyEq(botIdWithoutSuffix, pPhoneNumber) ||
                nonEmptyEq(botIdWithoutSuffix, pIdNoDomain) ||
                nonEmptyEq(botLidNumeric, pLidNoDomain)
            );
        });

        const isSenderAdmin = participants.some(p => {
            if (p.admin !== 'admin' && p.admin !== 'superadmin') return false;
            const pPhoneNumber = cleanPart(p.phoneNumber || '');
            const pIdClean = cleanPart(p.id || '');
            const pIdNoDomain = stripDomain(p.id || '');
            const pLidNoDomain = stripDomain(p.lid || '');
            const pLidNumeric = cleanPart(p.lid || '');
            const pFullId = p.id || '';
            const pFullLid = p.lid || '';

            return (
                nonEmptyEq(senderStr, pFullId) ||
                nonEmptyEq(senderStr, pFullLid) ||
                nonEmptyEq(senderNumber, pPhoneNumber) ||
                nonEmptyEq(senderNumber, pIdClean) ||
                nonEmptyEq(senderNumber, pLidNumeric) ||
                nonEmptyEq(senderIdWithoutSuffix, pPhoneNumber) ||
                nonEmptyEq(senderIdWithoutSuffix, pIdNoDomain) ||
                nonEmptyEq(senderIdWithoutSuffix, pLidNoDomain)
            );
        });

        return { isSenderAdmin, isBotAdmin };
    } catch (err) {
        console.error('❌ Error in isAdmin:', err);
        return { isSenderAdmin: false, isBotAdmin: false };
    }
}

module.exports = isAdmin;
