const settings = require('../settings');
const { getAIResponse } = require('./aiProvider');
const { getPolicyConfig } = require('./policyGuard');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const FormData = require('form-data');
const axios = require('axios');
const bridgeState = require('./bridge/state');
const { getReporter, extractChatRef } = require('./bridge/reporter');

/**
 * wacrm bridge gate: Davila stays silent when wacrm switched her off for
 * this paired number (wacrm is the brain) or paused her for this contact
 * (a human took over from the wacrm inbox).
 */
function isDavilaAllowed(sock, senderId) {
    if (!bridgeState.isDavilaEnabledForSocket(sock)) return false;
    return !bridgeState.isContactPaused(bridgeState.contactKeyFromJid(senderId));
}

async function safePresence(sock, presence, chatId) {
    try {
        const policy = getPolicyConfig();
        if (policy.enabled && policy.disablePresenceAutomation) return;
        await sock.sendPresenceUpdate(presence, chatId);
    } catch (_) {}
}

/**
 * Recursively extracts the actual inner message content from standard Baileys wrappers
 */
function getInnerMessage(messageContent) {
    if (!messageContent) return null;
    if (messageContent.ephemeralMessage?.message) {
        return getInnerMessage(messageContent.ephemeralMessage.message);
    }
    if (messageContent.viewOnceMessage?.message) {
        return getInnerMessage(messageContent.viewOnceMessage.message);
    }
    if (messageContent.viewOnceMessageV2?.message) {
        return getInnerMessage(messageContent.viewOnceMessageV2.message);
    }
    if (messageContent.documentWithCaptionMessage?.message) {
        return getInnerMessage(messageContent.documentWithCaptionMessage.message);
    }
    return messageContent;
}

/**
 * Downloads a media message from Baileys as an in-memory Buffer
 */
async function downloadMedia(message, type) {
    const msgContent = getInnerMessage(message.message);
    const msg = msgContent?.[`${type}Message`];
    if (!msg) return null;
    const stream = await downloadContentFromMessage(msg, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

/**
 * Transcribes audio (voice notes) using Groq Whisper API
 */
async function transcribeAudio(audioBuffer, groqApiKey) {
    const form = new FormData();
    form.append('file', audioBuffer, {
        filename: 'speech.ogg',
        contentType: 'audio/ogg'
    });
    form.append('model', 'whisper-large-v3');

    try {
        console.log(chalk.cyan('[Audio] Sending voice note to Groq Whisper...'));
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${groqApiKey}`
            },
            timeout: 20000
        });
        const text = response.data?.text || '';
        console.log(chalk.green(`[Audio] Groq Whisper transcription success: "${text.substring(0, 60)}..."`));
        return text;
    } catch (err) {
        console.error('[Audio] Groq Whisper transcription failed:', err.message);
        throw err;
    }
}

/**
 * Describes or reads image content using Groq Vision or Gemini Vision
 */
async function readImageContent(imageBuffer, mimeType = 'image/jpeg') {
    const base64Data = imageBuffer.toString('base64');
    const promptText = "Analyze this image in detail. Describe what you see: products, storefronts, flyers, advertisements, or posters. If the image contains any text, menus, price lists, or contact info, read and transcribe all of it exactly. If this is a PAYMENT RECEIPT or screenshot of an Orange Money / Mobile Money transaction, explicitly start your response with '[SYSTEM: USER UPLOADED A PAYMENT RECEIPT]' and then transcribe the amount and reference number. Provide a complete summary of how this connects to their business.";

    // Try Groq Vision first
    if (settings.groqApiKey) {
        try {
            console.log(chalk.cyan('[Vision] Requesting description from Groq Vision...'));
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${settings.groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.2-11b-vision-preview',
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: promptText },
                                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
                            ]
                        }
                    ],
                    max_tokens: 500
                }),
                signal: AbortSignal.timeout(30000)
            });
            const data = await response.json();
            if (response.status === 200 && data.choices?.[0]?.message?.content) {
                const desc = data.choices[0].message.content.trim();
                console.log(chalk.green('[Vision] Groq Vision transcription success!'));
                return desc;
            }
            throw new Error(`Groq Vision returned HTTP ${response.status}`);
        } catch (groqErr) {
            console.warn('[Vision] Groq Vision failed, falling back to Gemini:', groqErr.message);
        }
    }

    // Fallback: Try Gemini Vision
    if (settings.geminiApiKey) {
        try {
            console.log(chalk.cyan('[Vision] Requesting description from Gemini Vision...'));
            const requestBody = {
                contents: [{
                    parts: [
                        { text: promptText },
                        {
                            inlineData: {
                                mimeType,
                                data: base64Data
                            }
                        }
                    ]
                }],
                generationConfig: {
                    maxOutputTokens: 500
                }
            };
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${settings.geminiApiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                    signal: AbortSignal.timeout(30000)
                }
            );
            const data = await response.json();
            if (response.status === 200 && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                const desc = data.candidates[0].content.parts[0].text.trim();
                console.log(chalk.green('[Vision] Gemini Vision transcription success!'));
                return desc;
            }
            throw new Error(`Gemini Vision returned HTTP ${response.status}`);
        } catch (geminiErr) {
            console.error('[Vision] Gemini Vision failed as well:', geminiErr.message);
        }
    }

    throw new Error('All vision providers failed');
}

/**
 * Verifies if a specific phone number has submitted the Tally form
 */
async function verifyTallySubmission(phoneNumber) {
    try {
        const response = await fetch('https://api.tally.so/forms/J9eWDX/submissions', {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer tly-0pWkRKIoRqG7PKSiOEKB8cMosYx5uRZl',
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(15000)
        });
        
        if (response.status !== 200) {
            console.error('[Tally] Failed to fetch submissions, status:', response.status);
            return false;
        }

        const data = await response.json();
        const submissions = data.submissions || [];
        
        // Extract digits only for robust matching
        const cleanTargetNum = phoneNumber.replace(/[^0-9]/g, '');
        
        for (const sub of submissions) {
            const answers = sub.answers || [];
            for (const ans of answers) {
                if (ans.type === 'INPUT_PHONE_NUMBER' && ans.value) {
                    const cleanSubNum = String(ans.value).replace(/[^0-9]/g, '');
                    // Check for overlap (to handle country codes gracefully)
                    if (cleanSubNum && (cleanSubNum.includes(cleanTargetNum) || cleanTargetNum.includes(cleanSubNum))) {
                        return true;
                    }
                }
            }
        }
        return false;
    } catch (err) {
        console.error('[Tally] Error verifying submission:', err.message);
        return false;
    }
}

// Helper to load persistent memory for a specific contact from disk
async function loadContactMemory(senderId) {
    let memory = {
        jid: senderId,
        name: "",
        businessType: "",
        location: "",
        interestedPack: "",
        tallyLinkSent: false,
        formFilled: false,
        catalogImagesSent: false,
        longTermProfile: "",
        aiPausedUntil: null,
        lastSeen: Date.now(),
        history: []
    };

    const contactNumber = senderId.split('@')[0];
    const MEMORY_DIR = path.join(__dirname, '../data/memory');
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    const contactMemoryPath = path.join(MEMORY_DIR, `${contactNumber}.json`);
    
    try {
        if (fs.existsSync(contactMemoryPath)) {
            const fileData = JSON.parse(fs.readFileSync(contactMemoryPath, 'utf8'));
            memory = { ...memory, ...fileData };
        }
    } catch (err) {
        console.error(`[Memory] Failed to load memory for ${senderId}:`, err.message);
    }
    return memory;
}

// Helper to save persistent memory for a specific contact to disk
async function saveContactMemory(senderId, memory) {
    memory.lastSeen = Date.now();
    // strictly enforce last 20 messages limit
    if (memory.history.length > 20) {
        memory.history = memory.history.slice(-20);
    }

    const contactNumber = senderId.split('@')[0];
    const MEMORY_DIR = path.join(__dirname, '../data/memory');
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    const contactMemoryPath = path.join(MEMORY_DIR, `${contactNumber}.json`);

    try {
        fs.writeFileSync(contactMemoryPath, JSON.stringify(memory, null, 2), 'utf8');
    } catch (err) {
        console.error(`[Memory] Failed to save memory for ${senderId}:`, err.message);
    }
}

/**
 * Background, non-blocking asynchronous deal classifier
 */
async function checkIfDealClosed(history, userMessage, aiResponse) {
    try {
        const fullChat = [...history, `user: ${userMessage}`, `assistant: ${aiResponse}`].slice(-6).join('\n');
        const classificationPrompt = `Analyze the following conversation context. Determine if this user is a 'HOT LEAD'. A Hot Lead is someone who has explicitly asked how to pay, confirmed they are ready to order, or requested the payment number/link to proceed with a purchase.

Conversation history:
${fullChat}

Is this user a Hot Lead ready to pay? Respond with exactly one word: 'YES' or 'NO'.`;

        const response = await getAIResponse(classificationPrompt, "You are a precise sales operations system that classifies conversation deals.");
        return response?.trim().toUpperCase().includes('YES');
    } catch (e) {
        console.error('[DealClassifier] Failed to classify deal:', e.message);
        return false;
    }
}

/**
 * Background, non-blocking customer fact extractor
 */
async function extractContactFacts(history, lastUserMsg, lastAiResponse, currentMemory) {
    try {
        const fullChat = [...history.slice(-4), { role: 'user', content: lastUserMsg }, { role: 'assistant', content: lastAiResponse }]
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');
            
        const extractionPrompt = `Analyze the following conversation context. Extract and update the contact facts:
- Name (a person's name)
- Business Type (what kind of business they run, e.g. shop, salon, agency)
- Location (city or area they are located, e.g. Yaoundé, Douala)
- Interested Pack (starter, business, elite - ONLY if they explicitly show interest or ask about a specific pack)
- longTermProfile (A dense 1-paragraph summary of their exact needs, budget, emotional state, and any past details they mentioned. This acts as their permanent CRM memory.)

Current known facts (do not overwrite with "unknown" if already known):
- Name: ${currentMemory.name || 'unknown'}
- Business: ${currentMemory.businessType || 'unknown'}
- Location: ${currentMemory.location || 'unknown'}
- Interested in: ${currentMemory.interestedPack || 'unknown'}
- Profile: ${currentMemory.longTermProfile || 'unknown'}

Conversation Context:
${fullChat}

Respond ONLY with a JSON object in this exact format (no markdown formatting, no code blocks):
{
  "name": "extracted name or current known fact",
  "businessType": "extracted business type or current known fact",
  "location": "extracted location or current known fact",
  "interestedPack": "starter/business/elite or current known fact",
  "longTermProfile": "updated dense summary of who they are and what they need"
}`;

        const response = await getAIResponse(extractionPrompt, "You are a precise sales assistant that extracts customer profile facts from conversation history and returns clean JSON.");
        const cleanJson = response?.replace(/```json/g, '').replace(/```/g, '').trim();
        const extracted = JSON.parse(cleanJson);
        
        let updated = false;
        if (extracted.name && extracted.name !== 'unknown' && extracted.name !== currentMemory.name) {
            currentMemory.name = extracted.name;
            updated = true;
        }
        if (extracted.businessType && extracted.businessType !== 'unknown' && extracted.businessType !== currentMemory.businessType) {
            currentMemory.businessType = extracted.businessType;
            updated = true;
        }
        if (extracted.location && extracted.location !== 'unknown' && extracted.location !== currentMemory.location) {
            currentMemory.location = extracted.location;
            updated = true;
        }
        const packLower = extracted.interestedPack?.toLowerCase();
        if (packLower && ['starter', 'business', 'elite'].includes(packLower) && packLower !== currentMemory.interestedPack) {
            currentMemory.interestedPack = packLower;
            updated = true;
        }
        if (extracted.longTermProfile && extracted.longTermProfile !== 'unknown' && extracted.longTermProfile !== currentMemory.longTermProfile) {
            currentMemory.longTermProfile = extracted.longTermProfile;
            updated = true;
        }
        
        return { updated, memory: currentMemory };
    } catch (e) {
        console.error('[FactExtractor] Extraction failed:', e.message);
        return { updated: false, memory: currentMemory };
    }
}

/**
 * Generate a random delay between 15 seconds and 2 minutes (in ms)
 */
function getHumanDelay() {
    return Math.floor(Math.random() * (120000 - 15000 + 1)) + 15000;
}

async function handleAutoReply(sock, chatId, senderId, message, settingsParam) {
    const activeSettings = settingsParam || settings;
    if (!activeSettings.autoReply) return;
    if (!isDavilaAllowed(sock, senderId)) return;

    // Quiet hours check: no auto-replies 11PM-6AM
    const nowHour = new Date().getHours();
    if (nowHour >= 23 || nowHour < 6) return;

    // Daily auto-reply cap per sender
    global._dailyReplies = global._dailyReplies || new Map();
    const dailyKey = `${senderId}:${new Date().toDateString()}`;
    const dailyCount = (global._dailyReplies.get(dailyKey) || 0) + 1;
    global._dailyReplies.set(dailyKey, dailyCount);
    if (dailyCount > 20) {
        console.log(`[Daily AutoReply Cap] ${senderId.split('@')[0]} hit 20/day, silent.`);
        return;
    }

    // Detect media types using recursive unwrapper
    const msgContent = getInnerMessage(message.message);
    const hasAudio = !!msgContent?.audioMessage;
    const hasImage = !!msgContent?.imageMessage;

    let userMessage = (
        msgContent?.conversation?.trim() ||
        msgContent?.extendedTextMessage?.text?.trim() ||
        msgContent?.imageMessage?.caption?.trim() ||
        msgContent?.videoMessage?.caption?.trim() ||
        ''
    );

    // Skip empty messages (unless there is media to process) or bot commands
    if ((!userMessage && !hasAudio && !hasImage) || (userMessage && userMessage.startsWith('.'))) return;

    const senderName = message.pushName || 'Unknown';

    // 1. Security Check (Hourly Limit, Unanswered silence, STOP/Opt-Out, Human Handover, Warmup Ramp)
    const securityManager = require('./securityManager');
    const secResult = await securityManager.processSecurityCheck(sock, senderId, senderName, activeSettings, userMessage);
    if (!secResult.allowed) {
        console.log(`[AutoReply] 🛡️ Security block active for ${senderId}: ${secResult.reason}`);
        if (secResult.pauseAi) {
            const memory = await loadContactMemory(senderId);
            memory.aiPausedUntil = Date.now() + 3600000; // Pause AI for 1 hour
            await saveContactMemory(senderId, memory);
        }
        return;
    }

    // Load persistent memory for this sender asynchronously
    const memory = await loadContactMemory(senderId);

    // AI Pausing Check (Owner Handover)
    if (memory.aiPausedUntil && Date.now() < memory.aiPausedUntil) {
        const minutesLeft = Math.ceil((memory.aiPausedUntil - Date.now()) / 60000);
        console.log(`[AutoReply] ⏸️ AI is paused for ${senderId.split('@')[0]} for ${minutesLeft} more minutes (Owner Handover). Skipping.`);
        return;
    }

    // Tally Form Verification
    if (memory.tallyLinkSent && !memory.formFilled) {
        const isFilled = await verifyTallySubmission(senderId.split('@')[0]);
        if (isFilled) {
            console.log(chalk.green(`[Tally] ✅ Form submission verified for ${senderId.split('@')[0]}`));
            memory.formFilled = true;
            await saveContactMemory(senderId, memory);
        }
    }

    const contactKey = bridgeState.contactKeyFromJid(senderId);
    const runHandle = {
        cancelled: false,
        stopPresence: () => safePresence(sock, 'paused', chatId),
    };
    bridgeState.registerActiveDavilaRun(contactKey, runHandle);

    try {
        if (runHandle.cancelled || !isDavilaAllowed(sock, senderId)) return;

        // Process Voice Notes
        if (hasAudio) {
            try {
                const audioBuffer = await downloadMedia(message, 'audio');
                if (audioBuffer) {
                    const transcription = await transcribeAudio(audioBuffer, activeSettings.groqApiKey);
                    if (transcription) {
                        userMessage = transcription;
                    } else {
                        throw new Error('Transcription returned empty text');
                    }
                } else {
                    throw new Error('Could not download audio message');
                }
            } catch (audioErr) {
                console.error('[AutoReply] Failed to transcribe voice note:', audioErr.message);
                await safePresence(sock, 'available', chatId);
                await sock.sendMessage(chatId, {
                    text: "Désolée, je n'ai pas pu bien entendre votre message vocal 😅 Pouvez-vous s'il vous plaît me l'écrire en texte ou le renvoyer ?"
                }, { quoted: message });
                return;
            }
        } 
        // Process Image Messages
        else if (hasImage) {
            try {
                const imageBuffer = await downloadMedia(message, 'image');
                if (imageBuffer) {
                    const imageDesc = await readImageContent(imageBuffer);
                    if (imageDesc) {
                        const caption = message.message?.imageMessage?.caption?.trim() || '';
                        userMessage = `[Sent image: ${imageDesc}]${caption ? ` - Caption: ${caption}` : ''}`;
                    } else {
                        throw new Error('Vision returned empty description');
                    }
                } else {
                    throw new Error('Could not download image message');
                }
            } catch (imageErr) {
                console.error('[AutoReply] Failed to read image:', imageErr.message);
                await safePresence(sock, 'available', chatId);
                await sock.sendMessage(chatId, {
                    text: "Désolée, je n'ai pas pu charger votre image correctement 😅 Pouvez-vous s'il vous plaît me décrire ce qu'elle contient ?"
                }, { quoted: message });
                return;
            }
        }

        const userMsgLower = userMessage.toLowerCase();

        // Trigger phrases for Tally Form Detection
        const tallyTriggers = [
            "i want", "je veux", "order", "commande", "get started",
            "how to start", "comment commencer", "je prends",
            "i'll take", "sign me up", "inscris moi"
        ];
        const isTallyRequested = tallyTriggers.some(phrase => userMsgLower.includes(phrase));

        // Trigger phrases for Catalog Image Request Detection
        const catalogTriggers = [
            "show me", "montrez moi", "send image", "envoie une image",
            "got a picture", "vous avez une image", "can I see",
            "je veux voir", "send me the catalog", "envoie le catalogue"
        ];
        const isCatalogRequested = catalogTriggers.some(phrase => userMsgLower.includes(phrase));

        // Human-realistic reading delay: 1.5s - 3.5s based on user input length
        const readDelayMs = Math.min(3500, Math.max(1500, (userMessage?.length || 10) * 30));
        console.log(chalk.cyan(`[AutoReply] Simulating reading time (${(readDelayMs / 1000).toFixed(1)}s) for ${senderId.split('@')[0]}...`));
        await new Promise(resolve => setTimeout(resolve, readDelayMs));
        if (runHandle.cancelled || !isDavilaAllowed(sock, senderId)) {
            console.log(`[AutoReply] ⏸️ Davila cancelled after reading delay for ${senderId.split('@')[0]}.`);
            return;
        }

        const summaryName = memory.name || 'unknown';
        const summaryBusiness = memory.businessType || 'unknown';
        const summaryLocation = memory.location || 'unknown';
        const summaryPack = memory.interestedPack || 'unknown';
        const summaryProfile = memory.longTermProfile || 'none';
        const summaryTally = memory.tallyLinkSent ? 'yes' : 'no';
        const summaryFormFilled = memory.formFilled ? 'yes' : 'no';
        const summaryCatalog = memory.catalogImagesSent ? 'yes' : 'no';

        const contactSummary = `CONTACT MEMORY:
- Name: ${summaryName}
- Business: ${summaryBusiness}
- Location: ${summaryLocation}
- Interested in: ${summaryPack}
- Profile/Context: ${summaryProfile}
- Tally form already sent: ${summaryTally}
- Form filled by prospect: ${summaryFormFilled}
- Catalog images already sent: ${summaryCatalog}

Use this memory to personalize every response.
Never ask for information already provided.
Never send the Tally link if tallyLinkSent is true.
Never send catalog images if catalogImagesSent is true.`;

        // Format history text from persistent memories
        const historyText = memory.history.map(h => `${h.role}: ${h.content}`).join(' | ');

        // Build system prompt with contact summary and persistent last 20 messages context
        const personalitySystem = (activeSettings.botPersonality || '')
            .replace('{HISTORY}', `${contactSummary}\n\n${historyText}`)
            .replace('{MESSAGE}', userMessage);

        if (runHandle.cancelled || !isDavilaAllowed(sock, senderId)) {
            console.log(`[AutoReply] ⏸️ Davila cancelled before LLM for ${senderId.split('@')[0]}.`);
            return;
        }

        const aiResponse = await getAIResponse(userMessage, personalitySystem);

        if (runHandle.cancelled || !isDavilaAllowed(sock, senderId)) {
            console.log(`[AutoReply] ⏸️ Davila cancelled after LLM for ${senderId.split('@')[0]} — output discarded.`);
            return;
        }

        // Store exchange in history & save
        if (aiResponse && !aiResponse.includes('unavailable')) {
            memory.history.push({ role: 'user', content: userMessage });
            memory.history.push({ role: 'assistant', content: aiResponse });
            
            // strictly enforce last 20 messages limit
            if (memory.history.length > 20) {
                memory.history = memory.history.slice(-20);
            }
            await saveContactMemory(senderId, memory);

            // Asynchronously check if deal is closed and pin conversation
            const textHistoryForClassifier = memory.history.map(h => `${h.role}: ${h.content}`);
            checkIfDealClosed(textHistoryForClassifier, userMessage, aiResponse).then(async (isClosed) => {
                if (isClosed) {
                    console.log(chalk.bold(chalk.green(`[DealClassifier] 🚨 HOT LEAD DETECTED for ${senderId}! Handing over to owner...`)));
                    try {
                        await sock.chatModify({ pin: true }, chatId);
                        
                        // Alert the Owner
                        const ownerNum = (activeSettings.ownerNumber || '237653683174').replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        const alertMsg = `🚨 *HOT LEAD ALERT*\n\nA deal is closing or a prospect is ready to pay: ${senderId.split('@')[0]}\n\n*Name:* ${memory.name || 'Unknown'}\n*Business:* ${memory.businessType || 'Unknown'}\n*Pack:* ${memory.interestedPack || 'Unknown'}\n*Profile:* ${memory.longTermProfile || 'Unknown'}\n\n_⏸️ The AI has been paused for 10 minutes in this chat so you can intervene manually._`;
                        
                        await sock.sendMessage(ownerNum, { text: alertMsg });
                        
                        // Pause AI for 10 minutes
                        memory.aiPausedUntil = Date.now() + 10 * 60 * 1000;
                        await saveContactMemory(senderId, memory);

                        // Report deal closed to wacrm
                        try {
                            const session = bridgeState.sessionKeyForSocket(sock);
                            if (session) {
                                const chatRef = extractChatRef(chatId, senderId);
                                getReporter().reportDealClosed(session, chatRef, { pack: memory.interestedPack });
                            }
                        } catch (_) {}
                    } catch (pinErr) {
                        console.error('[DealClassifier] Failed to pin or alert owner:', pinErr.message);
                    }
                }
            }).catch((err) => {
                console.error('[DealClassifier] Background classification failure:', err.message);
            });

            // Asynchronously extract facts and update contact profile
            extractContactFacts(memory.history, userMessage, aiResponse, memory).then(async (result) => {
                if (result.updated) {
                    await saveContactMemory(senderId, result.memory);
                    console.log(chalk.green(`[FactExtractor] 🧠 Profile facts updated for ${senderId}: name=${result.memory.name}, business=${result.memory.businessType}, location=${result.memory.location}, pack=${result.memory.interestedPack}`));
                    try {
                        const session = bridgeState.sessionKeyForSocket(sock);
                        if (session) {
                            const chatRef = extractChatRef(chatId, senderId);
                            getReporter().reportContactFacts(session, chatRef, {
                                name: result.memory.name,
                                businessType: result.memory.businessType,
                                location: result.memory.location,
                                interestedPack: result.memory.interestedPack,
                            });
                        }
                    } catch (_) {}
                }
            }).catch(err => {
                console.error('[FactExtractor] Fact extraction failure:', err.message);
            });
        }

        const replyText = aiResponse || activeSettings.autoReplyMessage || "Got your message. I'll get back to you shortly.";
        
        // Human-realistic Typing Burst (2.0s - 5.5s right before message dispatch)
        const typingDurationMs = Math.min(5500, Math.max(2000, Math.floor((replyText?.length || 50) * 24)));
        await safePresence(sock, 'composing', chatId);
        const typingStart = Date.now();
        while (Date.now() - typingStart < typingDurationMs) {
            if (runHandle.cancelled || !isDavilaAllowed(sock, senderId)) {
                await safePresence(sock, 'paused', chatId);
                console.log(`[AutoReply] ⏸️ Davila typing cancelled mid-burst for ${senderId.split('@')[0]}.`);
                return;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        await safePresence(sock, 'paused', chatId);

        // Global Token Bucket Slot (Throttle bursts across all chats)
        await securityManager.acquireGlobalSendSlot();

        // Re-check: an agent may have taken over from wacrm while the reply was being generated.
        if (runHandle.cancelled || !isDavilaAllowed(sock, senderId)) {
            console.log(`[AutoReply] ⏸️ Davila reply for ${senderId.split('@')[0]} dropped — handed over via wacrm.`);
            return;
        }

        await sock.sendMessage(chatId, { text: replyText }, { quoted: message, _origin: 'davila' });
        
        // Track bot response for security checks
        await securityManager.recordBotResponse(sock, senderId, senderName, activeSettings);

        // FEATURE 1 — Tally Order Form
        if (isTallyRequested && !memory.tallyLinkSent) {
            memory.tallyLinkSent = true;
            await saveContactMemory(senderId, memory);
            try {
                const session = bridgeState.sessionKeyForSocket(sock);
                if (session) {
                    const chatRef = extractChatRef(chatId, senderId);
                    getReporter().reportTallySubmitted(session, chatRef);
                }
            } catch (_) {}
            await new Promise(r => setTimeout(r, 1500));
            const tallyFormLink = activeSettings.tallyFormLink || 'https://tally.so/r/J9eWDX';
            await sock.sendMessage(chatId, {
                text: `👉 To get started, fill in this form and we will contact you within 24 hours:\n${tallyFormLink}`
            }, { quoted: message, _origin: 'davila' });
        }

        // FEATURE 2 — Catalog Image on Demand
        if (isCatalogRequested) {
            memory.catalogImagesSent = true;
            await saveContactMemory(senderId, memory);

            const starterPath = activeSettings.catalogImages?.starter || './catalog/starter.jpg';
            const businessPath = activeSettings.catalogImages?.business || './catalog/business.jpg';
            const elitePath = activeSettings.catalogImages?.elite || './catalog/elite.jpg';
            const tallyFormLink = activeSettings.tallyFormLink || 'https://tally.so/r/J9eWDX';

            const catalogPacks = {
                starter: {
                    path: starterPath,
                    caption: `*STARTER — 25,000 FCFA/month*\n• 1 WhatsApp number with automated 24/7 AI responses\n• Basic business knowledge base configuration included\n• Full monthly maintenance and operational monitoring\n\n👉 Ready to order: ${tallyFormLink}`
                },
                business: {
                    path: businessPath,
                    caption: `*BUSINESS — 75,000 FCFA/month*\n• 2 WhatsApp numbers with advanced multi-agent capabilities\n• Full Tally Form & automated Google Calendar integrations\n• Extended knowledge base setup with priority support\n\n👉 Ready to order: ${tallyFormLink}`
                },
                elite: {
                    path: elitePath,
                    caption: `*ELITE — 350,000 FCFA/month*\n• Complete business process automation & lead tracking CRM\n• Deep Google Workspace & custom CRM calendar sync\n• One-on-one custom onboarding session with M. Tchuekam\n\n👉 Ready to order: ${tallyFormLink}`
                }
            };

            let packsToSend = [];
            if (userMsgLower.includes('starter')) {
                packsToSend.push('starter');
            }
            if (userMsgLower.includes('business')) {
                packsToSend.push('business');
            }
            if (userMsgLower.includes('elite')) {
                packsToSend.push('elite');
            }

            // If no specific pack is mentioned, send all 3 images in sequence
            if (packsToSend.length === 0) {
                packsToSend = ['starter', 'business', 'elite'];
            }

            await new Promise(r => setTimeout(r, 1500));
            for (let i = 0; i < packsToSend.length; i++) {
                const packKey = packsToSend[i];
                const pack = catalogPacks[packKey];
                try {
                    if (fs.existsSync(pack.path)) {
                        await sock.sendMessage(chatId, {
                            image: fs.readFileSync(pack.path),
                            caption: pack.caption
                        }, { quoted: message, _origin: 'davila' });
                    } else {
                        // Image missing — send caption as text so customer still gets pricing info
                        await sock.sendMessage(chatId, { text: pack.caption }, { quoted: message, _origin: 'davila' });
                    }
                    if (i < packsToSend.length - 1) {
                        await new Promise(r => setTimeout(r, 2000));
                    }
                } catch (sendErr) {
                    console.error(`[Catalog] Failed to send pack info: ${sendErr.message}`);
                }
            }
        }

    } catch (err) {
        console.error('[AutoReply] AI failure:', err.message);
        if (runHandle.cancelled || !isDavilaAllowed(sock, senderId)) {
            console.log(`[AutoReply] ⏸️ Davila error suppressed because takeover/cancellation is active for ${senderId.split('@')[0]}.`);
            return;
        }
        try {
            await safePresence(sock, 'available', chatId);
            await sock.sendMessage(chatId, {
                text: activeSettings.autoReplyMessage || "hey, got your message — let me check on that and get back to you 👍"
            }, { quoted: message, _origin: 'davila' });
            
            await securityManager.recordBotResponse(sock, senderId, senderName, activeSettings);
        } catch (fallbackErr) {
            console.error('[AutoReply] Fallback also failed:', fallbackErr.message);
        }
    } finally {
        bridgeState.unregisterActiveDavilaRun(contactKey, runHandle);
        await safePresence(sock, 'paused', chatId);
    }
}

module.exports = { handleAutoReply };
