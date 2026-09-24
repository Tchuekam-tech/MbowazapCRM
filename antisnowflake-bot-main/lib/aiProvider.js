const { fetch } = require('undici');
const settings = require('../settings');

/**
 * Robust AI Provider Library
 * Handles Groq, Tchuekam, and DeepSeek integration with fault tolerance and key rotation.
 * Includes automatic cross-provider fallback: if primary fails, tries the others in order.
 */

const FALLBACK_MESSAGE = "AI is currently unavailable 😅 try again in a moment";

/**
 * Exponential backoff delay
 * @param {number} attempt 
 */
const delay = (attempt) => new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));

/**
 * Structured Logging
 */
function log(message, type = 'info') {
    if (!settings.debugMode) return;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [AI-${type.toUpperCase()}] ${message}`);
}

/**
 * Classifies errors for retry logic
 * @param {Error|Object} error 
 * @returns {boolean} Should retry
 */
function shouldRetry(error, status) {
    // Retry on network errors
    if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('fetch failed')) {
        return true;
    }
    // Retry on rate limit (429) or server errors (5xx)
    if (status === 429 || (status >= 500 && status <= 599)) {
        return true;
    }
    return false;
}

/**
 * DeepSeek Provider Implementation
 */
async function callDeepSeek(apiKey, prompt, systemPrompt) {
    if (!apiKey) {
        throw new Error('DEEPSEEK_API_KEY is not configured');
    }
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages,
            temperature: 0.9,
            max_tokens: 300
        }),
        signal: AbortSignal.timeout(12000) // 12s timeout for reliable response
    });

    const data = await response.json();
    if (response.status !== 200) {
        throw { status: response.status, data, message: data?.error?.message || `DeepSeek HTTP ${response.status}` };
    }

    return data.choices?.[0]?.message?.content;
}

/**
 * Groq Provider Implementation
 */
async function callGroq(apiKey, prompt, systemPrompt) {
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is not configured');
    }
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages,
            temperature: 0.9,
            max_tokens: 300
        }),
        signal: AbortSignal.timeout(10000) // 10s timeout for primary
    });

    const data = await response.json();
    if (response.status !== 200) {
        throw { status: response.status, data, message: data?.error?.message || `Groq HTTP ${response.status}` };
    }

    return data.choices?.[0]?.message?.content;
}

/**
 * Tchuekam Provider Implementation
 */
async function callTchuekam(apiKey, prompt, systemPrompt) {
    if (!apiKey) {
        throw new Error('Tchuekam API key is not configured');
    }
    const model = settings.tchuekamModel || 'gemini-2.0-flash';
    const requestBody = {
        contents: [{
            role: 'user',
            parts: [{ text: prompt }]
        }],
        systemInstruction: systemPrompt ? {
            parts: [{ text: systemPrompt }]
        } : undefined,
        generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.9
        }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10000) // 10s timeout for fallback
    });

    const data = await response.json();
    if (response.status !== 200) {
        throw { status: response.status, data, message: data?.error?.message || `Tchuekam HTTP ${response.status}` };
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

/**
 * Try a single provider with retries, key rotation, and ultra-fast failover triggers
 * @returns {string|null} result or null on failure
 */
async function tryProvider(providerName, prompt, systemPrompt) {
    // Determine the list of keys to try for this provider
    let keys = [];
    if (providerName === 'groq') {
        keys = [
            process.env.GROQ_API_KEY,
            process.env.GROQ_API,
            process.env.GROQ_KEY,
            process.env.GROQ_API_KEY_2,
            process.env.GROQ_KEY_2,
            settings.groqApiKey
        ];
    } else if (providerName === 'deepseek') {
        keys = [
            process.env.DEEPSEEK_API_KEY,
            process.env.DEEPSEEK_API,
            process.env.DEEPSEEK_KEY,
            settings.deepseekApiKey
        ];
    } else if (providerName === 'tchuekam' || providerName === 'gemini') {
        keys = [
            process.env.TCHUEKAM_API_KEY,
            process.env.TCHUEKAM_API_KEY_2,
            process.env.TCHUEKAM_API_KEY_3,
            process.env.TCHUEKAM_API_2,
            process.env.TCHUEKAM_API_3,
            process.env.TCHUEKAM_API,
            process.env.TCHUEKAM_KEY,
            process.env.TCHUEKAM_KEY_2,
            process.env.TCHUEKAM_KEY_3,
            settings.tchuekamApiKey,
            process.env.GEMINI_API_KEY,
            process.env.GEMINI_API_KEY_2,
            process.env.GEMINI_API_KEY_3,
            process.env.GEMINI_API_2,
            process.env.GEMINI_API_3,
            process.env.GEMINI_API,
            process.env.GEMINI_KEY,
            process.env.GEMINI_KEY_2,
            process.env.GEMINI_KEY_3,
            settings.geminiApiKey
        ];
    } else {
        return null;
    }

    // Filter, sanitize, and deduplicate the keys list
    keys = keys.filter(k => k && typeof k === 'string' && k.trim() !== '');
    const uniqueKeys = [...new Set(keys)];

    if (uniqueKeys.length === 0) {
        log(`Provider ${providerName} has no configured API keys. Skipping.`, 'warning');
        return null;
    }

    log(`Attempting provider ${providerName} with ${uniqueKeys.length} unique API key(s)...`, 'info');

    for (let keyIndex = 0; keyIndex < uniqueKeys.length; keyIndex++) {
        const apiKey = uniqueKeys[keyIndex];
        // Obfuscate key for logging safety (e.g., first 4 and last 4 characters)
        const maskedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : '***';
        
        log(`Using key [${keyIndex + 1}/${uniqueKeys.length}] (${maskedKey}) for ${providerName}`, 'info');

        // Try to execute request using the active key with transient retry logic
        const maxRetries = 1;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                let result;
                if (providerName === 'deepseek') {
                    result = await callDeepSeek(apiKey, prompt, systemPrompt);
                } else if (providerName === 'groq') {
                    result = await callGroq(apiKey, prompt, systemPrompt);
                } else if (providerName === 'tchuekam' || providerName === 'gemini') {
                    result = await callTchuekam(apiKey, prompt, systemPrompt);
                }

                if (!result) throw new Error('EMPTY_RESPONSE');

                log(`${providerName} success on key [${keyIndex + 1}/${uniqueKeys.length}] attempt ${attempt + 1}`, 'success');
                return result.trim();

            } catch (error) {
                const status = error.status || 0;
                const errorMsg = error.data?.error?.message || error.message || 'Unknown error';
                const errorLower = errorMsg.toLowerCase();

                log(`${providerName} key [${keyIndex + 1}/${uniqueKeys.length}] attempt ${attempt + 1} failed | Status: ${status} | Error: ${errorMsg}`, 'warning');

                // Immediate key failover trigger: if auth error, rate limit/quota error, insufficient balance, or model decommissioned, do not retry this key
                const isImmediateFailover = status === 429 || status === 401 || status === 403 || status === 402 ||
                                            errorLower.includes('quota') || errorLower.includes('limit') || 
                                            errorLower.includes('key') || errorLower.includes('unauthorized') || 
                                            errorLower.includes('rate_limit') || errorLower.includes('exhausted') || 
                                            errorLower.includes('exceeded') || errorLower.includes('timeout') ||
                                            errorLower.includes('invalid') || errorLower.includes('balance') ||
                                            errorLower.includes('insufficient');

                if (isImmediateFailover) {
                    log(`${providerName} key [${keyIndex + 1}] hit immediate failover trigger (Status: ${status}). Rotating to next key...`, 'error');
                    break; // break out of the retry loop to immediately rotate to the next key
                }

                if (attempt < maxRetries && shouldRetry(error, status)) {
                    log(`${providerName} transient failure, retrying key in 200ms...`, 'retry');
                    await new Promise(r => setTimeout(r, 200));
                } else {
                    // Non-retryable error or retries exhausted: rotate to next key
                    log(`${providerName} key [${keyIndex + 1}] exhausted. Rotating to next key...`, 'warning');
                    break;
                }
            }
        }
    }

    log(`All API keys for provider ${providerName} failed.`, 'error');
    return null;
}

/**
 * Main AI Request Handler with Fast Fallback Chain
 * Execution order: Groq (primary) -> DeepSeek -> Tchuekam (unless settings.aiProvider overrides the primary)
 * @param {string} prompt 
 * @param {string} systemPrompt 
 * @returns {Promise<string>}
 */
async function getAIResponse(prompt, systemPrompt = '') {
    const defaultChain = ['groq', 'deepseek', 'tchuekam'];
    const primarySetting = (settings.aiProvider || 'groq').toLowerCase();
    
    // Construct fallback chain ensuring primary is attempted first, followed by remaining defaults
    const chain = [primarySetting === 'gemini' ? 'tchuekam' : primarySetting];
    for (const p of defaultChain) {
        if (p !== chain[0]) {
            chain.push(p);
        }
    }

    log(`Starting AI execution chain | Sequence: ${chain.join(' -> ')}`, 'info');

    for (const provider of chain) {
        log(`Executing provider: ${provider}`, 'info');
        // tryProvider handles its own key rotation internally
        const result = await tryProvider(provider, prompt, systemPrompt);
        if (result) return result;
        log(`Provider ${provider} failed. Moving to next provider in fallback chain...`, 'warning');
    }

    // All fallback providers failed
    log(`All providers in fallback chain failed. Returning fallback message.`, 'error');
    return FALLBACK_MESSAGE;
}

module.exports = { getAIResponse };
