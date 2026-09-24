/**
 * Safe Temporary File & Cache Cleanup Utility
 * Cleans transient caches, audio/video scratch buffers, and temporary folders
 * while strictly preserving all authentication sessions, persistent memory, and configs.
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const CLEANUP_TARGETS = [
    './temp',
    './tmp',
    './data/temp_qr'
];

let filesRemoved = 0;
let bytesReclaimed = 0;

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function cleanDirectory(targetPath) {
    if (!fs.existsSync(targetPath)) return;

    try {
        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(targetPath, entry.name);
            if (entry.isDirectory()) {
                cleanDirectory(fullPath);
                // Remove directory if empty after cleaning
                try {
                    if (fs.readdirSync(fullPath).length === 0) {
                        fs.rmdirSync(fullPath);
                    }
                } catch (_) {}
            } else {
                try {
                    const stats = fs.statSync(fullPath);
                    bytesReclaimed += stats.size;
                    fs.unlinkSync(fullPath);
                    filesRemoved++;
                } catch (err) {
                    console.warn(chalk.yellow(`[cleanup] Could not remove file ${fullPath}: ${err.message}`));
                }
            }
        }
    } catch (err) {
        console.error(chalk.red(`[cleanup] Error reading directory ${targetPath}: ${err.message}`));
    }
}

console.log(chalk.cyan(`\n🧹 [cleanup] Starting safe workspace cleanup...`));

for (const target of CLEANUP_TARGETS) {
    const resolved = path.resolve(__dirname, target);
    if (fs.existsSync(resolved)) {
        cleanDirectory(resolved);
        // Ensure base temp directory remains present for future runtime usage
        if (!fs.existsSync(resolved)) {
            fs.mkdirSync(resolved, { recursive: true });
        }
    }
}

console.log(chalk.green(`✅ [cleanup] Cleanup complete!`));
console.log(chalk.white(`   • Files removed: ${chalk.bold(filesRemoved)}`));
console.log(chalk.white(`   • Space reclaimed: ${chalk.bold(formatBytes(bytesReclaimed))}`));
console.log(chalk.gray(`   • Sessions, configs, and CRM memory preserved intact.\n`));
