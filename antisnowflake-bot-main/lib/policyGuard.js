const settings = require('../settings');

const DEFAULT_POLICY_GUARD = {
    enabled: true,
    blockHighRiskCommands: true,
    disablePrivacyBypass: true,
    disablePresenceAutomation: true,
    stripDeceptiveMetadata: true
};

const BLOCKED_COMMAND_RULES = [
    {
        prefixes: ['.vv', '.ok', '.wow', '.viewonce'],
        reason: 'view-once bypass is disabled in compliance mode'
    },
    {
        prefixes: ['.antiviewonce'],
        reason: 'capturing view-once media is disabled in compliance mode'
    },
    {
        prefixes: ['.antidelete'],
        reason: 'storing deleted messages is disabled in compliance mode'
    },
    {
        prefixes: ['.statusdl'],
        reason: 'status downloading is disabled in compliance mode'
    },
    {
        prefixes: ['.campaign'],
        reason: 'broadcast campaigns are disabled in compliance mode'
    },
    {
        prefixes: ['.autotyping', '.autorecording'],
        reason: 'fake presence signals are disabled in compliance mode'
    },
    {
        prefixes: ['.tagall', '.hidetag'],
        reason: 'mass-tagging is restricted to prevent spam reports and account bans'
    }
];

function getPolicyConfig() {
    return {
        ...DEFAULT_POLICY_GUARD,
        ...(settings.policyGuard || {})
    };
}

function isPolicyGuardEnabled() {
    return getPolicyConfig().enabled !== false;
}

function matchesCommandPrefix(text, prefix) {
    return text === prefix || text.startsWith(`${prefix} `);
}

function getBlockedCommandInfo(text = '') {
    const normalized = text.trim().toLowerCase();
    const policy = getPolicyConfig();

    if (!normalized || !isPolicyGuardEnabled() || !policy.blockHighRiskCommands) {
        return null;
    }

    for (const rule of BLOCKED_COMMAND_RULES) {
        const matchedPrefix = rule.prefixes.find(prefix => matchesCommandPrefix(normalized, prefix));
        if (matchedPrefix) {
            return { command: matchedPrefix, reason: rule.reason };
        }
    }

    return null;
}

function sanitizeContextInfo(contextInfo) {
    if (!contextInfo || typeof contextInfo !== 'object' || Buffer.isBuffer(contextInfo)) {
        return contextInfo;
    }

    const sanitized = {};

    for (const [key, value] of Object.entries(contextInfo)) {
        // Strip fake newsletter forward markers and deceptive forwarding scores
        if (
            key === 'forwardedNewsletterMessageInfo' || 
            key === 'isForwarded' || 
            key === 'forwardingScore' ||
            (key === 'externalAdReply' && !value?.mediaUrl)
        ) {
            continue;
        }

        sanitized[key] = sanitizeOutgoingContent(value);
    }

    return sanitized;
}

function sanitizeOutgoingContent(content) {
    const policy = getPolicyConfig();

    if (!isPolicyGuardEnabled() || !policy.stripDeceptiveMetadata) {
        return content;
    }

    if (!content || typeof content !== 'object' || Buffer.isBuffer(content)) {
        return content;
    }

    if (Array.isArray(content)) {
        return content.map(item => sanitizeOutgoingContent(item));
    }

    const sanitized = {};

    for (const [key, value] of Object.entries(content)) {
        if (key === 'contextInfo') {
            const cleanedContext = sanitizeContextInfo(value);
            if (cleanedContext && Object.keys(cleanedContext).length > 0) {
                sanitized[key] = cleanedContext;
            }
            continue;
        }

        sanitized[key] = sanitizeOutgoingContent(value);
    }

    return sanitized;
}

function buildComplianceMessage(info) {
    return `⚠️ ${info.command} is disabled. ${info.reason}. Use normal replies, clear opt-in, and human handoff instead.`;
}

module.exports = {
    getPolicyConfig,
    isPolicyGuardEnabled,
    getBlockedCommandInfo,
    sanitizeOutgoingContent,
    buildComplianceMessage
};
