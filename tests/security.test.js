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
  // Never with the sign-in cookie: any extension has an extension origin.
  assert.equal(ext.headers.get('access-control-allow-credentials'), null);
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

  // A session alone cannot turn it on (it signs every other device out): the password is asked for too.
  assert.equal((await c.post('/api/v1/account/2fa/enable', { code: codeAt(Date.now()) })).status, 401);
  assert.equal((await c.post('/api/v1/account/2fa/enable', { code: codeAt(Date.now()), password: 'wrong-password' })).status, 401);
  assert.equal((await c.post('/api/v1/account/2fa/enable', { code: '000000', password: 'Correct-Horse-42' })).status, 400);
  const enable = await c.post('/api/v1/account/2fa/enable', { code: codeAt(Date.now() - 30000), password: 'Correct-Horse-42' });
  assert.equal(enable.status, 200, JSON.stringify(enable.data));
  assert.equal(enable.data.user.twoFactorEnabled, true);

  const fresh = client(app.base);
  const step1 = await fresh.post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' });
  assert.equal(step1.data.twoFactorRequired, true);
  assert.equal((await fresh.get('/api/v1/auth/me')).status, 401, 'password alone does not sign you in');

  assert.equal((await fresh.post('/api/v1/auth/login/2fa', { challenge: step1.data.challenge, code: '123456' })).status, 401);
  // One code, kept: asked for twice, a 30-second step can turn between the two and the second is a new, valid code.
  const used = codeAt(Date.now());
  const step2 = await fresh.post('/api/v1/auth/login/2fa', { challenge: step1.data.challenge, code: used });
  assert.equal(step2.status, 200, JSON.stringify(step2.data));
  assert.equal((await fresh.get('/api/v1/auth/me')).status, 200);

  // The same code cannot be used twice.
  const other = client(app.base);
  const again = await other.post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' });
  const replay = await other.post('/api/v1/auth/login/2fa', { challenge: again.data.challenge, code: used });
  assert.equal(replay.status, 401);
});

test('two-factor codes: wrong ones lock the account however many fresh challenges are asked for', async () => {
  const security = require('../server/lib/security');
  const c = await signedIn();
  const setup = await c.post('/api/v1/account/2fa/setup', {});
  const secret = security.base32Decode(setup.data.secret);
  const codeAt = (t) => security.hotp(secret, Math.floor(t / 30000));
  assert.equal((await c.post('/api/v1/account/2fa/enable', { code: codeAt(Date.now()), password: 'Correct-Horse-42' })).status, 200);
  const right = codeAt(Date.now());
  const wrong = right === '000000' ? '111111' : '000000';

  const guesser = client(app.base);
  let tries = 0;
  for (let round = 0; round < 2; round++) {
    const step1 = await guesser.post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' });
    assert.equal(step1.data.twoFactorRequired, true, `round ${round}: ${JSON.stringify(step1.data)}`);
    for (let i = 0; i < 4 && tries < 8; i++, tries++) {
      assert.equal((await guesser.post('/api/v1/auth/login/2fa', { challenge: step1.data.challenge, code: wrong })).status, 401);
    }
  }
  const after = await guesser.post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' });
  assert.equal(after.status, 423, 'eight wrong codes lock the account, as eight wrong passwords do');
});

/* ----------------------------------------------------------------- SSRF */

test('research refuses private, loopback and metadata addresses', async () => {
  const { safeFetch, isPublicAddress } = require('../server/lib/scan/netguard');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1',
    '::ffff:7f00:1', '0:0:0:0:0:ffff:a00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:0:0:1', '0:0:0:0:0:0:0:0', '::127.0.0.1', '2002:7f00:1::', '2001:0:4136:e378:8000:63bf:3fff:fdd2']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('93.184.216.34'), true);
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:5db8:d822']) assert.equal(isPublicAddress(ip), true, ip);

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
  // An extension asking with the cookie could be any extension: it pairs through the connect page instead.
  const fromExtension = await c.raw('POST', '/api/v1/auth/client-token', { raw: '{}', headers: { 'Content-Type': 'application/json' }, origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' });
  assert.equal(fromExtension.status, 403);
  const me = await fetch(`${app.base}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${tok.data.token}` } });
  assert.equal(me.status, 200);
});

test('a stolen session cannot mint a token that counts as a recent sign-in', async () => {
  const { db } = require('../server/lib/auth');
  const c = await signedIn();
  db.prepare('UPDATE users SET password_hash = NULL WHERE email = ?').run(c.email);   // a Google-only account
  const { token } = (await c.post('/api/v1/auth/client-token', { client: 'desktop' })).data;
  const bearer = (path, body) => fetch(`${app.base}/api/v1/account/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  for (const [path, body] of [['password', { newPassword: 'Another-Strong-Pass-77' }], ['delete', { confirm: 'DELETE' }]]) {
    const r = await bearer(path, body);
    assert.equal(r.status, 401, path);
    assert.equal((await r.json()).error.code, 'reauth_required');
  }
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE email = ?').get(c.email).password_hash, null);
  // The real sign-in itself still counts.
  assert.equal((await c.post('/api/v1/account/password', { newPassword: 'Another-Strong-Pass-77' })).status, 200);
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

test('the lock resets the count: after it runs out, one more typo does not lock the account again', async () => {
  const { db } = require('../server/lib/auth');
  const c = await signedIn();
  await c.post('/api/v1/auth/logout', {});
  for (let i = 0; i < 9; i++) await client(app.base).post('/api/v1/auth/login', { email: c.email, password: `wrong-${i}` });
  db.prepare('UPDATE users SET locked_until = 0 WHERE email = ?').run(c.email);   // the fifteen minutes pass
  const typo = await client(app.base).post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-41' });
  assert.equal(typo.status, 401, 'a single wrong try after the lock is a plain "incorrect", not another lock');
});

test('sign-in only returns to a path on this site: tab, newline and backslash tricks go to /app', () => {
  const { safeNext } = require('../server/lib/auth');
  assert.equal(safeNext('/app/scan?url=x#y'), '/app/scan?url=x#y');
  for (const bad of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/\r//evil.com', 'https://evil.com', 'evil.com', '', null]) {
    assert.equal(safeNext(bad), '/app', JSON.stringify(bad));
  }
});

test('a typed host with a port is a web address, not a scheme', () => {
  const { typedUrl } = require('../server/lib/scan/url');
  assert.equal(typedUrl('example.com:8443/login'), 'https://example.com:8443/login');
  assert.equal(typedUrl('localhost:3000'), 'https://localhost:3000');
  assert.equal(typedUrl('mailto:a@b.co'), 'mailto:a@b.co');
});

test('a page that points its own name at this computer (DNS rebinding) gets no answer', async () => {
  const http = require('http');
  const u = new URL(app.base);
  const get = (host) => new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: '/api/v1/auth/config', headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(await get(`attacker.example:${u.port}`), 421);
  assert.equal(await get('127.0.0.1'), 421, 'the port is part of the name');
  assert.equal(await get(`127.0.0.1:${u.port}`), 200);
  assert.equal(await get(`localhost:${u.port}`), 200);
});

test('a page built to be slow to read is read as quickly as any other (no regex backtracking)', () => {
  const { parse } = require('../server/lib/scan/content');
  const K = 600 * 1024;
  for (const html of ['<a ' + 'href=x'.repeat(K / 6), '<img src="x'.repeat(K / 11), '<'.repeat(K), '<form'.repeat(K / 5), '<meta '.repeat(K / 6), '<title>'.repeat(K / 7), '<' + 'a'.repeat(K)]) {
    const t = Date.now();
    parse(html, 'https://page.example/');
    assert.ok(Date.now() - t < 1500, `${html.slice(0, 12)}... took ${Date.now() - t} ms`);
  }
  const b64 = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{2000}/;
  const t = Date.now();
  assert.equal(b64.test(('A'.repeat(1999) + '!').repeat(2500)), false);
  assert.ok(Date.now() - t < 1500);
  const page = parse('<title>Sign in</title><form action="https://evil.example/p"><input type=password name=pw></form><a href="/help">Help</a>', 'https://page.example/');
  assert.equal(page.title, 'Sign in');
  assert.equal(page.forms[0].external, true);
  assert.deepEqual(page.links, ['/help']);
  // A "<" inside a quoted handler (common in phishing kits) does not hide the form; an unclosed title is no title.
  const kit = parse('<title>Foo<form action="https://evil.example/x" onsubmit="return a.length<9"><input type=password onkeyup="if(v<3)x()"></form>', 'https://page.example/');
  assert.equal(kit.forms.length, 1);
  assert.equal(kit.forms[0].external, true);
  assert.equal(kit.forms[0].inputs[0].type, 'password');
  assert.equal(kit.title, '');
});

test('an email is not taken for a brand by a word that contains its name', () => {
  const { analyzeEmail } = require('../server/lib/scan/email');
  const e01 = (m) => analyzeEmail(m).checks.find((c) => c.id === 'E01').status;
  assert.equal(e01({ from: 'Etsy <transaction@etsy.com>', subject: 'Your purchase receipt', body: 'x' }), 'pass');
  assert.equal(e01({ from: 'Morningstar <news@morningstar.com>', subject: 'Weekly market outlook', body: 'x' }), 'pass');
  assert.equal(e01({ from: 'PayPalSupport <a@evil.example>', subject: 'x', body: 'x' }), 'fail');
  assert.equal(e01({ from: 'Service <a@evil.example>', subject: 'Your Chase account is locked', body: 'x' }), 'fail');
  const e03 = analyzeEmail({ from: 'NYT <news@email.nytimes.com>', replyTo: 'help@nytimes.com', subject: 'Today', body: 'x' }).checks.find((c) => c.id === 'E03');
  assert.equal(e03.status, 'pass', 'the same company writing from its own subdomain');
});

test('the rate-limit table stays bounded, and a key that has counted twice is never dropped to make room', () => {
  const security = require('../server/lib/security');
  const { MAX_BUCKETS, size } = security._rate;
  const long = `login:email:${'x'.repeat(240)}@example.com`;
  security.rateLimit(long, 2, 60 * 60 * 1000);
  security.rateLimit(long, 2, 60 * 60 * 1000);
  for (let i = 0; size() < MAX_BUCKETS; i++) security.rateLimit(`forgot:email:flood${i}@example.com`, 3, 60 * 60 * 1000);
  security.rateLimit('forgot:email:one-more@example.com', 3, 60 * 60 * 1000);
  assert.ok(size() <= MAX_BUCKETS * 0.9 + 1, `table held to its size: ${size()}`);
  assert.throws(() => security.rateLimit(long, 2, 60 * 60 * 1000), { status: 429 }, 'someone trying is still limited after the flood');
});

test('passwords follow NIST SP 800-63B rev. 4: 15 characters, no rules about kinds of character', () => {
  const { passwordProblem } = require('../server/lib/security');
  assert.match(passwordProblem('Harbour-Moss-7'), /at least 15 characters/, '14 characters, with every kind, is too short');
  assert.equal(passwordProblem('quiet orchard lamp'), null, 'words alone, long enough, are fine');
  assert.equal(passwordProblem('aaaaaaaaaaaaaaaaaaaa'), 'Password is too predictable');
  assert.match(passwordProblem('robinsentinel-orchard', { firstName: 'Robin' }), /your name/);
});

test('every action in every workflow is pinned to a full commit, and Dependabot keeps the pins current', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', '.github', 'workflows');
  const loose = [];
  for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    for (const [, ref] of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      if (!ref.startsWith('./') && !/@[0-9a-f]{40}$/.test(ref)) loose.push(`${f}: ${ref}`);
    }
  }
  assert.deepEqual(loose, []);
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.github', 'dependabot.yml'), 'utf8'), /package-ecosystem: github-actions/);
});

test('release downloads carry signed provenance from the workflow that built them', () => {
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(yml, /id-token: write\r?\n\s+attestations: write/);
  assert.match(yml, /uses: actions\/attest-build-provenance@[0-9a-f]{40}[^\n]*\r?\n\s+with:\r?\n\s+subject-path: \|\r?\n\s+release\/\*\.exe\r?\n\s+release\/\*\.zip/);
  assert.ok(yml.indexOf('attest-build-provenance') < yml.indexOf('action-gh-release'), 'attested before it is published');
});

test('the Windows app\'s own pages run no inline script: every script is a file, and their policy allows nothing else', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'desktop', 'src', 'pages');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
    assert.match(csp, /default-src 'none'/, f);
    assert.doesNotMatch((csp.match(/script-src[^;]*/) || [''])[0], /unsafe-inline|unsafe-eval|\*/, `${f}: ${csp}`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${f}: an inline script`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${f}: an inline handler`);
    for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(dir, src)) || /shared\//.test(src), `${f}: ${src}`);
  }
});

test('the release build is fused: no program can run code as Sentinel, and the release checks it before publishing', () => {
  const fs = require('fs');
  const path = require('path');
  const cfg = require('../desktop/electron-builder.release.js');
  const pkg = require('../desktop/package.json');
  assert.deepEqual(cfg.electronFuses, { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true });
  assert.deepEqual({ ...cfg, electronFuses: undefined }, { ...pkg.build, electronFuses: undefined }, 'otherwise the same build');
  assert.match(pkg.scripts['dist:win:release'], /--config electron-builder\.release\.js$/);
  const release = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(release, /npm run dist:win:release/);
  assert.doesNotMatch(release, /npm run dist:win\r?\n/);
  assert.ok(release.indexOf('desktop-fuses-e2e.ps1') > release.indexOf('dist:win:release') && release.indexOf('desktop-fuses-e2e.ps1') < release.indexOf('action-gh-release'));
  const e2e = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'desktop-e2e.yml'), 'utf8');
  assert.match(e2e, /desktop-fuses-e2e\.ps1 -App desktop\/node_modules\/electron\/dist\/electron\.exe -Out e2e-fuses\/control -Control/, 'a check that can fail');
});

test('an account made under the old 10-character minimum still signs in; the new minimum applies only when a password is set or changed', async () => {
  const security = require('../server/lib/security');
  const A = require('../server/lib/auth');
  const c = await signedIn();
  const old = 'Lamp-Moss-42';   // 12 characters: allowed before 1.20.2
  assert.ok(old.length < security.MIN_PASSWORD);
  A.db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(await A.hashPassword(old), c.email);
  const fresh = client(app.base);
  assert.equal((await fresh.post('/api/v1/auth/login', { email: c.email, password: old })).status, 200, 'signs in as before');
  const same = await fresh.post('/api/v1/account/password', { currentPassword: old, newPassword: 'Lamp-Moss-43' });
  assert.equal(same.status, 400, 'a new short one is refused');
  assert.match(JSON.stringify(same.data), /at least 15 characters/);
  assert.equal((await fresh.post('/api/v1/account/password', { currentPassword: old, newPassword: 'quiet orchard lamp river' })).status, 200, 'a long one is taken');
});

test('the password minimum is one number, and every page that states it says the same one', () => {
  const { MIN_PASSWORD, passwordProblem } = require('../server/lib/security');
  const fs = require('fs');
  const path = require('path');
  const web = (...p) => fs.readFileSync(path.join(__dirname, '..', 'web', ...p), 'utf8');
  assert.equal(passwordProblem('x'.repeat(MIN_PASSWORD - 1) + 'y'), null);
  assert.match(passwordProblem('ab'.repeat(MIN_PASSWORD).slice(0, MIN_PASSWORD - 1)), new RegExp(`at least ${MIN_PASSWORD} characters`));
  for (const page of ['signup.html', 'reset.html']) {
    assert.match(web(page), new RegExp(`minlength="${MIN_PASSWORD}"`), page);
    assert.ok(web(page).includes(`At least ${MIN_PASSWORD} characters.`), page);
  }
  const app = web('assets', 'js', 'app.js');
  assert.ok(app.includes(`name="newPassword" autocomplete="new-password" required minlength="${MIN_PASSWORD}"`));
  assert.ok(app.includes(`At least ${MIN_PASSWORD} characters.`));
  for (const f of ['auth.js', 'reset.js']) assert.ok(web('assets', 'js', f).includes(`v.length < ${MIN_PASSWORD} ? 1`), f);
});
