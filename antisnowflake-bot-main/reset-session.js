/**
 * Safe Session Management & Reset Utility
 * Allows targeted resetting of specific WhatsApp sessions or clearing stale/unregistered sessions
 * without deleting customer CRM memories or business configurations.
 * 
 * Usage:
 *   node reset-session.js                   -> List all active sessions and statuses
 *   node reset-session.js <phone_number>    -> Safely remove credentials for specific number
 *   node reset-session.js --all             -> Wipe all WhatsApp auth credentials (requires clean re-pair)
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const SESSIONS_DIR = path.resolve(__dirname, './data/sessions');
const BACKUP_DIR = path.resolve(__dirname, './data/session_backup');

function getSessionStatus(sessionPath) {
    const credsFile = path.join(sessionPath, 'creds.json');
    if (!fs.existsSync(credsFile)) return { exists: false, registered: false, status: 'No Credentials' };
    try {
        const raw = fs.readFileSync(credsFile, 'utf8').trim();
        if (raw.length === 0) return { exists: true, registered: false, status: 'Empty File' };
        const creds = JSON.parse(raw);
        return {
            exists: true,
            registered: !!creds.registered,
            status: creds.registered ? 'Connected & Registered' : 'Unregistered (Awaiting Pairing)'
        };
    } catch (_) {
        return { exists: true, registered: false, status: 'Corrupted' };
    }
}

function resetTargetSession(number) {
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSIONS_DIR, cleanNumber);
    const backupPath = path.join(BACKUP_DIR, cleanNumber);

    let removed = false;
    if (fs.existsSync(sessionPath)) {
        try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log(chalk.green(`✅ Removed session folder: ${sessionPath}`));
            removed = true;
        } catch (e) {
            console.error(chalk.red(`❌ Failed to remove session ${sessionPath}: ${e.message}`));
        }
    }

    if (fs.existsSync(backupPath)) {
        try {
            fs.rmSync(backupPath, { recursive: true, force: true });
            console.log(chalk.green(`✅ Removed backup folder: ${backupPath}`));
            removed = true;
        } catch (_) {}
    }

    if (!removed) {
        console.log(chalk.yellow(`ℹ️ No session data found for number: ${cleanNumber}`));
    } else {
        console.log(chalk.cyan(`\n✨ Session for ${cleanNumber} has been reset. You can now pair a new device with 'npm run start:pairing' or via http://localhost:8080/`));
    }
}

const args = process.argv.slice(2);
const target = args[0];

if (!target) {
    console.log(chalk.bold(chalk.cyan(`\n📱 [Session Manager] Active WhatsApp Sessions\n`)));
    if (!fs.existsSync(SESSIONS_DIR)) {
        console.log(chalk.gray(`No sessions directory found at ${SESSIONS_DIR}.`));
        process.exit(0);
    }

    const folders = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('temp_'));

    if (folders.length === 0) {
        console.log(chalk.gray(`No session profiles currently registered.`));
    } else {
        folders.forEach((folder, idx) => {
            const folderPath = path.join(SESSIONS_DIR, folder.name);
            const info = getSessionStatus(folderPath);
            const statusColor = info.registered ? chalk.green : chalk.yellow;
            console.log(`${idx + 1}. Number: ${chalk.bold(folder.name)} | Status: ${statusColor(info.status)}`);
        });
    }

    console.log(chalk.white(`\n💡 To reset a specific session:`));
    console.log(chalk.gray(`   node reset-session.js <phone_number>`));
    console.log(chalk.white(`💡 To reset all sessions:`));
    console.log(chalk.gray(`   node reset-session.js --all\n`));
    process.exit(0);
}

if (target === '--all') {
    console.log(chalk.yellow(`\n⚠️  Resetting ALL WhatsApp sessions...`));
    if (fs.existsSync(SESSIONS_DIR)) {
        const folders = fs.readdirSync(SESSIONS_DIR);
        for (const f of folders) {
            try {
                fs.rmSync(path.join(SESSIONS_DIR, f), { recursive: true, force: true });
                console.log(chalk.green(`   • Cleared: ${f}`));
            } catch (_) {}
        }
    }
    if (fs.existsSync(BACKUP_DIR)) {
        try { fs.rmSync(BACKUP_DIR, { recursive: true, force: true }); } catch (_) {}
    }
    console.log(chalk.green(`\n✅ All WhatsApp sessions cleared. Ready for fresh pairing.\n`));
} else {
    resetTargetSession(target);
}
