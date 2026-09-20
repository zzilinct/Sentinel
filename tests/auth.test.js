'use strict';
/**
 * Accounts and sessions: that an account, once created, is really there; that
 * signing in is its own step; that "stay signed in" means 30 days of NOT using
 * Sentinel, measured from the last use; and that the database looks after
 * itself after damage.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { client, startApp, DAY } = require('./fixtures');

const ROOT = path.join(__dirname, '..');
const PASSWORD = 'Correct-Horse-42';
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef0123456789';

let app;
let db;
test.before(async () => { app = await startApp(); ({ db } = require('../server/lib/db')); });
test.after(() => app.server.close());

let n = 0;
const freshEmail = () => `auth${++n}_${Date.now()}@example.com`;
const signup = (c, email, extra = {}) => c.post('/api/v1/auth/signup', { email, password: PASSWORD, firstName: 'Ada', ageConfirmed: true, termsAccepted: true, ...extra });
const login = (c, email, extra = {}) => c.post('/api/v1/auth/login', { email, password: PASSWORD, ...extra });
const sessionRow = (c) => db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(require('../server/lib/auth').sha256(decodeURIComponent(c.cookie.split('=')[1])));

/* ------------------------------------------------------------ (a) sign-up */

test('(a) sign-up writes a durable account row, signs nobody in, and points at sign-in', async () => {
  const c = client(app.base);
  const email = freshEmail();
  const r = await signup(c, email);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.next, '/login', 'the next step is the sign-in page');
  assert.equal(r.headers.get('set-cookie'), null, 'creating an account sets no session cookie');
  assert.equal((await c.get('/api/v1/auth/me')).status, 401, 'and nobody is signed in');

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  assert.ok(row, 'the account is in the database');
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(row.age_confirmed_at && row.terms_accepted_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(row.id).n, 0);

  // ...and it stays: nothing the server does on its own removes it.
  require('../server/lib/db').sweep();
  require('../server/seed').run({ quiet: true });
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(row.id), 'still there after the hourly sweep and a re-seed');

  const signedIn = await login(c, email);
  assert.equal(signedIn.status, 200);
  assert.equal((await c.get('/api/v1/auth/me')).data.user.email, email);
});

/* --------------------------------------------- (b) survives a real restart */

function startServerProcess(dbPath, port) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'development', DB_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, SESSION_SECRET: SECRET, FEED_REFRESH_HOURS: '0', BILLING_MODE: 'demo' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  const ready = (async () => {
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(`server exited early:\n${out}`);
      try { if ((await fetch(`${base}/api/v1/auth/config`, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`server did not come up:\n${out}`);
  })();
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) return resolve();
    const t = setTimeout(resolve, 5000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
    child.kill();
  });
  return { child, base, ready, stop, output: () => out };
}

const freePort = () => new Promise((resolve) => { const s = require('net').createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test('(b) an account and a kept session survive the server process being killed and started again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-auth-'));
  const dbPath = path.join(dir, 'sentinel.db');
  const email = freshEmail();
  let first;
  let second;
  try {
    first = startServerProcess(dbPath, await freePort());
    await first.ready;
    const c = client(first.base);
    assert.equal((await signup(c, email)).status, 201);
    assert.equal((await login(c, email, { staySignedIn: true })).status, 200);
    const cookie = c.cookie;

    // A second server must not be allowed near the same database while the first holds it.
    const intruder = startServerProcess(dbPath, await freePort());
    await assert.rejects(intruder.ready, /already using/);
    await intruder.stop();

    await first.stop();   // killed, not shut down politely

    second = startServerProcess(dbPath, await freePort());
    await second.ready;
    const again = client(second.base);
    const r = await login(again, email);
    assert.equal(r.status, 200, `sign-in works after a restart: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.user.email, email);

    // The "stay signed in" session from before the restart is still good too.
    const kept = client(second.base);
    kept.cookie = cookie;
    assert.equal((await kept.get('/api/v1/auth/me')).status, 200);

    assert.ok(fs.existsSync(`${dbPath}.backup`), 'a verified backup of the accounts file exists');
    assert.ok(fs.existsSync(path.join(dir, 'sentinel-feeds.db')), 'threat lists live in their own file');
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------- (c) (d) stay signed in */

test('(c) "stay signed in" sets a 30-day cookie and the 30 days slide forward with use', async () => {
  const c = client(app.base);
  const email = freshEmail();
  await signup(c, email);
  const r = await login(c, email, { staySignedIn: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.staySignedIn, true);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /Max-Age=2592000\b/, '30 days');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  let row = sessionRow(c);
  assert.equal(row.persistent, 1);
  assert.equal(row.idle_ms, 30 * DAY);
  assert.ok(Math.abs(row.expires_at - (Date.now() + 30 * DAY)) < 60_000);

  // Twenty days later, still in use: the window moves, it does not run out on day 30.
  const twentyDaysAgo = Date.now() - 20 * DAY;
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(twentyDaysAgo, twentyDaysAgo + 30 * DAY, row.token_hash);
  const me = await c.get('/api/v1/auth/me');
  assert.equal(me.status, 200);
  assert.match(me.headers.get('set-cookie') || '', /Max-Age=2592000\b/, 'the browser-side cookie is renewed as well');
  row = sessionRow(c);
  assert.ok(Date.now() - row.last_seen_at < 60_000, 'last_seen was refreshed');
  assert.ok(Math.abs(row.expires_at - (Date.now() + 30 * DAY)) < 60_000, 'and the 30 days now count from today');
});

test('(d) without "stay signed in" the cookie is a session cookie with a 12-hour idle limit', async () => {
  for (const body of [{}, { staySignedIn: false }, { staySignedIn: 'on' }, { staySignedIn: 1 }]) {
    const c = client(app.base);
    const email = freshEmail();
    await signup(c, email);
    const r = await login(c, email, body);
    assert.equal(r.status, 200);
    assert.equal(r.data.staySignedIn, false, `only an explicit true keeps you signed in (${JSON.stringify(body)})`);
    const cookie = r.headers.get('set-cookie');
    assert.doesNotMatch(cookie, /Max-Age|Expires/i, 'no lifetime: the browser drops it when it closes');
    const row = sessionRow(c);
    assert.equal(row.persistent, 0);
    assert.equal(row.idle_ms, 12 * 60 * 60 * 1000);
    assert.doesNotMatch((await c.get('/api/v1/auth/me')).headers.get('set-cookie') || '', /Max-Age/, 'and it is never upgraded to a persistent one');
  }
});

/* --------------------------------------------------------- (e) inactivity */

test('(e) more than 30 days without using Sentinel ends the session', async () => {
  const c = client(app.base);
  const email = freshEmail();
  await signup(c, email);
  await login(c, email, { staySignedIn: true });
  const row = sessionRow(c);

  const last = Date.now() - 30 * DAY - 60_000;                       // 30 days and a minute ago
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(last, last + 30 * DAY, row.token_hash);
  assert.equal((await c.get('/api/v1/auth/me')).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(row.token_hash).n, 0, 'the row is gone, checked lazily on use');

  // The hourly sweep clears idle sessions nobody comes back to.
  const c2 = client(app.base);
  await login(c2, email, { staySignedIn: true });
  const row2 = sessionRow(c2);
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(last, last + 30 * DAY, row2.token_hash);
  require('../server/lib/db').sweep();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(row2.token_hash).n, 0);

  // 29 days is still fine.
  const c3 = client(app.base);
  await login(c3, email, { staySignedIn: true });
  const row3 = sessionRow(c3);
  const recent = Date.now() - 29 * DAY;
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(recent, recent + 30 * DAY, row3.token_hash);
  assert.equal((await c3.get('/api/v1/auth/me')).status, 200);
  // The account itself is untouched by any of this.
  assert.ok(db.prepare('SELECT 1 FROM users WHERE email = ?').get(email));
});

/* ------------------------------------------------------- (f) one email */

test('(f) an email registers once: the second attempt is refused clearly and the first account is untouched', async () => {
  const email = freshEmail();
  const first = await signup(client(app.base), email);
  assert.equal(first.status, 201);
  const id = first.data.user.id;

  for (const variant of [email, email.toUpperCase(), `  ${email}  `]) {
    const again = await signup(client(app.base), variant, { firstName: 'Someone Else' });
    assert.equal(again.status, 409, variant);
    assert.equal(again.data.error.code, 'email_taken');
    assert.match(again.data.error.message, /already/i);
  }
  const rows = db.prepare('SELECT id, first_name FROM users WHERE email = ?').all(email);
  assert.deepEqual(rows.map((r) => r.id), [id], 'exactly one account, the original');
  assert.equal(rows[0].first_name, 'Ada', 'and nothing about it changed');
  assert.equal((await login(client(app.base), email)).status, 200, 'the original still signs in');
});

/* ------------------------------------------------------- sessions list */

test('every session is listed, and signing one out leaves the others alone', async () => {
  const email = freshEmail();
  await signup(client(app.base), email);
  const laptop = client(app.base);
  const phone = client(app.base);
  const tablet = client(app.base);
  await login(laptop, email, { staySignedIn: true });
  await login(phone, email, { staySignedIn: true });
  await login(tablet, email, { staySignedIn: false });
  const token = await laptop.post('/api/v1/auth/client-token', { client: 'desktop' });
  assert.equal(token.status, 200);

  const list = (await laptop.get('/api/v1/account/sessions')).data.sessions;
  assert.equal(list.length, 4, 'three browsers and the paired app');
  assert.equal(list.filter((s) => s.current).length, 1);
  assert.deepEqual(list.map((s) => s.kind).sort(), ['desktop', 'web', 'web', 'web']);
  assert.equal(list.filter((s) => s.kind === 'web' && !s.staySignedIn).length, 1);

  const phoneId = require('../server/lib/auth').sha256(decodeURIComponent(phone.cookie.split('=')[1]));
  const out = await laptop.post('/api/v1/account/sessions/revoke', { id: phoneId });
  assert.equal(out.status, 200, JSON.stringify(out.data));
  assert.equal((await phone.get('/api/v1/auth/me')).status, 401, 'that one is signed out');
  assert.equal((await laptop.get('/api/v1/auth/me')).status, 200, 'the one doing it is not');
  assert.equal((await tablet.get('/api/v1/auth/me')).status, 200, 'nor is the third');
  assert.equal((await client(app.base).get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token.data.token}` } })).status, 200, 'nor the paired app');
  assert.equal((await laptop.get('/api/v1/account/sessions')).data.sessions.length, 3);

  // Someone else's session handle does nothing.
  const stranger = client(app.base);
  const strangerEmail = freshEmail();
  await signup(stranger, strangerEmail);
  await login(stranger, strangerEmail);
  const tabletId = require('../server/lib/auth').sha256(decodeURIComponent(tablet.cookie.split('=')[1]));
  assert.equal((await stranger.post('/api/v1/account/sessions/revoke', { id: tabletId })).status, 404);
  assert.equal((await tablet.get('/api/v1/auth/me')).status, 200);
  assert.equal((await stranger.post('/api/v1/account/sessions/revoke', { id: 'nope' })).status, 400);
});

/* ------------------------------------------------ the device account */

test('the desktop device account is off by default and can never touch a person\'s account', async () => {
  const config = require('../server/config');
  const c = client(app.base);
  assert.equal((await c.post('/api/v1/auth/device', {})).status, 404, 'a hosted server does not offer it');

  const email = freshEmail();
  await signup(client(app.base), email);
  const before = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  config.deviceAccounts = true;
  try {
    const a = await c.post('/api/v1/auth/device', {});
    const b = await c.post('/api/v1/auth/device', {});
    assert.equal(a.status, 200);
    assert.equal(a.data.user.email, 'this-computer@sentinel.local');
    assert.equal(a.data.user.id, b.data.user.id, 'always the same one account');
    assert.equal(a.headers.get('set-cookie'), null, 'it hands back a token for background services, never a browser session');
    assert.deepEqual(db.prepare('SELECT * FROM users WHERE email = ?').get(email), before, 'the person\'s account is byte-for-byte unchanged');
    assert.equal((await login(client(app.base), email)).status, 200);
    // It has no password, so nobody can sign in as it.
    assert.equal((await client(app.base).post('/api/v1/auth/login', { email: 'this-computer@sentinel.local', password: PASSWORD })).status, 401);
  } finally {
    config.deviceAccounts = false;
  }
});

/* ------------------------------------------------- the file looks after itself */

function runWithDb(dbPath, script) {
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'development', DB_PATH: dbPath, SESSION_SECRET: SECRET, FEED_REFRESH_HOURS: '0' },
    encoding: 'utf8'
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('damage is repaired on start: orphaned rows go, a ruined file is replaced from the verified backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-db-'));
  const dbPath = path.join(dir, 'sentinel.db');
  try {
    // A healthy database with one account, and a verified backup of it.
    runWithDb(dbPath, `
      const { db, backupAccounts } = require('./server/lib/db');
      db.prepare("INSERT INTO users (id, email, first_name, created_at) VALUES ('usr_keep', 'keep@example.com', 'Keep', 1)").run();
      if (!backupAccounts()) process.exit(2);
    `);

    // Past damage left a session that belongs to nobody.
    runWithDb(dbPath, `
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(process.env.DB_PATH);
      d.exec('PRAGMA foreign_keys = OFF');
      d.prepare("INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES ('orphan', 'usr_gone', 'web', 1, 9999999999999)").run();
      d.close();
    `);
    const out = runWithDb(dbPath, `
      const { db } = require('./server/lib/db');
      console.log(JSON.stringify({ orphans: db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'usr_gone'").get().n, users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n }));
    `);
    assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), { orphans: 0, users: 1 });

    // Now the file itself is ruined.
    for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
    fs.writeFileSync(dbPath, Buffer.alloc(8192, 0x5a));
    const restored = runWithDb(dbPath, `
      const { db } = require('./server/lib/db');
      console.log(JSON.stringify(db.prepare('SELECT id, email FROM users').all()));
    `);
    assert.deepEqual(JSON.parse(restored.trim().split('\n').pop()), [{ id: 'usr_keep', email: 'keep@example.com' }], 'the account came back from the backup');
    assert.ok(fs.readdirSync(dir).some((f) => f.includes('.damaged-')), 'the damaged file was kept aside, not deleted');

    // A ruined threat-list cache is simply thrown away; accounts are not involved.
    for (const suffix of ['-wal', '-shm']) fs.rmSync(path.join(dir, `sentinel-feeds.db${suffix}`), { force: true });
    fs.writeFileSync(path.join(dir, 'sentinel-feeds.db'), Buffer.alloc(8192, 0x5a));
    const after = runWithDb(dbPath, `
      const { db } = require('./server/lib/db');
      console.log(JSON.stringify({ users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n, feeds: db.prepare('SELECT COUNT(*) AS n FROM feeds.feed_hosts').get().n }));
    `);
    assert.deepEqual(JSON.parse(after.trim().split('\n').pop()), { users: 1, feeds: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an accounts file left bloated by a killed server is shrunk on the next start, with its accounts intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-db-'));
  const dbPath = path.join(dir, 'sentinel.db');
  try {
    // An account, then 40 MB of rows that are dropped and vacuumed away. The process
    // is killed rather than closed, so the smaller file only exists in the log.
    runWithDb(dbPath, `
      const { db } = require('./server/lib/db');
      db.prepare("INSERT INTO users (id, email, first_name, created_at) VALUES ('usr_keep', 'keep@example.com', 'Keep', 1)").run();
      db.exec('CREATE TABLE ballast (x BLOB)');
      const put = db.prepare('INSERT INTO ballast VALUES (zeroblob(1048576))');
      db.exec('BEGIN'); for (let i = 0; i < 40; i++) put.run(); db.exec('COMMIT');
      db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
      db.exec('DROP TABLE ballast');
      db.exec('VACUUM');
      process.reallyExit(0);
    `);
    assert.ok(fs.statSync(dbPath).size > 36 * 1024 * 1024, 'the setup must leave the file bloated, or this test proves nothing');

    const out = runWithDb(dbPath, `
      const { db } = require('./server/lib/db');
      console.log(JSON.stringify({ size: require('fs').statSync(process.env.DB_PATH).size, users: db.prepare('SELECT email FROM users').all().map((u) => u.email), check: db.prepare('PRAGMA quick_check').get().quick_check }));
    `);
    const lines = out.trim().split('\n');
    const result = JSON.parse(lines.pop());
    assert.ok(result.size < 4 * 1024 * 1024, `the file is still ${result.size} bytes`);
    assert.deepEqual(result.users, ['keep@example.com']);
    assert.equal(result.check, 'ok');
    assert.match(lines.join('\n'), /reclaimed \d+ MB/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* --------------------------------------------------- one server per database */

test('a claim on the database is judged, not just found: a reused process number or an earlier boot never blocks a start', () => {
  const lock = require('../server/lib/dblock');
  const boot = 1_000_000_000_000;
  const probe = (over = {}) => ({ alive: () => true, startedAt: () => boot + 60_000, bootTime: () => boot, ...over });

  // The claimant itself: alive, and started when the claim says it did.
  assert.equal(lock.held({ pid: 4242, started: boot + 61_000, boot }, probe()), true);
  // The same number now belongs to a program that started at another time (Windows hands numbers out again).
  assert.equal(lock.held({ pid: 4242, started: boot + 3_600_000, boot }, probe()), false);
  // Written before the computer was last restarted: whoever has that number now is not the claimant.
  assert.equal(lock.held({ pid: 264, started: boot - 86_400_000, boot: boot - 86_400_000 }, probe()), false);
  // The process is gone.
  assert.equal(lock.held({ pid: 4242, started: boot + 61_000, boot }, probe({ alive: () => false })), false);
  // When the system cannot say, believe the claim: refusing to start is recoverable, two writers are not.
  assert.equal(lock.held({ pid: 4242, started: boot + 61_000, boot }, probe({ startedAt: () => null })), true);
  // Our own number is never somebody else.
  assert.equal(lock.held({ pid: process.pid, started: 1, boot }, probe()), false);
});

test('a server starts over a stale claim whose process number belongs to something else now', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-lock-'));
  const dbPath = path.join(dir, 'sentinel.db');
  try {
    // This test runner is alive and is not a Sentinel server that started an hour from now.
    fs.writeFileSync(`${dbPath}.lock`, JSON.stringify({ pid: process.pid, started: Date.now() + 3_600_000, boot: Math.round(Date.now() - os.uptime() * 1000) }));
    const server = startServerProcess(dbPath, await freePort());
    await server.ready;
    const claim = JSON.parse(fs.readFileSync(`${dbPath}.lock`, 'utf8'));
    assert.notEqual(claim.pid, process.pid, 'the new server took the claim over');
    assert.ok(claim.started && claim.boot, 'and recorded when it and the computer started');
    await server.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
