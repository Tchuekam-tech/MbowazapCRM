const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { isBanned } = require('../lib/isBanned');
const { loadUserGroupData } = require('../lib/index');
const { startHealthCheckServer } = require('../lib/healthCheck');

test('isBanned initializes missing file safely and detects banned ids', (t) => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-banned-'));
    t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

    const nestedFile = path.join(tmpRoot, 'nested', 'banned.json');
    assert.equal(isBanned('12345@s.whatsapp.net', nestedFile), false);
    assert.equal(fs.existsSync(nestedFile), true);

    fs.writeFileSync(nestedFile, JSON.stringify(['12345@s.whatsapp.net']), 'utf8');
    assert.equal(isBanned('12345@s.whatsapp.net', nestedFile), true);
    assert.equal(isBanned('99999@s.whatsapp.net', nestedFile), false);
});

test('loadUserGroupData creates nested directories and default schema when missing', (t) => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-ugdata-'));
    t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

    const dataFile = path.join(tmpRoot, 'sub', 'userGroupData.json');
    const data = loadUserGroupData(dataFile);
    assert.equal(fs.existsSync(dataFile), true);
    assert.deepEqual(data.sudo, []);
    assert.equal(typeof data.antilink, 'object');
});

test('startHealthCheckServer binds dual-stack or IPv4 fallback and serves /health 200', async (t) => {
    const server = startHealthCheckServer(0);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    await new Promise((resolve) => {
        if (server.listening) resolve();
        else server.once('listening', resolve);
    });

    const address = server.address();
    assert.ok(address && typeof address === 'object' && address.port > 0);
    const host = address.family === 'IPv6' ? '127.0.0.1' : address.address;

    const { statusCode, body } = await new Promise((resolve, reject) => {
        http.get(`http://${host}:${address.port}/health`, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
                });
            });
        }).on('error', reject);
    });

    assert.equal(statusCode, 200);
    assert.equal(body.status, 'healthy');
});
