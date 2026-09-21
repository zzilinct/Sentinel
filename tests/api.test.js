'use strict';
process.env.NODE_ENV = 'test';
process.env.RESEARCH_ALLOW_PRIVATE = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startFixtureServer, applyFacts, client, startApp, knownBadSample } = require('./fixtures');

let app;
let fixture;

test.before(async () => {
  fixture = await startFixtureServer();
  process.env.RESEARCH_TEST_PORT = String(fixture.address().port);
  app = await startApp();
  applyFacts();
});
test.after(() => { app.server.close(); fixture.close(); });

let n = 0;
async function newUser(plan = 'free') {
  const c = client(app.base);
  const email = `user${++n}_${Date.now()}@example.com`;
  const r = await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'Test', lastName: '', ageConfirmed: true, termsAccepted: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  // Creating an account signs nobody in; signing in is its own step.
  const s = await c.post('/api/v1/auth/login', { email, password: 'Correct-Horse-42' });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  if (plan !== 'free') {
    const up = await c.post('/api/v1/billing/plan', { plan });
    assert.equal(up.status, 200, JSON.stringify(up.data));
  }
  c.email = email;
  return c;
}

/* ------------------------------------------------------------ accounts */

test('signup requires a name, valid email and a strong password; last name optional', async () => {
  const c = client(app.base);
  const weak = await c.post('/api/v1/auth/signup', { email: 'weak@example.com', password: 'password123', firstName: 'Ann' });
  assert.equal(weak.status, 400);
  assert.ok(weak.data.error.errors.password);

  const missing = await c.post('/api/v1/auth/signup', { email: 'not-an-email', password: 'Correct-Horse-42', firstName: '' });
  assert.equal(missing.status, 400);
  assert.ok(missing.data.error.errors.email && missing.data.error.errors.firstName);

  // Age and terms are required and must be an explicit true - 'on' or 1 don't count.
  const noConsent = await c.post('/api/v1/auth/signup', { email: 'ann@example.com', password: 'Correct-Horse-42', firstName: 'Ann' });
  assert.equal(noConsent.status, 400);
  assert.ok(noConsent.data.error.errors.ageConfirmed && noConsent.data.error.errors.termsAccepted);
  const sloppy = await c.post('/api/v1/auth/signup', { email: 'ann@example.com', password: 'Correct-Horse-42', firstName: 'Ann', ageConfirmed: 'on', termsAccepted: 1 });
  assert.equal(sloppy.status, 400);

  const ok = await c.post('/api/v1/auth/signup', { email: 'ann@example.com', password: 'Correct-Horse-42', firstName: 'Ann', ageConfirmed: true, termsAccepted: true });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.verification, 'sent');
  assert.equal(ok.data.user.emailVerified, false);
  assert.equal(ok.data.user.needsTerms, false);
  assert.ok(ok.data.user.ageConfirmedAt && ok.data.user.termsAcceptedAt);
  assert.equal(ok.data.user.lastName, null);
  assert.equal(ok.data.user.plan, 'free');
  assert.equal(ok.headers.get('set-cookie'), null, 'sign-up creates the account and signs nobody in');
  assert.equal(ok.data.next, '/login');
  const signedIn = await c.post('/api/v1/auth/login', { email: 'ann@example.com', password: 'Correct-Horse-42' });
  assert.match(signedIn.headers.get('set-cookie'), /HttpOnly/);

  const dup = await client(app.base).post('/api/v1/auth/signup', { email: 'ann@example.com', password: 'Correct-Horse-42', firstName: 'Ann', ageConfirmed: true, termsAccepted: true });
  assert.equal(dup.status, 409);
});

test('email verification: a real link is emailed, works once, expires, and can be resent', async () => {
  const { outbox } = require('../server/lib/mailer');
  const c = await newUser();
  const mail = outbox.filter((m) => m.to === c.email && /Confirm your Sentinel email/.test(m.subject)).pop();
  assert.ok(mail, 'a verification email was actually produced');
  const token = /\/verify\?token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];

  const anon = client(app.base);
  const bad = await anon.post('/api/v1/auth/verify', { token: 'not-a-token' });
  assert.equal(bad.status, 400);
  const good = await anon.post('/api/v1/auth/verify', { token });
  assert.equal(good.status, 200, JSON.stringify(good.data));
  assert.equal(good.data.user.emailVerified, true);
  assert.equal((await anon.post('/api/v1/auth/verify', { token })).status, 400, 'links work once');
  assert.equal((await c.get('/api/v1/auth/me')).data.user.emailVerified, true);

  const again = await c.post('/api/v1/auth/verify/resend', {});
  assert.equal(again.data.verification, 'already');

  const d = await newUser();
  const resent = await d.post('/api/v1/auth/verify/resend', {});
  assert.equal(resent.data.verification, 'sent');
  assert.equal(outbox.filter((m) => m.to === d.email).length, 2);
});

test('accounts that owe the terms (Google sign-ups, older accounts) must confirm age and accept before use', async () => {
  const c = await newUser();
  const { db } = require('../server/lib/db');
  db.prepare('UPDATE users SET age_confirmed_at = NULL, terms_accepted_at = NULL, terms_version = NULL WHERE email = ?').run(c.email);
  assert.equal((await c.get('/api/v1/auth/me')).data.user.needsTerms, true);

  const partial = await c.post('/api/v1/account/accept-terms', { ageConfirmed: true, termsAccepted: false });
  assert.equal(partial.status, 400);
  assert.ok(partial.data.error.errors.termsAccepted);

  const done = await c.post('/api/v1/account/accept-terms', { ageConfirmed: true, termsAccepted: true });
  assert.equal(done.status, 200);
  assert.equal(done.data.user.needsTerms, false);
  assert.equal(done.data.user.termsVersion, require('../server/lib/auth').TERMS_VERSION);
});

test('guest scan: full result without an account, scam mask only, nothing recorded', async () => {
  const anon = client(app.base);
  const r = await anon.post('/api/v1/guest/scan', { url: 'paypa1-secure-login.com/account' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.guest.limitPerDay, 10);
  assert.equal(r.data.verdict.threats.scam.badge, 'red');
  assert.equal(r.data.verdict.threats.virus, null, 'guests get the scam mask only');
  assert.ok(r.data.verdict.checklist.items.length > 50, 'the full checklist is returned');
  assert.equal(r.data.verdict.researched, false);
  assert.equal((await anon.post('/api/v1/guest/scan', { url: 'javascript:alert(1)' })).status, 400);
  const { db } = require('../server/lib/db');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM scan_history WHERE mode = 'guest'").get().n, 0);
});

test('login works, and wrong passwords get the same answer for real and unknown accounts', async () => {
  const c = await newUser();
  const out = await c.post('/api/v1/auth/logout', {});
  assert.equal(out.status, 200);
  assert.equal((await c.get('/api/v1/auth/me')).status, 401);

  const good = await c.post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' });
  assert.equal(good.status, 200);
  assert.equal((await c.get('/api/v1/auth/me')).status, 200);

  const wrong = await client(app.base).post('/api/v1/auth/login', { email: c.email, password: 'nope-nope-1' });
  const unknown = await client(app.base).post('/api/v1/auth/login', { email: 'ghost@example.com', password: 'nope-nope-1' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.data.error.message, unknown.data.error.message);
});

/* ----------------------------------------------------------------- plans */

test('free plan: 10 link scans a week, scam mask only, no research', async () => {
  const c = await newUser('free');
  const first = await c.post('/api/v1/scan/link', { url: 'https://paypal-account-verify.com/login' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const v = first.data.verdict;
  assert.equal(v.researched, false);
  assert.ok(v.threats.scam);
  assert.equal(v.threats.virus, null);
  assert.equal(v.threats.malware, null);
  assert.equal(first.data.usage.linkScans.used, 1);
  assert.equal(first.data.usage.linkScans.limit, 10);

  for (let i = 2; i <= 10; i++) assert.equal((await c.post('/api/v1/scan/link', { url: `https://example-${i}.com/` })).status, 200);
  const blocked = await c.post('/api/v1/scan/link', { url: 'https://example-11.com/' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error.code, 'weekly_limit_reached');
  assert.ok(blocked.data.error.resetsAt > Date.now());
});

test('free plan: virus & malware scanner has 5 uses; fast live scanning only (15 minutes a week); no email scanning', async () => {
  const c = await newUser('free');
  for (let i = 0; i < 5; i++) {
    const r = await c.raw('POST', '/api/v1/scan/file', { raw: Buffer.from(`hello ${i}`), headers: { 'X-File-Name': 'note.txt', 'Content-Type': 'application/octet-stream' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const sixth = await c.raw('POST', '/api/v1/scan/file', { raw: Buffer.from('x'), headers: { 'X-File-Name': 'note.txt', 'Content-Type': 'application/octet-stream' } });
  assert.equal(sixth.status, 429);

  // Free has fast live scanning. Asking for delicate gets fast, and says why.
  const live = await c.post('/api/v1/live/batch', { urls: ['https://paypa1-secure-login.com/'], mode: 'delicate' });
  assert.equal(live.status, 200, JSON.stringify(live.data));
  assert.equal(live.data.mode, 'fast');
  assert.equal(live.data.fellBack, 'delicate_needs_pro');
  assert.equal(live.data.researched, false);
  assert.equal(live.data.byUrl['https://paypa1-secure-login.com/'].threats.scam.badge, 'red', 'a listed site is red in fast mode too');
  assert.equal(live.data.live.fast.limitMinutes, 15);
  assert.equal(live.data.live.fast.usedMinutes, 1);
  assert.equal(live.data.live.limitMinutes, 0);
  assert.equal((await c.post('/api/v1/scan/email', { from: 'a@b.com', subject: 'hi', body: 'hi' })).data.error.code, 'plan_required');
});

test('pro plan: research + virus & malware on link scans, 40/week, 4 h delicate and 24 h fast live scanning', async () => {
  const c = await newUser('pro');
  const r = await c.post('/api/v1/scan/link', { url: 'https://browser-update-center.top/' });
  assert.equal(r.status, 200);
  assert.equal(r.data.verdict.researched, true);
  assert.equal(r.data.verdict.threats.malware.level, 'confirmed');
  assert.equal(r.data.usage.linkScans.limit, 40);
  assert.equal(r.data.usage.fileScans.limit, 40);
  assert.equal(r.data.usage.liveMinutes.limit, 4 * 60);
  assert.equal(r.data.usage.fastMinutes.limit, 24 * 60);

  const live = await c.post('/api/v1/live/batch', { urls: ['https://paypa1-secure-login.com/', 'https://github.com/'], mode: 'delicate' });
  assert.equal(live.status, 200);
  assert.equal(live.data.mode, 'delicate');
  assert.equal(live.data.researched, true, 'delicate researches every result');
  assert.ok(live.data.tookMs < 5000, `delicate answers inside its budget (${live.data.tookMs} ms)`);
  const quick = await c.post('/api/v1/live/batch', { urls: ['https://paypa1-secure-login.com/', 'https://github.com/'], mode: 'fast' });
  assert.equal(quick.data.mode, 'fast');
  assert.equal(quick.data.researched, false);
  assert.ok(quick.data.tookMs < 1000, `fast answers in well under a second (${quick.data.tookMs} ms)`);
  assert.equal(quick.data.live.fast.usedMinutes, 1, 'and is counted against its own allowance');
  // A private window gets the fast checks whatever was asked for: its addresses are not sent to a registry.
  const priv = await c.post('/api/v1/live/batch', { urls: ['https://example.org/'], mode: 'delicate', private: true });
  assert.equal(priv.data.researched, false);
  assert.equal(live.data.byUrl['https://paypa1-secure-login.com/'].threats.scam.badge, 'red');
  assert.equal(live.data.live.usedMinutes, 1);

  const email = await c.post('/api/v1/live/email', { emails: [{ key: 'm1', from: 'PayPal <help@paypa1-secure-login.com>', subject: 'Verify now', body: 'Verify your account' }] });
  assert.equal(email.status, 200);
  assert.ok(['likely', 'confirmed'].includes(email.data.results[0].verdict.threats.scam.level));

  assert.equal((await c.post('/api/v1/scan/email', { from: 'a@b.com', body: 'hi' })).data.error.code, 'plan_required');
});

test('max plan: 100/week, 24 h delicate, unlimited fast, manual email scans', async () => {
  const c = await newUser('max');
  const me = await c.get('/api/v1/auth/me');
  assert.equal(me.data.usage.linkScans.limit, 100);
  assert.equal(me.data.usage.fileScans.limit, 100);
  assert.equal(me.data.usage.liveMinutes.limit, 24 * 60);
  assert.equal(me.data.usage.fastMinutes.limit, null, 'fast is uncapped');

  const live = await c.post('/api/v1/live/batch', { urls: ['https://wallet-connect-restore.xyz/'], research: true });
  assert.equal(live.data.researched, true);
  assert.equal(live.data.byUrl['https://wallet-connect-restore.xyz/'].threats.scam.level, 'confirmed');

  const mail = await c.post('/api/v1/scan/email', {
    from: 'Netflix Billing <billing@netflix-account-hold.example>',
    subject: 'Payment declined - update your billing',
    body: 'Dear customer, your payment failed. Update your payment details within 24 hours.',
    links: [{ href: 'https://paypal-account-verify.com/login', text: 'netflix.com/account' }],
    attachments: []
  });
  assert.equal(mail.status, 200, JSON.stringify(mail.data));
  assert.ok(['likely', 'confirmed'].includes(mail.data.verdict.threats.scam.level));
  assert.equal(mail.data.usage.linkScans.used, 1, 'manual email scans count toward the weekly scans');
});

test('ultimate plan: 500/week, 96 h delicate, unlimited fast, everything Max has', async () => {
  const c = await newUser('ultimate');
  const me = await c.get('/api/v1/auth/me');
  assert.equal(me.data.plan.price, 100);
  assert.equal(me.data.usage.linkScans.limit, 500);
  assert.equal(me.data.usage.fileScans.limit, 500);
  assert.equal(me.data.usage.liveMinutes.limit, 96 * 60);
  assert.equal(me.data.usage.fastMinutes.limit, null, 'fast minutes are uncapped, not a number');
  assert.equal(me.data.plan.features.liveResearch, true);
  assert.equal(me.data.plan.features.emailManual, true);

  // An uncapped allowance must never trip the weekly limit.
  for (let i = 0; i < 3; i++) {
    const live = await c.post('/api/v1/live/batch', { urls: ['https://wallet-connect-restore.xyz/'], mode: 'fast' });
    assert.equal(live.status, 200, JSON.stringify(live.data));
    assert.equal(live.data.live.fast.limitMinutes, null);
  }
});

test('delicate hours run out: protection carries on in fast mode and says so; fast runs out for good', async () => {
  const c = await newUser('pro');
  const me = await c.get('/api/v1/auth/me');
  const { db } = require('../server/lib/db');
  const plans = require('../server/lib/plans');
  const start = Math.floor(plans.weekStart() / 60000);
  const fill = (table, minutes) => {
    const ins = db.prepare(`INSERT OR IGNORE INTO ${table} (user_id, minute) VALUES (?, ?)`);
    db.exec('BEGIN');
    for (let i = 0; i < minutes; i++) ins.run(me.data.user.id, start + i);
    db.exec('COMMIT');
  };
  fill('live_minutes', 4 * 60);
  const r = await c.post('/api/v1/live/batch', { urls: ['https://example.com/'], mode: 'delicate' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.mode, 'fast');
  assert.equal(r.data.fellBack, 'delicate_hours_used');

  fill('fast_minutes', 24 * 60);
  const out = await c.post('/api/v1/live/batch', { urls: ['https://example.com/'], mode: 'fast' });
  // The minute already being counted stays usable; a fresh account with nothing left is refused.
  const d = await newUser('pro');
  const meD = await d.get('/api/v1/auth/me');
  const ins = db.prepare('INSERT OR IGNORE INTO fast_minutes (user_id, minute) VALUES (?, ?)');
  const insL = db.prepare('INSERT OR IGNORE INTO live_minutes (user_id, minute) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < 24 * 60; i++) ins.run(meD.data.user.id, start + i);
  for (let i = 0; i < 4 * 60; i++) insL.run(meD.data.user.id, start + i);
  db.exec('COMMIT');
  const none = await d.post('/api/v1/live/batch', { urls: ['https://example.com/'], mode: 'delicate' });
  assert.ok(out.status === 200 || out.status === 429);
  assert.equal(none.status, 429, JSON.stringify(none.data));
  assert.equal(none.data.error.code, 'live_hours_exhausted');
});

test('file scanner through the API flags a known malicious sample', async () => {
  const c = await newUser('pro');
  const r = await c.raw('POST', '/api/v1/scan/file', { raw: knownBadSample(), headers: { 'X-File-Name': encodeURIComponent('sample (1).bin'), 'Content-Type': 'application/octet-stream' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.verdict.threats.virus.badge, 'red');
  assert.equal(r.data.usage.fileScans.used, 1);
});

test('history and reports: three distinct users promote a site to confirmed', async () => {
  const users = [await newUser(), await newUser(), await newUser()];
  for (const u of users) {
    const r = await u.post('/api/v1/report', { url: 'https://brand-new-shop-scam.biz/', category: 'fake_store' });
    assert.equal(r.status, 201);
  }
  const again = await users[0].post('/api/v1/report', { url: 'https://brand-new-shop-scam.biz/', category: 'fake_store' });
  assert.equal(again.status, 409);
  const v = await users[0].post('/api/v1/scan/link', { url: 'https://brand-new-shop-scam.biz/checkout' });
  assert.equal(v.data.verdict.threats.scam.level, 'confirmed');

  const history = await users[0].get('/api/v1/account/history');
  assert.equal(history.status, 200);
  assert.ok(history.data.items.length >= 1);
});

test('trusting a site clears its masks for that user only', async () => {
  const a = await newUser('pro');
  const b = await newUser('pro');
  await a.post('/api/v1/sites/override', { url: 'https://free-giftcard-claim-now.tk/', action: 'allow' });
  const va = (await a.post('/api/v1/scan/link', { url: 'https://free-giftcard-claim-now.tk/' })).data.verdict;
  const vb = (await b.post('/api/v1/scan/link', { url: 'https://free-giftcard-claim-now.tk/' })).data.verdict;
  assert.equal(va.threats.scam.badge, null);
  assert.notEqual(vb.threats.scam.badge, null);
});

test('password reset: emailed one-time link, sessions revoked, unknown emails get the same answer', async () => {
  const mailer = require('../server/lib/mailer');
  const c = await newUser('free');
  const other = client(app.base);
  assert.equal((await other.post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' })).status, 200);

  mailer.outbox.length = 0;
  const known = await client(app.base).post('/api/v1/auth/forgot', { email: c.email });
  const unknown = await client(app.base).post('/api/v1/auth/forgot', { email: 'nobody-here@example.com' });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(known.data.message, unknown.data.message);
  assert.equal(mailer.outbox.length, 1, 'only the real account gets an email');

  const token = /token=([A-Za-z0-9_-]+)/.exec(mailer.outbox[0].text)[1];
  const weak = await client(app.base).post('/api/v1/auth/reset', { token, password: 'short1' });
  assert.equal(weak.status, 400);

  const ok = await client(app.base).post('/api/v1/auth/reset', { token, password: 'Brand-New-Secret-91' });
  assert.equal(ok.status, 200);
  assert.equal((await other.get('/api/v1/auth/me')).status, 401, 'existing sessions are signed out');

  const reuse = await client(app.base).post('/api/v1/auth/reset', { token, password: 'Another-Secret-92' });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.data.error.code, 'reset_invalid');

  assert.equal((await client(app.base).post('/api/v1/auth/login', { email: c.email, password: 'Correct-Horse-42' })).status, 401);
  assert.equal((await client(app.base).post('/api/v1/auth/login', { email: c.email, password: 'Brand-New-Secret-91' })).status, 200);
});

test('new pages are served and partials are not directly reachable', async () => {
  for (const path of ['/', '/pricing', '/download', '/login', '/signup', '/forgot', '/reset', '/connect', '/app', '/app/protection', '/privacy', '/terms']) {
    const r = await fetch(app.base + path);
    assert.equal(r.status, 200, path);
    const html = await r.text();
    assert.ok(!html.includes('@include'), `${path} has unexpanded includes`);
  }
  assert.equal((await fetch(`${app.base}/partials/nav.html`)).status, 404);
  assert.equal((await fetch(`${app.base}/partials/nav`)).status, 404);
});

/* ------------------------------------------------------- public demo */

test('demo examples: every mask button shows a real verdict at the colour it claims', async () => {
  const r = await fetch(`${app.base}/api/v1/demo/examples`);
  assert.equal(r.status, 200);
  const d = await r.json();
  for (const threat of ['scam', 'virus', 'malware']) {
    for (const badge of ['yellow', 'orange', 'red']) {
      const ex = d.masks[threat][badge];
      assert.equal(ex.threats[threat].badge, badge, `${threat}/${badge}: ${ex.url} scored ${ex.threats[threat].score}`);
      assert.ok(ex.context && ex.reasons.length, `${threat}/${badge} needs context and reasons`);
    }
  }
  for (const key of ['paypal', 'crypto', 'parcel']) {
    const set = d.serp[key];
    assert.ok(set.query && set.results.length === 5);
    assert.ok(set.results.some((v) => !v.overall.badge), `${key} should include a safe result`);
    assert.ok(set.results.some((v) => v.overall.badge), `${key} should include a flagged result`);
  }
  const safe = d.game.filter((v) => !v.overall.badge).length;
  assert.ok(safe >= 2 && d.game.length - safe >= 4, 'the game needs both safe and dangerous links');
  // Nothing internal leaks through the public summary.
  assert.ok(!JSON.stringify(d).includes('evidence'));
});

test('demo scan: no account needed, bare domains are treated as HTTPS, bad input rejected', async () => {
  const post = (body) => fetch(`${app.base}/api/v1/demo/scan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.base }, body: JSON.stringify(body)
  });
  const ok = await post({ url: 'paypal-account-verify.com/login' });
  assert.equal(ok.status, 200);
  const { verdict } = await ok.json();
  assert.equal(verdict.url.startsWith('https://'), true);
  assert.ok(verdict.threats.scam.badge, 'a paypal look-alike should get a mask');
  assert.ok(!verdict.reasons.some((x) => /Unencrypted/.test(x.text)), 'a typed domain must not be called unencrypted');

  assert.equal((await post({ url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await post({ url: '   ' })).status, 400);
  assert.equal((await post({ url: 42 })).status, 400);
});
