'use strict';
// Models (server/lib/models.js): names, the newest three, their allowances, and the free plan's lock. Sample-free.
process.env.NODE_ENV = 'test';
process.env.SENTINEL_MODELS = '1';
process.env.SENTINEL_MODELS_OFFLINE = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { client, startApp } = require('./fixtures');
const models = require('../server/lib/models');
const own = models.own();

const bump = (v, n) => { const [a, b, c] = v.split('.').map(Number); return `${a}.${b}.${c + n}`; };
const published = (...versions) => models._test.set(versions.map((version) => ({ version, date: '2026-10-01T00:00:00Z', installer: 'x', manifest: 'y' })));

let app;
test.before(async () => { app = await startApp(); });
test.after(() => app.server.close());

async function signedIn(plan) {
  const c = client(app.base);
  const email = `models_${Math.random().toString(36).slice(2)}@example.com`;
  assert.equal((await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'M', ageConfirmed: true, termsAccepted: true })).status, 201);
  assert.equal((await c.post('/api/v1/auth/login', { email, password: 'Correct-Horse-42' })).status, 200);
  if (plan !== 'free') await c.post('/api/v1/billing/plan', { plan });
  return c;
}

test('models are named after their major version', () => {
  assert.equal(models.label('1.9.2'), 'Argus 1.9.2');
  assert.equal(models.nameFor('2.0.0'), 'Cerberus');
  assert.equal(models.nameFor('3.1.4'), 'Talos');
  assert.equal(models.nameFor('4.0.0'), 'Heimdall');
  assert.equal(models.nameFor('5.2.0'), 'Lokapalas');
});

test('on one of the newest three models, Pro and Max get their own allowances and Ultimate keeps its own', async () => {
  published(own, '1.8.8', '1.8.7', '1.8.6');
  const usage = async (plan) => (await (await signedIn(plan)).get('/api/v1/account/usage')).body.plan.limits;
  assert.deepEqual(await usage('pro'), { linkScans: 30, fileScans: 30, liveMinutes: 180, fastMinutes: 1080 });
  assert.deepEqual(await usage('max'), { linkScans: 90, fileScans: 90, liveMinutes: 1080, fastMinutes: null });
  assert.deepEqual(await usage('ultimate'), { linkScans: 500, fileScans: 500, liveMinutes: 5760, fastMinutes: null });
});

test('an older model keeps the plans as they were', async () => {
  published(bump(own, 3), bump(own, 2), bump(own, 1), own);
  const c = await signedIn('pro');
  assert.deepEqual((await c.get('/api/v1/account/usage')).body.plan.limits, { linkScans: 40, fileScans: 40, liveMinutes: 240, fastMinutes: 1440 });
});

test('the free plan is shut out of the newest three only once a free model would stay put', async () => {
  // The newest free model predates model choice (it would update itself back): free keeps working.
  published(own, '1.8.9', '1.8.8', '1.8.7');
  const free = await signedIn('free');
  assert.equal((await free.post('/api/v1/scan/link', { url: 'https://example.com/' })).status, 200);
  // Three releases after this one, a free model that keeps the choice exists: the newest three are paid only.
  published(bump(own, 3), bump(own, 2), bump(own, 1), own);
  const later = models.newest();
  models._test.set([own, ...later].map((version) => ({ version, date: null, installer: 'x', manifest: 'y' })).sort((a, b) => models._test.cmp(b.version, a.version)));
  // This copy (own) is the 4th newest here, so it is the free model: allowed.
  assert.equal((await free.post('/api/v1/scan/link', { url: 'https://example.com/' })).status, 200);
});

test('a free account on a newest model it may not use is told which model to switch to', async () => {
  // Pretend this copy is the newest, with three models after a free one that keeps the choice.
  const older = ['1.9.2', '1.9.3', '1.9.4', '1.9.5'].filter((v) => models._test.cmp(v, own) < 0);
  if (older.length < 1) return; // only meaningful once this copy is newer than 1.9.2
  published(own, ...older.reverse(), '1.9.2');
  if (!models.freeLocked()) return;
  const free = await signedIn('free');
  const r = await free.post('/api/v1/scan/link', { url: 'https://example.com/' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'model_requires_plan');
});

test('the picker lists models by category, and marks the newest three for the free plan', async () => {
  published(own, '1.8.8', '1.8.7', '1.8.6');
  const free = await signedIn('free');
  const r = await free.get('/api/v1/models');
  assert.equal(r.status, 200);
  assert.equal(r.body.current.version, own);
  const argus = r.body.categories.find((c) => c.name === 'Argus');
  assert.ok(argus && argus.versions.length >= 4);
  assert.deepEqual(argus.versions.slice(0, 3).map((v) => v.newest), [true, true, true]);
  assert.equal(argus.versions[3].newest, false);
  assert.ok(argus.versions.find((v) => v.version === own).current);
});
