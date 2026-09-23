'use strict';
/**
 * Start-up against real files on disk (the other suites use an in-memory database).
 *
 * 1.6.5 found on a real computer: a threat-list cache damaged without a cut-off refresh behind it passed the open
 * and attach steps, then failed in seed.js with "database disk image is malformed" on every start, so the scanner
 * never came up. The cache is only a cache: the server must throw it away and start.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const SERVER = path.join(__dirname, '..', 'server', 'index.js');

/** Start the server on `dbPath`; resolve with its output once it listens, reject if it exits first. */
function startServer(dbPath) {
  const port = 48000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, NODE_ENV: 'development', DB_PATH: dbPath, PORT: String(port), FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', SESSION_SECRET: 'startup-test-secret-000000000000000000' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no answer in 60 s:\n${out}`)); }, 60000);
    const onData = (d) => {
      out += d;
      if (/listening on|site\s+http/.test(out)) { clearTimeout(timer); resolve({ child, out }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}) before listening:\n${out}`)); });
  });
}

function stop(child) {
  return new Promise((resolve) => { child.removeAllListeners('exit'); child.once('exit', resolve); child.kill(); });
}

test('a damaged threat-list cache is thrown away at start instead of stopping the server for good', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-startup-'));
  const dbPath = path.join(dir, 'sentinel.db');
  const feedsPath = path.join(dir, 'sentinel-feeds.db');
  try {
    // A normal first start creates both files and seeds the comparison index.
    const first = await startServer(dbPath);
    await stop(first.child);

    // Damage only the pages that hold scam_tokens: the file still opens and attaches, as on the computer where it was found.
    const d = new DatabaseSync(feedsPath);
    d.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
    // The table and its index: COUNT(*) reads whichever is smaller.
    const roots = d.prepare("SELECT rootpage FROM sqlite_master WHERE tbl_name = 'scam_tokens' AND rootpage > 0").all().map((r) => r.rootpage);
    const pageSize = d.prepare('PRAGMA page_size').get().page_size;
    d.close();
    for (const suffix of ['-wal', '-shm']) { try { fs.unlinkSync(feedsPath + suffix); } catch { /* none */ } }
    const fd = fs.openSync(feedsPath, 'r+');
    for (const page of roots) fs.writeSync(fd, Buffer.alloc(pageSize, 0xa5), 0, pageSize, (page - 1) * pageSize);
    fs.closeSync(fd);

    const second = await startServer(dbPath);
    await stop(second.child);
    assert.match(second.out, /threat-list cache was damaged/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
