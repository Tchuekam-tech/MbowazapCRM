/**
 * Intent Detector for MboWazap Flow
 * Reliably maps WhatsApp interactive actions or equivalent text inputs
 * to deterministic flow intents without external API calls.
 */

/**
 * Detects flow intents from a serialized Baileys message
 * @param {object} m Serialized message object
 * @returns {{intent: string, value?: string}} Detected intent and value mapping
 */
function detectIntent(m, currentState = '') {
    const body = (m.body || m.text || "").trim();
    const msg = m.message;
    
    // Extract interactive identifiers if present
    const selectedButtonId = 
        msg?.buttonsResponseMessage?.selectedButtonId ||
        msg?.templateButtonReplyMessage?.selectedId ||
        m.msg?.selectedButtonId;

    const selectedRowId = 
        msg?.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.msg?.singleSelectReply?.selectedRowId;

    const interactiveId = selectedButtonId || selectedRowId || body;

    // 1. Direct interactive ID matches
    if (interactiveId === 'btn_salon') return { intent: 'SELECT_SALON', value: 'salon' };
    if (interactiveId === 'btn_clinic') return { intent: 'SELECT_CLINIC', value: 'clinic' };
    if (interactiveId === 'btn_large') return { intent: 'SELECT_LARGE', value: 'large' };

    if (interactiveId === 'row_obj_1') return { intent: 'SELECT_OBJ_1', value: 'obj_1' };
    if (interactiveId === 'row_obj_2') return { intent: 'SELECT_OBJ_2', value: 'obj_2' };
    if (interactiveId === 'row_obj_3') return { intent: 'SELECT_OBJ_3', value: 'obj_3' };
    if (interactiveId === 'row_obj_4') return { intent: 'SELECT_OBJ_4', value: 'obj_4' };

    if (interactiveId === 'btn_ready' || interactiveId === 'btn_ready_start') return { intent: 'READY' };
    if (interactiveId === 'btn_questions') return { intent: 'QUESTIONS' };

    if (interactiveId === 'btn_confirm_yes') return { intent: 'CONFIRM_YES' };
    if (interactiveId === 'btn_confirm_change') return { intent: 'CONFIRM_CHANGE' };

    if (interactiveId === 'row_faq_how') return { intent: 'FAQ_HOW' };
    if (interactiveId === 'row_faq_delivery') return { intent: 'FAQ_DELIVERY' };
    if (interactiveId === 'row_faq_payment') return { intent: 'FAQ_PAYMENT' };
    if (interactiveId === 'row_faq_pack') return { intent: 'FAQ_PACK' };
    if (interactiveId === 'btn_faq_other') return { intent: 'FAQ_OTHER' };

    // 2. Numeric / Digit Fallback according to current state
    const cleanNum = body.replace(/[^0-9]/g, '');
    if (cleanNum) {
        if (currentState === 'AWAITING_Q1') {
            if (cleanNum === '1') return { intent: 'SELECT_SALON', value: 'salon' };
            if (cleanNum === '2') return { intent: 'SELECT_CLINIC', value: 'clinic' };
            if (cleanNum === '3') return { intent: 'SELECT_LARGE', value: 'large' };
        } else if (currentState === 'AWAITING_Q2') {
            if (cleanNum === '1') return { intent: 'SELECT_OBJ_1', value: 'obj_1' };
            if (cleanNum === '2') return { intent: 'SELECT_OBJ_2', value: 'obj_2' };
            if (cleanNum === '3') return { intent: 'SELECT_OBJ_3', value: 'obj_3' };
            if (cleanNum === '4') return { intent: 'SELECT_OBJ_4', value: 'obj_4' };
        } else if (currentState === 'AWAITING_CLOSING_CHOICE') {
            if (cleanNum === '1') return { intent: 'READY' };
            if (cleanNum === '2') return { intent: 'QUESTIONS' };
        } else if (currentState === 'AWAITING_COMMITMENT') {
            if (cleanNum === '1') return { intent: 'CONFIRM_YES' };
            if (cleanNum === '2') return { intent: 'CONFIRM_CHANGE' };
        } else if (currentState === 'AWAITING_FAQ_MENU') {
            if (cleanNum === '1') return { intent: 'FAQ_HOW' };
            if (cleanNum === '2') return { intent: 'FAQ_DELIVERY' };
            if (cleanNum === '3') return { intent: 'FAQ_PAYMENT' };
            if (cleanNum === '4') return { intent: 'FAQ_PACK' };
            if (cleanNum === '5') return { intent: 'FAQ_OTHER' };
        }
    }

    // 3. Text Fallback Regex Matches
    const text = body.toLowerCase();

    // Q1: Business Type
    if (/salon|shop|boutique|coiffure|starter/i.test(text)) {
        return { intent: 'SELECT_SALON', value: 'salon' };
    }
    if (/clinique|clinic|cabinet|agence|business/i.test(text)) {
        return { intent: 'SELECT_CLINIC', value: 'clinic' };
    }
    if (/large|elite|grande|entreprise|corporation/i.test(text)) {
        return { intent: 'SELECT_LARGE', value: 'large' };
    }

    // Q2: Objectives
    if (/r(é|e)pondre|vite|rapidement|seconde|temps/i.test(text)) {
        return { intent: 'SELECT_OBJ_1', value: 'obj_1' };
    }
    if (/manquer|perdre|important|rattraper|notifications/i.test(text)) {
        return { intent: 'SELECT_OBJ_2', value: 'obj_2' };
    }
    if (/automatiser|rdv|rendez-vous|commandes|agenda/i.test(text)) {
        return { intent: 'SELECT_OBJ_3', value: 'obj_3' };
    }
    if (/scaler|personnel|recruter|embaucher|volume/i.test(text)) {
        return { intent: 'SELECT_OBJ_4', value: 'obj_4' };
    }

    // Q7: Closing Choices
    if (/^(\s*)*(ready|pr(ê|e)t|commencer|lancer|payer|achat|acheter|start|go)(\s*)*$/i.test(text)) {
        return { intent: 'READY' };
    }
    if (/question|faq|savoir|demander|informations|infos|d(e|é)tails/i.test(text)) {
        return { intent: 'QUESTIONS' };
    }

    // Q8A: Commitment Lock
    if (/^(\s*)*(oui|c'est ça|cest ca|exactement|correct|yes|c'est correct|ok)(\s*)*$/i.test(text)) {
        return { intent: 'CONFIRM_YES' };
    }
    if (/changer|modifier|retour|recommencer|reset|change/i.test(text)) {
        return { intent: 'CONFIRM_CHANGE' };
    }

    // FAQ items
    if (/marche|fonctionne/i.test(text)) return { intent: 'FAQ_HOW' };
    if (/livraison|d(e|é)lai|delai|recevoir/i.test(text)) return { intent: 'FAQ_DELIVERY' };
    if (/paiement|payer|moyen/i.test(text)) return { intent: 'FAQ_PAYMENT' };
    if (/pack|choisir|offres|starter|business|elite/i.test(text)) return { intent: 'FAQ_PACK' };
    if (/autre/i.test(text)) return { intent: 'FAQ_OTHER' };

    return { intent: 'UNKNOWN' };
}

/**
 * Checks if a message is an interactive message selection (buttons/list response)
 * @param {object} m Serialized message object
 * @returns {boolean}
 */
function isInteractiveMessage(m) {
    const msg = m.message;
    return !!(
        msg?.buttonsResponseMessage ||
        msg?.templateButtonReplyMessage ||
        msg?.listResponseMessage ||
        m.msg?.selectedButtonId ||
        m.msg?.singleSelectReply?.selectedRowId
    );
}

module.exports = {
    detectIntent,
    isInteractiveMessage
};
