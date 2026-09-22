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

