const { fetch } = require('undici');
const settings = require('../settings');

async function handleAiDiagCommand(sock, chatId, message) {
    await sock.sendMessage(chatId, { react: { text: "⏳", key: message.key } });

    let diagnosticReport = `⚙️ *[MBOWAZAP MULTI-API KEY DIAGNOSTIC REPORT]*\n`;
    diagnosticReport += `═════════════════════════════\n\n`;

    // Helper to mask keys for output safety
    const maskKey = (key) => {
        if (!key) return '';
        return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '***';
    };

    // 1. Check Groq Keys
    diagnosticReport += `🤖 *PROVIDER 1: GROQ*\n`;
    let groqKeys = [
        { name: 'Primary (GROQ_API_KEY)', key: process.env.GROQ_API_KEY || settings.groqApiKey },
        { name: 'Secondary (GROQ_API)', key: process.env.GROQ_API }
    ].filter(k => k.key);

    if (groqKeys.length === 0) {
        diagnosticReport += `❌ Status: NOT CONFIGURED\n`;
        diagnosticReport += `💡 Rationale: No Groq API keys are available in process.env.\n\n`;
    } else {
        for (const { name, key } of groqKeys) {
            diagnosticReport += `🔑 ${name}: DETECTED (${maskKey(key)})\n`;
            diagnosticReport += `📡 Testing Connection... `;
            try {
                const start = Date.now();
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'llama-3.3-70b-versatile',
                        messages: [{ role: 'user', content: 'Ping' }],
                        max_tokens: 5
                    }),
                    signal: AbortSignal.timeout(6000)
                });
                const duration = Date.now() - start;
                const data = await response.json();

                if (response.status === 200) {
                    diagnosticReport += `🟢 SUCCESS (${duration}ms)\n\n`;
                } else {
                    diagnosticReport += `🔴 FAILED\n`;
                    diagnosticReport += `❌ HTTP Status: ${response.status}\n`;
                    diagnosticReport += `📝 Error Details: ${data?.error?.message || JSON.stringify(data)}\n\n`;
                }
            } catch (err) {
                diagnosticReport += `🔴 CONNECTION ERROR\n`;
                diagnosticReport += `📝 Exception: ${err.message}\n\n`;
            }
        }
    }

    // 2. Check DeepSeek Keys
    diagnosticReport += `🧠 *PROVIDER 2: DEEPSEEK*\n`;
    let deepseekKeys = [
        { name: 'Primary (DEEPSEEK_API_KEY)', key: process.env.DEEPSEEK_API_KEY || settings.deepseekApiKey }
    ].filter(k => k.key);

    if (deepseekKeys.length === 0) {
        diagnosticReport += `❌ Status: NOT CONFIGURED\n`;
        diagnosticReport += `💡 Rationale: No DeepSeek API keys are available.\n\n`;
    } else {
        for (const { name, key } of deepseekKeys) {
            diagnosticReport += `🔑 ${name}: DETECTED (${maskKey(key)})\n`;
            diagnosticReport += `📡 Testing Connection... `;
            try {
                const start = Date.now();
                const response = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [{ role: 'user', content: 'Ping' }],
                        max_tokens: 5
                    }),
                    signal: AbortSignal.timeout(6000)
                });
                const duration = Date.now() - start;
                const data = await response.json();

                if (response.status === 200) {
                    diagnosticReport += `🟢 SUCCESS (${duration}ms)\n\n`;
                } else {
                    diagnosticReport += `🔴 FAILED\n`;
                    diagnosticReport += `❌ HTTP Status: ${response.status}\n`;
                    diagnosticReport += `📝 Error: ${data?.error?.message || JSON.stringify(data)}\n\n`;
                }
            } catch (err) {
                diagnosticReport += `🔴 CONNECTION ERROR\n`;
                diagnosticReport += `📝 Exception: ${err.message}\n\n`;
            }
        }
    }

    // 3. Check Tchuekam Keys
    diagnosticReport += `🛡️ *PROVIDER 3: TCHUEKAM*\n`;
    let tchuekamKeys = [
        { name: 'Primary (TCHUEKAM_API_KEY)', key: process.env.TCHUEKAM_API_KEY || settings.tchuekamApiKey },
        { name: 'Secondary (TCHUEKAM_API_KEY_2)', key: process.env.TCHUEKAM_API_KEY_2 },
        { name: 'Secondary (TCHUEKAM_API_2)', key: process.env.TCHUEKAM_API_2 },
        { name: 'Secondary (TCHUEKAM_API)', key: process.env.TCHUEKAM_API }
    ].filter(k => k.key);

    // Keep unique keys only
    let seenKeys = new Set();
    tchuekamKeys = tchuekamKeys.filter(k => {
        if (seenKeys.has(k.key)) return false;
        seenKeys.add(k.key);
        return true;
    });

    if (tchuekamKeys.length === 0) {
        diagnosticReport += `❌ Status: NOT CONFIGURED\n`;
        diagnosticReport += `💡 Rationale: No Tchuekam API keys are available.\n\n`;
    } else {
        for (const { name, key } of tchuekamKeys) {
            diagnosticReport += `🔑 ${name}: DETECTED (${maskKey(key)})\n`;
            diagnosticReport += `📡 Testing Connection... `;
            try {
                const start = Date.now();
                const model = settings.tchuekamModel || 'gemini-2.0-flash';
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: 'Ping' }] }],
                        generationConfig: { maxOutputTokens: 5 }
                    }),
                    signal: AbortSignal.timeout(6000)
                });
                const duration = Date.now() - start;
                const data = await response.json();

                if (response.status === 200) {
                    diagnosticReport += `🟢 SUCCESS (${duration}ms)\n\n`;
                } else {
                    diagnosticReport += `🔴 FAILED\n`;
                    diagnosticReport += `❌ HTTP Status: ${response.status}\n`;
                    diagnosticReport += `📝 Error: ${data?.error?.message || JSON.stringify(data)}\n\n`;
                }
            } catch (err) {
                diagnosticReport += `🔴 CONNECTION ERROR\n`;
                diagnosticReport += `📝 Exception: ${err.message}\n\n`;
            }
        }
    }

    // 4. Overall Configuration Status
    diagnosticReport += `═════════════════════════════\n`;
    diagnosticReport += `⚙️ *SYSTEM ARCHITECTURE SUMMARY*\n`;
    diagnosticReport += `🔗 Fallback Sequence: ${settings.aiProvider.toUpperCase()} ➡️ Fallbacks (Groq, DeepSeek, Tchuekam)\n`;
    diagnosticReport += `🔋 Key Rotation: ACTIVE & SEGREGATED\n`;
    diagnosticReport += `🎯 Active Provider Preference: ${settings.aiProvider.toUpperCase()}\n`;
    diagnosticReport += `═════════════════════════════`;

    await sock.sendMessage(chatId, { text: diagnosticReport }, { quoted: message });
    await sock.sendMessage(chatId, { react: { text: "✅", key: message.key } });
}

module.exports = handleAiDiagCommand;
