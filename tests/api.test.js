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
  const r = await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'Test', lastName: '' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
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

  const ok = await c.post('/api/v1/auth/signup', { email: 'ann@example.com', password: 'Correct-Horse-42', firstName: 'Ann' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.lastName, null);
  assert.equal(ok.data.user.plan, 'free');
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);

  const dup = await client(app.base).post('/api/v1/auth/signup', { email: 'ann@example.com', password: 'Correct-Horse-42', firstName: 'Ann' });
  assert.equal(dup.status, 409);
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

test('free plan: virus & malware scanner has 5 uses; no live scanning or email scanning', async () => {
  const c = await newUser('free');
  for (let i = 0; i < 5; i++) {
    const r = await c.raw('POST', '/api/v1/scan/file', { raw: Buffer.from(`hello ${i}`), headers: { 'X-File-Name': 'note.txt', 'Content-Type': 'application/octet-stream' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const sixth = await c.raw('POST', '/api/v1/scan/file', { raw: Buffer.from('x'), headers: { 'X-File-Name': 'note.txt', 'Content-Type': 'application/octet-stream' } });
  assert.equal(sixth.status, 429);

  assert.equal((await c.post('/api/v1/live/batch', { urls: ['https://example.com/'] })).data.error.code, 'plan_required');
  assert.equal((await c.post('/api/v1/scan/email', { from: 'a@b.com', subject: 'hi', body: 'hi' })).data.error.code, 'plan_required');
});

test('pro plan: research + virus & malware on link scans, 40/week, live scanning without research', async () => {
  const c = await newUser('pro');
  const r = await c.post('/api/v1/scan/link', { url: 'https://browser-update-center.top/' });
  assert.equal(r.status, 200);
  assert.equal(r.data.verdict.researched, true);
  assert.equal(r.data.verdict.threats.malware.level, 'confirmed');
  assert.equal(r.data.usage.linkScans.limit, 40);
  assert.equal(r.data.usage.fileScans.limit, 40);
  assert.equal(r.data.usage.liveMinutes.limit, 24 * 60);

  const live = await c.post('/api/v1/live/batch', { urls: ['https://paypa1-secure-login.com/', 'https://github.com/'], research: true });
  assert.equal(live.status, 200);
  assert.equal(live.data.researched, false, 'Pro live results are not researched');
  assert.equal(live.data.byUrl['https://paypa1-secure-login.com/'].threats.scam.badge, 'red');
  assert.equal(live.data.live.usedMinutes, 1);

  const email = await c.post('/api/v1/live/email', { emails: [{ key: 'm1', from: 'PayPal <help@paypa1-secure-login.com>', subject: 'Verify now', body: 'Verify your account' }] });
  assert.equal(email.status, 200);
  assert.ok(['likely', 'confirmed'].includes(email.data.results[0].verdict.threats.scam.level));

  assert.equal((await c.post('/api/v1/scan/email', { from: 'a@b.com', body: 'hi' })).data.error.code, 'plan_required');
});

test('max plan: 100/week, researched live scanning, manual email scans', async () => {
  const c = await newUser('max');
  const me = await c.get('/api/v1/auth/me');
  assert.equal(me.data.usage.linkScans.limit, 100);
  assert.equal(me.data.usage.fileScans.limit, 100);
  assert.equal(me.data.usage.liveMinutes.limit, 96 * 60);

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

test('live hours run out and reset weekly', async () => {
  const c = await newUser('pro');
  const me = await c.get('/api/v1/auth/me');
  const { db } = require('../server/lib/db');
  const plans = require('../server/lib/plans');
  const start = Math.floor(plans.weekStart() / 60000);
  const ins = db.prepare('INSERT OR IGNORE INTO live_minutes (user_id, minute) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < 24 * 60; i++) ins.run(me.data.user.id, start + i);
  db.exec('COMMIT');
  const r = await c.post('/api/v1/live/batch', { urls: ['https://example.com/'] });
  assert.equal(r.status, 429);
  assert.equal(r.data.error.code, 'live_hours_exhausted');
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
