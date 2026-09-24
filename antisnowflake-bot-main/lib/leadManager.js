const fs = require('fs');
const path = require('path');

const LEADS_FILE = path.join(__dirname, '../data/leads.json');

function ensureDataDir() {
    const dir = path.dirname(LEADS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function captureLead(sock, senderId, message, userMessage) {
    ensureDataDir();
    
    let leads = [];
    if (fs.existsSync(LEADS_FILE)) {
        try {
            leads = JSON.parse(fs.readFileSync(LEADS_FILE));
        } catch (e) {
            leads = [];
        }
    }

    // Check if lead already exists based on number
    const existingLeadIndex = leads.findIndex(lead => lead.number === senderId);
    
    // Get sender name if possible
    let senderName = message.pushName || 'Unknown';
    if (senderName === 'Unknown') {
        try {
            senderName = await sock.getName(senderId) || 'Unknown';
        } catch (e) {}
    }

    const leadData = {
        number: senderId,
        name: senderName,
        lastMessage: userMessage,
        timestamp: new Date().toISOString()
    };

    if (existingLeadIndex !== -1) {
        // Update existing lead's last message and timestamp
        leads[existingLeadIndex].lastMessage = leadData.lastMessage;
        leads[existingLeadIndex].timestamp = leadData.timestamp;
        if (senderName !== 'Unknown' && leads[existingLeadIndex].name === 'Unknown') {
            leads[existingLeadIndex].name = senderName;
        }
    } else {
        leads.push(leadData);
    }

    try {
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    } catch (e) {
        console.error("Failed to save lead", e);
    }
}

module.exports = { captureLead };
