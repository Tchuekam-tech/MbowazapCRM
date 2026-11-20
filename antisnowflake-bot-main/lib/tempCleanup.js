const fs = require('fs');
const path = require('path');

// Utility for cleaning temp files
async function cleanupTempFiles() {
    const tempDir = path.join(process.cwd(), 'temp');

    if (!fs.existsSync(tempDir)) {
        return 0;
    }

    let files;
    try {
        files = await fs.promises.readdir(tempDir);
    } catch (err) {
        console.error('Error reading temp directory:', err);
        return 0;
    }

    let cleanedCount = 0;
    const now = Date.now();
    const maxAge = 3 * 60 * 60 * 1000; // 3 hours

    await Promise.all(files.map(async (file) => {
        const filePath = path.join(tempDir, file);
        try {
            const stats = await fs.promises.stat(filePath);
            if (stats.isFile() && (now - stats.mtimeMs > maxAge)) {
                await fs.promises.unlink(filePath);
                cleanedCount++;
                console.log(`🧹 Cleaned temp file: ${file}`);
            }
        } catch (_) {
            // File disappeared or unreadable — ignore
        }
    }));

    if (cleanedCount > 0) {
        console.log(`🧹 Cleaned ${cleanedCount} temp files`);
    }
    return cleanedCount;
}

// Cleanup on startup
cleanupTempFiles().catch(() => {});

// Cleanup every hour (unref so it does not keep tests or short-lived scripts alive)
const cleanupTimer = setInterval(() => {
    cleanupTempFiles().catch(() => {});
}, 60 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
}

module.exports = { cleanupTempFiles };

