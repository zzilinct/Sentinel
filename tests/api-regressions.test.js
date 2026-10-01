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

test('invalid inherited plan names are rejected without damaging the account', async () => {
  const c = await newUser();
  for (const plan of ['__proto__', 'constructor', 'toString']) {
    const r = await c.post('/api/v1/billing/plan', { plan });
    assert.equal(r.status, 400);
    assert.equal(r.data.error.code, 'bad_plan');
    const me = await c.get('/api/v1/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.plan.id, 'free');
  }
});

test('an already paid live minute remains usable after the in-memory cache is lost', async () => {
  const c = await newUser();
  const user = (await c.get('/api/v1/auth/me')).data.user;
  const { db } = require('../server/lib/db');
  const plans = require('../server/lib/plans');
  const minute = Math.floor(Date.now() / 60000);
  const buckets = new Set([minute]);
  for (let m = Math.floor(plans.weekStart() / 60000); buckets.size < 15; m++) buckets.add(m);
  const insert = db.prepare('INSERT INTO fast_minutes (user_id, minute) VALUES (?, ?)');
  for (const m of buckets) insert.run(user.id, m);
  const r = await c.post('/api/v1/live/batch', { urls: ['https://example.com/'], mode: 'fast' });
  assert.equal(r.status, 200);
  assert.equal(plans.fastMinutesUsed(user.id), 15, 'the current minute is not charged twice');
});

test('history rows and totals use the same thirty-day window', async () => {
  const c = await newUser();
  const user = (await c.get('/api/v1/auth/me')).data.user;
  const { db } = require('../server/lib/db');
  const insert = db.prepare("INSERT INTO scan_history (user_id, kind, target, mode, scam, virus, malware, created_at) VALUES (?, 'url', ?, 'manual', 'safe', 'safe', 'safe', ?)");
  insert.run(user.id, 'https://old-history.example/', Date.now() - 31 * 86400000);
  insert.run(user.id, 'https://recent-history.example/', Date.now() - 86400000);
  const r = await c.get('/api/v1/account/history');
  assert.equal(r.data.stats.total, 1);
  assert.deepEqual(r.data.items.map(i => i.target), ['https://recent-history.example/']);
});

test('community reports retain their threat type and mixed categories do not combine into confirmation', async () => {
  const users = [await newUser('pro'), await newUser(), await newUser()];
  established(users);
  const host = 'ordinary-community-review.example';
  for (const u of users) assert.equal((await u.post('/api/v1/report', { url: `https://${host}/`, category: 'malware' })).status, 201);
  const verdict = (await users[0].post('/api/v1/scan/threat', { url: `https://${host}/` })).data.verdict;
  assert.equal(verdict.threats.malware.level, 'confirmed');
  const { scanUrl } = require('../server/lib/scan/engine');
  const all = await scanUrl(`https://${host}/`, { research: false });
  assert.equal(all.threats.scam.badge, null, 'malware reports must not raise the scam mask');
  const categories = ['phishing', 'fake_store', 'malware'];
  for (let i = 0; i < users.length; i++) {
    const r = await users[i].post('/api/v1/report', { url: 'https://mixed-community-review.example/', category: categories[i] });
    assert.equal(r.data.promoted, false);
  }
  const mixed = await scanUrl('https://mixed-community-review.example/', { research: false });
  assert.notEqual(mixed.threats.scam.level, 'confirmed');
  assert.notEqual(mixed.threats.malware.level, 'confirmed');
});

/** Accounts whose owners confirmed their email a week ago or more: only their reports count for everyone. */
test('new and unverified reporters cannot confirm a site through the scan pipeline', async () => {
  const users = [await newUser(), await newUser(), await newUser()];
  const host = 'unqualified-reports.example';
  const { db } = require('../server/lib/db');
  const { lookup } = require('../server/lib/scan/knowledge');
  const { analyze } = require('../server/lib/scan/url');
  for (const u of users) {
    const r = await u.post('/api/v1/report', { url: `https://${host}/`, category: 'phishing' });
    assert.equal(r.data.promoted, false);
  }
  const know = () => lookup(analyze(`https://${host}/`));
  assert.equal((await know()).matches.length, 0, 'fresh accounts do not count');
  const old = Date.now() - 8 * 86400000;
  for (const u of users) db.prepare('UPDATE users SET created_at = ?, email_verified_at = NULL WHERE email = ?').run(old, u.email);
  assert.equal((await know()).matches.length, 0, 'old unverified accounts do not count');
  for (const u of users) db.prepare('UPDATE users SET created_at = ?, email_verified_at = ? WHERE email = ?').run(Date.now(), old, u.email);
  assert.equal((await know()).matches.length, 0, 'verification alone is insufficient');
  established(users);
  assert.equal((await know()).known, true, 'eligible independent reports still count');
});

test('community reports cannot condemn a verified site but exact threat listings still apply', async () => {
  const users = [await newUser(), await newUser(), await newUser()];
  established(users);
  for (const u of users) assert.equal((await u.post('/api/v1/report', { url: 'https://www.paypal.com/', category: 'phishing' })).data.promoted, false);
  const { scanUrl, invalidate } = require('../server/lib/scan/engine');
  invalidate('paypal.com');
  assert.equal((await scanUrl('https://www.paypal.com/', { research: false })).overall.badge, null);
  const { db } = require('../server/lib/db');
  const { urlKey } = require('../server/lib/scan/url');
  const url = 'https://www.paypal.com/exact-compromised-page';
  db.prepare('INSERT INTO feed_urls (url_key, host, source, threat, category, added_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(urlKey(url), 'www.paypal.com', 'test_live_accuracy', 'scam', 'phishing', Date.now());
  try {
    invalidate('paypal.com');
    assert.equal((await scanUrl(url, { research: false })).overall.badge, 'red');
  } finally { db.prepare('DELETE FROM feed_urls WHERE source = ?').run('test_live_accuracy'); invalidate('paypal.com'); }
});

function established(users) {
  const { db } = require('../server/lib/db');
  const weekAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  for (const u of users) db.prepare('UPDATE users SET created_at = ?, email_verified_at = ? WHERE email = ?').run(weekAgo, weekAgo, u.email);
}

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

