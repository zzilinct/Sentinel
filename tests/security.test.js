'use strict';
process.env.NODE_ENV = 'test';
// Note: RESEARCH_ALLOW_PRIVATE is deliberately NOT set - SSRF protection is live here.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { client, startApp } = require('./fixtures');

let app;
test.before(async () => { app = await startApp(); });
test.after(() => app.server.close());

async function signedIn(plan = 'free') {
  const c = client(app.base);
  const email = `sec_${Math.random().toString(36).slice(2)}@example.com`;
  const r = await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'Sec', ageConfirmed: true, termsAccepted: true });
  assert.equal(r.status, 201);
  assert.equal((await c.post('/api/v1/auth/login', { email, password: 'Correct-Horse-42' })).status, 200);
  if (plan !== 'free') await c.post('/api/v1/billing/plan', { plan });
  c.email = email;
  return c;
}

/* -------------------------------------------------------------- headers */

test('security headers are sent on pages and API responses', async () => {
  for (const path of ['/', '/api/v1/plans']) {
    const r = await fetch(app.base + path);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(r.headers.get('x-powered-by'), null);
  }
});

/* ----------------------------------------------------------------- CSRF */

test('state-changing requests from other sites are refused', async () => {
  const c = await signedIn();
  const evil = await c.raw('POST', '/api/v1/report', { body: { url: 'https://example.com' }, origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal(evil.data.error.code, 'bad_origin');

  const noOrigin = await c.raw('POST', '/api/v1/sites/override', { body: { url: 'https://example.com', action: 'allow' }, origin: null });
  assert.equal(noOrigin.status, 403);

  const formPost = await c.raw('POST', '/api/v1/sites/override', {
    raw: 'url=https://example.com&action=allow',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(formPost.status, 415);
});

test('CORS only opens up to the extension, never to arbitrary sites', async () => {
  const evil = await fetch(`${app.base}/api/v1/auth/me`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const ext = await fetch(`${app.base}/api/v1/auth/me`, { headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
  assert.equal(ext.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');
});

/* ------------------------------------------------------------ static files */

test('path traversal and dotfiles are blocked', async () => {
  for (const path of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/server/config.js', '/assets/..%5c..%5c..%5cpackage.json', '/.env', '/%2eenv']) {
    const body = await rawGet(path);
    assert.ok(![200].includes(body.status) || !/"private": true|SESSION_SECRET|require\(/.test(body.text), `${path} leaked (${body.status})`);
  }
});

function rawGet(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(app.base);
    http.get({ host: u.hostname, port: u.port, path }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject);
  });
}

/* ----------------------------------------------------------- brute force */

test('accounts lock after repeated wrong passwords', async () => {
  const c = await signedIn();
  await c.post('/api/v1/auth/logout', {});
  let last;
  for (let i = 0; i < 9; i++) last = await client(app.base).post('/api/v1/auth/login', { email: c.email, password: `wrong-guess-${i}` });
  assert.equal(last.status, 423);
  const right = await client(app.base).post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' });
  assert.equal(right.status, 423, 'even the right password is refused while locked');
});

/* --------------------------------------------------------------- 2FA */

test('two-factor authentication: setup, login challenge, replay protection', async () => {
  const security = require('../server/lib/security');
  const c = await signedIn();

  const setup = await c.post('/api/v1/account/2fa/setup', {});
  assert.equal(setup.status, 200);
  assert.match(setup.data.uri, /^otpauth:\/\/totp\//);
  const secret = security.base32Decode(setup.data.secret);
  const codeAt = (t) => security.hotp(secret, Math.floor(t / 30000));

  assert.equal((await c.post('/api/v1/account/2fa/enable', { code: '000000' })).status, 400);
  const enable = await c.post('/api/v1/account/2fa/enable', { code: codeAt(Date.now() - 30000) });
  assert.equal(enable.status, 200, JSON.stringify(enable.data));
  assert.equal(enable.data.user.twoFactorEnabled, true);

  const fresh = client(app.base);
  const step1 = await fresh.post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' });
  assert.equal(step1.data.twoFactorRequired, true);
  assert.equal((await fresh.get('/api/v1/auth/me')).status, 401, 'password alone does not sign you in');

  assert.equal((await fresh.post('/api/v1/auth/login/2fa', { challenge: step1.data.challenge, code: '123456' })).status, 401);
  const step2 = await fresh.post('/api/v1/auth/login/2fa', { challenge: step1.data.challenge, code: codeAt(Date.now()) });
  assert.equal(step2.status, 200, JSON.stringify(step2.data));
  assert.equal((await fresh.get('/api/v1/auth/me')).status, 200);

  // The same code cannot be used twice.
  const other = client(app.base);
  const again = await other.post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' });
  const replay = await other.post('/api/v1/auth/login/2fa', { challenge: again.data.challenge, code: codeAt(Date.now()) });
  assert.equal(replay.status, 401);
});

/* ----------------------------------------------------------------- SSRF */

test('research refuses private, loopback and metadata addresses', async () => {
  const { safeFetch, isPublicAddress } = require('../server/lib/scan/netguard');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('93.184.216.34'), true);

  for (const url of ['http://127.0.0.1:80/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://localhost/', 'http://example.com:8080/', 'file:///etc/passwd', 'http://user:pass@example.com/']) {
    await assert.rejects(safeFetch(url), (err) => err.code === 'blocked_destination' || /private|reserved|port|http/i.test(err.message), url);
  }
});

test('a Pro scan of an internal address never reaches it', async () => {
  let hit = false;
  const internal = http.createServer((req, res) => { hit = true; res.end('secret'); });
  await new Promise((r) => internal.listen(0, '127.0.0.1', r));
  const c = await signedIn('pro');
  const r = await c.post('/api/v1/scan/link', { url: `http://127.0.0.1:${internal.address().port}/admin` });
  internal.close();
  assert.equal(r.status, 200);
  assert.equal(hit, false, 'the internal server must not be contacted');
});

/* --------------------------------------------------------- misc hardening */

test('prototype keys and oversized input are handled safely', async () => {
  const c = await signedIn();
  const proto = await c.post('/api/v1/ai/connect', { provider: '__proto__', apiKey: 'sk-x' });
  assert.equal(proto.status, 404);
  const ctor = await c.post('/api/v1/ai/connect', { provider: 'constructor', apiKey: 'sk-x' });
  assert.equal(ctor.status, 404);

  const huge = await c.raw('POST', '/api/v1/scan/link', { raw: JSON.stringify({ url: 'x'.repeat(600000) }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(huge.status, 413);

  const notJson = await c.raw('POST', '/api/v1/scan/link', { raw: '{nope', headers: { 'Content-Type': 'application/json' } });
  assert.equal(notJson.status, 400);
});

test('client tokens are only issued to a browser session, not to another token', async () => {
  const c = await signedIn();
  const tok = await c.post('/api/v1/auth/client-token', { client: 'extension' });
  assert.equal(tok.status, 200);
  const chained = await fetch(`${app.base}/api/v1/auth/client-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok.data.token}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(chained.status, 403);
  const me = await fetch(`${app.base}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${tok.data.token}` } });
  assert.equal(me.status, 200);
});

test('password change signs out every other session', async () => {
  const c = await signedIn();
  const tok = (await c.post('/api/v1/auth/client-token', { client: 'desktop' })).data.token;
  const change = await c.post('/api/v1/account/password', { currentPassword: 'Correct-Horse-42', newPassword: 'Another-Strong-Pass-77' });
  assert.equal(change.status, 200, JSON.stringify(change.data));
  const old = await fetch(`${app.base}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${tok}` } });
  assert.equal(old.status, 401);
  assert.equal((await c.get('/api/v1/auth/me')).status, 200, 'the session that changed the password stays signed in');
});
