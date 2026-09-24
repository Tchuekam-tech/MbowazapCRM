const fs = require('fs');
const path = require('path');

const mainFile = path.join(__dirname, 'main.js');
let code = fs.readFileSync(mainFile, 'utf8');

const targetStr = '// Local Storage for Self-Reply and Double-Reply loop protection';

if (!code.includes('// Ensure data directory and messageCount.json exist')) {
    const patch = `// Ensure data directory and messageCount.json exist to prevent startup crashes
const DATA_DIR = './data';
const MESSAGE_COUNT_FILE = './data/messageCount.json';

try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(MESSAGE_COUNT_FILE)) {
        fs.writeFileSync(MESSAGE_COUNT_FILE, JSON.stringify({ isPublic: true }, null, 2), 'utf8');
    }
} catch (error) {
    console.error('Failed to initialize data folder and messageCount.json:', error);
}

`;
    code = code.replace(targetStr, patch + targetStr);
    fs.writeFileSync(mainFile, code, 'utf8');
    console.log('main.js successfully patched.');
} else {
    console.log('main.js already patched.');
}
