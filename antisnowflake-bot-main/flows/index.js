const fs = require('fs');
const path = require('path');
const intentDetector = require('./intentDetector');
const MessageSender = require('../utils/messageSender');
const { getAIResponse } = require('../lib/aiProvider');
const { getPolicyConfig } = require('../lib/policyGuard');
const bridgeState = require('../lib/bridge/state');
const settings = require('../settings');
const chalk = require('chalk');

async function safePresence(sock, presence, chatId) {
    try {
        const policy = getPolicyConfig();
        if (policy.enabled && policy.disablePresenceAutomation) return;
        await sock.sendPresenceUpdate(presence, chatId);
    } catch (_) {}
}

const SESSIONS_DIR = path.join(__dirname, '../data/flow_sessions');
let scannerInterval = null;

// Ensure flow sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * Gets absolute path of session file for a contact under a specific business
 * @param {string} senderId Raw sender JID
 * @param {string} businessNumber Business phone number
 * @returns {string} Path to JSON session
 */
function getSessionPath(senderId, businessNumber) {
    const contactNumber = senderId.split('@')[0];
    const bizFolder = path.join(SESSIONS_DIR, businessNumber);
    if (!fs.existsSync(bizFolder)) {
        fs.mkdirSync(bizFolder, { recursive: true });
    }
    return path.join(bizFolder, `${contactNumber}.json`);
}

/**
 * Loads session for a customer under a specific business
 * @param {string} senderId JID of the sender
 * @param {string} businessNumber Business phone number
 * @returns {object} Session object
 */
function loadSession(senderId, businessNumber) {
    const sessionPath = getSessionPath(senderId, businessNumber);
    if (fs.existsSync(sessionPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
            return {
                state: 'NEW',
                businessType: null,
                objective: null,
                name: null,
                lastPackShown: null,
                tallySentAt: null,
                tallySubmitted: false,
                tallyReminderSent: false,
                ...data
            };
        } catch (e) {
            console.error(`[Flow Session] Error loading session for ${senderId} under business ${businessNumber}:`, e.message);
        }
    }
    return {
        state: 'NEW',
        businessType: null,
        objective: null,
        name: null,
        lastPackShown: null,
        tallySentAt: null,
        tallySubmitted: false,
        tallyReminderSent: false
    };
}

/**
 * Saves session for a customer under a specific business
 * @param {string} senderId JID of the sender
 * @param {string} businessNumber Business phone number
 * @param {object} session Session object to save
 */
function saveSession(senderId, businessNumber, session) {
    const sessionPath = getSessionPath(senderId, businessNumber);
    try {
        fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
    } catch (e) {
        console.error(`[Flow Session] Error saving session for ${senderId} under business ${businessNumber}:`, e.message);
    }
}

/**
 * Loads custom configuration for a business
 * @param {string} businessNumber Business phone number
 * @returns {object|null} Config object or null
 */
function loadBusinessConfig(businessNumber) {
    const configPath = path.join(__dirname, `../data/config/${businessNumber}.json`);
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
            console.error(`[Business Config] Error loading config for ${businessNumber}:`, e.message);
        }
    }
    return null;
}

/**
 * Primary flow routing function
 * @param {object} sock Baileys socket instance
 * @param {string} chatId Chat JID
 * @param {string} senderId Sender JID
 * @param {object} m Serialized message object
 */
async function handleFlow(sock, chatId, senderId, m) {
    const body = (m.body || m.text || "").trim();
    const businessNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '');

    const sender = new MessageSender(sock);
    let session = loadSession(senderId, businessNumber);

    // Run intent detector with current session state
    const detected = intentDetector.detectIntent(m, session.state);
    const intent = detected.intent;
    const intentVal = detected.value;

    console.log(chalk.cyan(`[Flow Router] [Biz: ${businessNumber}] State: ${session.state} | Intent: ${intent} | From: ${senderId}`));

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    switch (session.state) {
        case 'NEW': {
            // Step 1: Welcome message
            const welcomeText = `MboWazap par Giantect. L'infrastructure d'automatisation WhatsApp pour les PME camerounaises.

• Anti-vu unique : Éliminez la pression de répondre immédiatement.
• Anti-suppression : Conservez l'historique complet des messages.
• Campaign Max : Diffusez vos offres sans friction ni risque de blocage.
• Chatbot intelligent 24h/24 & 7j/7 pour vos produits et services.

Optimisez vos ventes dès aujourd'hui.`;
            await sender.sendText(chatId, welcomeText, m);
            await sleep(1500);

            // Step 2: Q1 Business Type
            const q1Text = `Quel est votre type de business ?`;
            const q1Buttons = [
                { id: 'btn_salon', text: '🏪 Salon / Shop' },
                { id: 'btn_clinic', text: '🏥 Clinique / Agence' },
                { id: 'btn_large', text: '🏢 Large Business' }
            ];
            await sender.sendButtons(chatId, q1Text, q1Buttons, "MboWazap Q1", m);

            session.state = 'AWAITING_Q1';
            saveSession(senderId, businessNumber, session);
            break;
        }

        case 'AWAITING_Q1': {
            if (intent === 'SELECT_SALON' || intent === 'SELECT_CLINIC' || intent === 'SELECT_LARGE') {
                session.businessType = intentVal;
                
                if (intentVal === 'salon') {
                    session.lastPackShown = 'STARTER';
                } else if (intentVal === 'clinic') {
                    session.lastPackShown = 'BUSINESS';
                } else {
                    session.lastPackShown = 'ELITE';
                }

                // Step 3: Q2 Objective List Message
                const q2Text = `Quel est votre objectif grâce à cette automation ?`;
                const sections = [
                    {
                        title: "Objectifs MboWazap",
                        rows: [
                            { title: "Répondre plus vite", rowId: "row_obj_1", description: "Répondre plus vite à mes clients" },
                            { title: "Ne plus manquer", rowId: "row_obj_2", description: "Ne plus manquer de messages importants" },
                            { title: "Automatiser rdv/cmd", rowId: "row_obj_3", description: "Automatiser mes rendez-vous et commandes" },
                            { title: "Scaler sans recruter", rowId: "row_obj_4", description: "Scaler sans recruter plus de personnel" }
                        ]
                    }
                ];
                await sender.sendList(chatId, q2Text, "Objectifs", "Sélectionner un objectif", sections, "MboWazap Q2", m);

                session.state = 'AWAITING_Q2';
                saveSession(senderId, businessNumber, session);
            } else {
                await runDavilaFallback(sock, chatId, senderId, m, session);
            }
            break;
        }

        case 'AWAITING_Q2': {
            if (intent === 'SELECT_OBJ_1' || intent === 'SELECT_OBJ_2' || intent === 'SELECT_OBJ_3' || intent === 'SELECT_OBJ_4') {
                session.objective = intentVal;

                // Step 4: Personalized Bridge
                const bridges = {
                    obj_1: {
                        objectif: "répondre plus vite à vos clients",
                        solution: "déployant un chatbot intelligent qui répond en moins de 10 secondes"
                    },
                    obj_2: {
                        objectif: "ne plus manquer de messages importants",
                        solution: "configurant des alertes prioritaires et un tri automatique des opportunités"
                    },
                    obj_3: {
                        objectif: "automatiser vos rendez-vous et commandes",
                        solution: "connectant votre WhatsApp directement à votre agenda et formulaire de commande"
                    },
                    obj_4: {
                        objectif: "scaler sans recruter plus de personnel",
                        solution: "mettant en place des tunnels de vente automatisés qui gèrent le volume pour vous"
                    }
                };

                const chosen = bridges[intentVal];
                const bridgeText = `On peut vous aider à ${chosen.objectif} en ${chosen.solution}.`;
                await sender.sendText(chatId, bridgeText, m);
                await sleep(1500);

                // Step 5: Tally Link
                const tallyLink = settings.tallyFormLink || 'https://tally.so/r/J9eWDX';
                const tallyText = `Veuillez remplir ce formulaire — 2 min chrono 👇\n${tallyLink}\n\nVous rejoignez +12 businesses à Yaoundé qui utilisent déjà MboWazap pour automatiser leur croissance.`;
                await sender.sendText(chatId, tallyText, m);

                session.tallySentAt = Date.now();
                session.tallyReminderSent = false;
                session.state = 'TALLY_SENT';
                saveSession(senderId, businessNumber, session);
            } else {
                await runDavilaFallback(sock, chatId, senderId, m, session);
            }
            break;
        }

        case 'TALLY_SENT': {
            const nameText = `Puis-je avoir votre nom ?`;
            await sender.sendText(chatId, nameText, m);

            session.state = 'AWAITING_NAME';
            saveSession(senderId, businessNumber, session);
            break;
        }

        case 'AWAITING_NAME': {
            if (body && !intentDetector.isInteractiveMessage(m)) {
                session.name = body;

                // Step 7: Closing message
                const closingText = `Merci ${session.name} d'avoir contacté Giantect. Avez-vous besoin de plus d'informations avant de passer au paiement ? Annulable à tout moment.`;
                const closingButtons = [
                    { id: 'btn_ready', text: '✅ Je suis prêt' },
                    { id: 'btn_questions', text: '❓ J\'ai encore des questions' }
                ];
                await sender.sendButtons(chatId, closingText, closingButtons, "MboWazap Fin", m);

                session.state = 'AWAITING_CLOSING';
                saveSession(senderId, businessNumber, session);
            } else {
                await sender.sendText(chatId, "Puis-je avoir votre nom s'il vous plaît ?", m);
            }
            break;
        }

        case 'AWAITING_CLOSING': {
            if (intent === 'READY') {
                await sendCommitmentLock(sender, chatId, session, m);
                session.state = 'COMMITMENT';
                saveSession(senderId, businessNumber, session);
            } else if (intent === 'QUESTIONS') {
                await sendFAQList(sender, chatId, m);
                session.state = 'FAQ';
                saveSession(senderId, businessNumber, session);
            } else {
                await runDavilaFallback(sock, chatId, senderId, m, session);
            }
            break;
        }

        case 'COMMITMENT': {
            if (intent === 'CONFIRM_YES') {
                // Step 8B: Risk Reversal & Close
                const paymentLink = settings.paymentLink || 'https://cinetpay.com/pay-placeholder';
                const closeText = `Si après 7 jours vous n'êtes pas satisfait, on rembourse sans question. Aucun risque.\n\nVeuillez procéder au paiement via ce lien sécurisé (CinetPay / Orange Money) : ${paymentLink}`;
                await sender.sendText(chatId, closeText, m);
                
                session.state = 'CLOSED';
                saveSession(senderId, businessNumber, session);
            } else if (intent === 'CONFIRM_CHANGE') {
                // Restart flow
                session = {
                    state: 'NEW',
                    businessType: null,
                    objective: null,
                    name: null,
                    lastPackShown: null,
                    tallySentAt: null,
                    tallySubmitted: false,
                    tallyReminderSent: false
                };
                saveSession(senderId, businessNumber, session);
                await handleFlow(sock, chatId, senderId, m);
            } else {
                await runDavilaFallback(sock, chatId, senderId, m, session);
            }
            break;
        }

        case 'FAQ': {
            if (intent === 'FAQ_HOW' || intent === 'FAQ_DELIVERY' || intent === 'FAQ_PAYMENT' || intent === 'FAQ_PACK') {
                const answers = {
                    FAQ_HOW: "Notre système se connecte à votre numéro WhatsApp existant. Vos clients reçoivent des réponses automatiques basées sur vos produits et services, 24h/24 et 7j/7.",
                    FAQ_DELIVERY: "L'installation et la configuration de votre bot prennent entre 24 et 48 heures ouvrables après la soumission de votre formulaire.",
                    FAQ_PAYMENT: "Nous acceptons Mobile Money (Orange Money, MTN Mobile Money) via notre partenaire CinetPay, ainsi que les virements bancaires.",
                    FAQ_PACK: "Le pack STARTER (25k) est idéal pour les boutiques et salons individuels. Le pack BUSINESS (75k) convient aux cliniques et agences qui ont besoin d'intégrations (formulaires, agendas). Le pack ELITE (350k) est conçu pour les grandes entreprises nécessitant du sur-mesure."
                };
                
                await sender.sendText(chatId, answers[intent], m);
                await sleep(1500);

                const followText = `Avez-vous d'autres questions ou êtes-vous prêt à commencer ?`;
                const followBtns = [
                    { id: 'btn_ready_start', text: '🚀 Je suis prêt à commencer' },
                    { id: 'btn_faq_other', text: '❓ Autre question' }
                ];
                await sender.sendButtons(chatId, followText, followBtns, "FAQ Option", m);
            } else if (intent === 'READY' || intent === 'READY_START') {
                await sendCommitmentLock(sender, chatId, session, m);
                session.state = 'COMMITMENT';
                saveSession(senderId, businessNumber, session);
            } else if (intent === 'FAQ_OTHER' || intent === 'QUESTIONS') {
                await sendFAQList(sender, chatId, m);
            } else {
                await runDavilaFallback(sock, chatId, senderId, m, session);
            }
            break;
        }

        case 'CLOSED': {
            await runDavilaFallback(sock, chatId, senderId, m, session);
            break;
        }

        default: {
            session.state = 'NEW';
            saveSession(senderId, businessNumber, session);
            await handleFlow(sock, chatId, senderId, m);
            break;
        }
    }
}

/**
 * Formats and sends commitment confirmation message
 */
async function sendCommitmentLock(sender, chatId, session, m) {
    const packs = {
        STARTER: { name: 'STARTER', price: '25 000' },
        BUSINESS: { name: 'BUSINESS', price: '75 000' },
        ELITE: { name: 'ELITE', price: '350 000' }
    };
    const packInfo = packs[session.lastPackShown || 'STARTER'];
    const text = `Vous avez choisi le pack ${packInfo.name} à ${packInfo.price} FCFA/mois. C'est bien ça ?`;
    const buttons = [
        { id: 'btn_confirm_yes', text: '✅ Oui, c\'est ça' },
        { id: 'btn_confirm_change', text: '🔄 Je veux changer' }
    ];
    await sender.sendButtons(chatId, text, buttons, "MboWazap Engagement", m);
}

/**
 * Sends FAQ questions list message
 */
async function sendFAQList(sender, chatId, m) {
    const text = `Sélectionnez une question dans la liste ci-dessous pour obtenir une réponse immédiate.`;
    const sections = [
        {
            title: "FAQ MboWazap",
            rows: [
                { title: "Comment ça marche ?", rowId: "row_faq_how", description: "Fonctionnement de l'automatisation WhatsApp." },
                { title: "Délai de livraison ?", rowId: "row_faq_delivery", description: "Quand votre bot sera-t-il actif ?" },
                { title: "Moyens de paiement ?", rowId: "row_faq_payment", description: "Comment payer votre abonnement." },
                { title: "Quel pack choisir ?", rowId: "row_faq_pack", description: "Trouvez l'offre adaptée à votre taille." }
            ]
        }
    ];
    await sender.sendList(chatId, text, "FAQ - Questions Fréquentes", "Voir les questions", sections, "MboWazap FAQ", m);
}

/**
 * Webhook handler to automatically process Tally form submissions
 * @param {object} sock Baileys socket instance
 * @param {string} jid Client WhatsApp JID
 */
async function handleTallyWebhook(sock, jid) {
    const businessNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '');
    const session = loadSession(jid, businessNumber);
    session.tallySubmitted = true;
    
    if (session.state === 'TALLY_SENT') {
        session.state = 'AWAITING_NAME';
        saveSession(jid, businessNumber, session);
        
        const sender = new MessageSender(sock);
        const text = `Merci d'avoir rempli le formulaire ! Puis-je avoir votre nom ?`;
        await sender.sendText(jid, text);
        console.log(`[Tally Webhook] [Biz: ${businessNumber}] Successfully updated session state to AWAITING_NAME and prompted ${jid}`);
    } else {
        saveSession(jid, businessNumber, session);
        console.log(`[Tally Webhook] [Biz: ${businessNumber}] Marked tallySubmitted=true for ${jid} in state ${session.state}`);
    }
    return true;
}

/**
 * Fallback handler using Davila AI (via Groq)
 */
async function runDavilaFallback(sock, chatId, senderId, m, session) {
    const userMessage = m.body || m.text || "";
    const sender = new MessageSender(sock);
    const businessNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '');

    // Load custom configuration if present
    const customConfig = loadBusinessConfig(businessNumber);
    
    let systemPrompt;
    if (customConfig && customConfig.systemPrompt) {
        systemPrompt = customConfig.systemPrompt;
        
        // Append context details to the custom prompt
        systemPrompt += `\n\nContexte actuel du prospect :
- Nom : ${session.name || 'Inconnu'}
- Type de business : ${session.businessType || 'Non spécifié'}
- Objectif sélectionné : ${session.objective || 'Non spécifié'}
- Statut de la conversation : ${session.state}
- Formulaire Tally soumis : ${session.tallySubmitted ? 'Oui' : 'Non'}

Votre but est de répondre très brièvement en français ou anglais selon la langue du message à sa réponse libre tout en le guidant à finaliser l'étape en cours (${session.state}).`;
    } else {
        // Fallback to default Davila system prompt
        systemPrompt = `Vous êtes Davila AI, l'intelligence de vente de MboWazap (créé par Giantect). 
Vous parlez à un prospect sur WhatsApp de manière froide, directe, professionnelle et sans fioritures (pas d'adjectifs inutiles).
N'utilisez JAMAIS les mots bannis : "Revolutionary", "Game-changer", "Unlock", "Empower", "Passion", "Success".

Contexte du prospect actuel :
- Nom : ${session.name || 'Inconnu'}
- Type de business : ${session.businessType || 'Non spécifié'}
- Objectif sélectionné : ${session.objective || 'Non spécifié'}
- Statut de la conversation : ${session.state}
- Formulaire Tally soumis : ${session.tallySubmitted ? 'Oui' : 'Non'}

Votre but est de répondre très brièvement en français à son message libre tout en le guidant discrètement à finaliser l'étape en cours (${session.state}).
Consignes selon l'étape actuelle :
- Si AWAITING_Q1 : Dites-lui de choisir son type de business parmi les boutons envoyés.
- Si AWAITING_Q2 : Dites-lui de sélectionner un objectif dans la liste.
- Si TALLY_SENT ou AWAITING_NAME : Invitez-le à donner son nom.
- Si AWAITING_CLOSING : Demandez-lui s'il est prêt ou s'il a des questions.
- Si COMMITMENT : Confirmez s'il valide son choix de pack.
- Si FAQ : Donnez la réponse à sa question ou invitez-le à choisir dans la liste FAQ.
- Si CLOSED : Remerciez-le pour sa confiance et invitez-le à effectuer son paiement.`;
    }

    // Append custom knowledge base if present
    if (customConfig && customConfig.knowledgeBase) {
        systemPrompt += `\n\nInformations sur mon entreprise (Knowledge Base / Service Catalog / FAQs) :\n${customConfig.knowledgeBase}`;
    }

    try {
        await safePresence(sock, 'composing', chatId);
        
        // Simulating human thinking/typing delay (5 to 8 seconds)
        const delayMs = Math.floor(Math.random() * (8000 - 5000 + 1)) + 5000;
        await new Promise(r => setTimeout(r, delayMs));

        const aiResponse = await getAIResponse(userMessage, systemPrompt);
        
        await safePresence(sock, 'available', chatId);
        
        await sender.sendText(chatId, aiResponse, m);
    } catch (e) {
        console.error('[DavilaFallback] Error:', e.message);
        await sender.sendText(chatId, "Désolé, j'ai rencontré un problème réseau. Pouvez-vous réessayer dans un instant ?", m);
    }
}

/**
 * Initializes background scanner for Tally reminders (persistent)
 * Runs once at startup. Checks session files every 1 minute.
 * @param {object} sock Baileys socket instance (optional fallback)
 */
function initFlowScanner(sock) {
    if (scannerInterval) {
        clearInterval(scannerInterval);
        console.log(chalk.green('[Flow Scanner] Reset existing scanner interval.'));
    }
    console.log(chalk.green('[Flow Scanner] Initializing persistent Tally reminder scanner...'));
    scannerInterval = setInterval(async () => {
        try {
            const sessionManager = require('../lib/sessionManager');
            if (!fs.existsSync(SESSIONS_DIR)) return;
            const businesses = fs.readdirSync(SESSIONS_DIR);
            const now = Date.now();
            
            for (const biz of businesses) {
                // Ignore temp or non-directory files
                if (biz.startsWith('temp_')) continue;
                const bizFolder = path.join(SESSIONS_DIR, biz);
                if (!fs.existsSync(bizFolder) || !fs.statSync(bizFolder).isDirectory()) continue;
                
                const clientFiles = fs.readdirSync(bizFolder);
                const bizSock = sessionManager.getSocket(biz);
                if (!bizSock) continue; // Skip if socket is not currently connected
                // wacrm bridge: no Davila follow-ups when wacrm is the brain for this number
                if (!bridgeState.isDavilaEnabled(biz)) continue;

                const sender = new MessageSender(bizSock);
                
                for (const file of clientFiles) {
                    if (!file.endsWith('.json')) continue;
                    const contactNumber = file.slice(0, -5);
                    const senderId = `${contactNumber}@s.whatsapp.net`;
                    // A human took over this contact from the wacrm inbox
                    if (bridgeState.isContactPaused(contactNumber)) continue;

                    const session = loadSession(senderId, biz);
                    if (session.state === 'TALLY_SENT' && !session.tallySubmitted && session.tallySentAt && !session.tallyReminderSent) {
                        const elapsed = now - session.tallySentAt;
                        // Check if 10 minutes have elapsed (10 * 60 * 1000)
                        if (elapsed >= 10 * 60 * 1000) {
                            const tallyLink = settings.tallyFormLink || 'https://tally.so/r/J9eWDX';
                            const reminderText = `Rappel : N'oubliez pas de remplir le formulaire pour finaliser la configuration de votre bot MboWazap. Cela prend 2 min chrono 👇\n${tallyLink}`;
                            
                            await sender.sendText(senderId, reminderText);
                            
                            session.tallyReminderSent = true;
                            saveSession(senderId, biz, session);
                            console.log(chalk.yellow(`[Flow Scanner] Sent persistent Tally reminder to ${senderId} under business ${biz}`));
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[Flow Scanner] Error scanning session directories:', err.message);
        }
    }, 60000); // scan every minute
}

module.exports = {
    handleFlow,
    handleTallyWebhook,
    initFlowScanner,
    loadSession,
    saveSession,
    loadBusinessConfig
};
