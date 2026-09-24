/**
 * ESM-to-CJS Bridge Preloader
 * 
 * @whiskeysockets/baileys v6.7+ ships as ESM-only ("type": "module").
 * This project is entirely CommonJS. Rather than rewriting 21+ files,
 * this preloader dynamically imports baileys, injects it into Node's
 * require cache, then boots the real entry point (index.js).
 * 
 * Every subsequent require('@whiskeysockets/baileys') will hit the
 * pre-populated cache and return the module synchronously.
 */

require('dotenv').config();
const Module = require('module');
const path = require('path');

// --- Silence Overhaul: Global Console Interceptor ---
// Suppresses spammy logs from third-party libraries or mystery sources.
const originalLog = console.log;
const forbiddenLogs = [
    'Installing commands',
    'Downloading creds data',
    'Commands installed successfully',
    'MEGA.nz session',
    'Connection notice with image',
    'Connected Successfully',
    'Checking metadata',
    'Engaging Connection to',
    'Downloading MEGA.nz session'
];

console.log = function(...args) {
    const logStr = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
    if (forbiddenLogs.some(forbidden => logStr.includes(forbidden))) {
        return; // Suppress
    }
    originalLog.apply(console, args);
};
// --------------------------------------------------

async function boot() {
    // 1. Dynamically import the ESM baileys module
    console.log('[preload] Loading @whiskeysockets/baileys via dynamic import...');
    const baileys = await import('@whiskeysockets/baileys');
    
    // 2. Build a CJS-compatible module object from the ESM namespace
    //    All named exports + default export flattened into one object
    const cjsExports = { ...baileys };
    if (baileys.default) {
        Object.assign(cjsExports, baileys.default);
        cjsExports.default = baileys.default;
    }

    // 3. Resolve the baileys package directory
    const pkgJsonPath = require.resolve('@whiskeysockets/baileys/package.json');
    const baileysDir = path.dirname(pkgJsonPath);
    const baileysMain = path.join(baileysDir, 'lib', 'index.js');

    // 4. Inject main module into Node's require cache
    const fakeMod = new Module(baileysMain, module);
    fakeMod.filename = baileysMain;
    fakeMod.loaded = true;
    fakeMod.exports = cjsExports;
    require.cache[baileysMain] = fakeMod;

    // 5. Also cache the generics sub-path used by index.js
    //    require('@whiskeysockets/baileys/lib/Utils/generics')
    const genericsPath = path.join(baileysDir, 'lib', 'Utils', 'generics');
    const genericsDotJs = genericsPath + '.js';
    const genericsExports = { PHONENUMBER_MCC: baileys.PHONENUMBER_MCC || {} };
    
    for (const gp of [genericsPath, genericsDotJs]) {
        const fakeGenMod = new Module(gp, module);
        fakeGenMod.filename = gp;
        fakeGenMod.loaded = true;
        fakeGenMod.exports = genericsExports;
        require.cache[gp] = fakeGenMod;
    }

    // 6. Monkey-patch Module._resolveFilename to intercept baileys require calls
    //    This ensures require('@whiskeysockets/baileys') resolves to our cached path
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function(request, parent, isMain, options) {
        if (request === '@whiskeysockets/baileys') {
            return baileysMain;
        }
        if (request === '@whiskeysockets/baileys/lib/Utils/generics') {
            return genericsDotJs;
        }
        return origResolve.call(this, request, parent, isMain, options);
    };

    console.log('[preload] Baileys module cached successfully. Starting bot...');

    // 7. Boot the real entry point
    require('./index.js');
}

boot().catch(err => {
    console.error('[preload] Fatal boot error:', err);
    process.exit(1);
});
