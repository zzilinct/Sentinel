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

test('on one of the newest three models, Pro has slightly smaller allowances; Max and Ultimate keep theirs', async () => {
  published(own, '1.8.8', '1.8.7', '1.8.6');
  const usage = async (plan) => (await (await signedIn(plan)).get('/api/v1/account/usage')).data.plan.limits;
  assert.deepEqual(await usage('pro'), { linkScans: 30, fileScans: 30, liveMinutes: 180, fastMinutes: 1080 });
  assert.deepEqual(await usage('max'), { linkScans: 100, fileScans: 100, liveMinutes: 1440, fastMinutes: null });
  assert.deepEqual(await usage('ultimate'), { linkScans: 500, fileScans: 500, liveMinutes: 5760, fastMinutes: null });
});

test('an older model keeps the plans as they were', async () => {
  published(bump(own, 3), bump(own, 2), bump(own, 1), own);
  const c = await signedIn('pro');
  assert.deepEqual((await c.get('/api/v1/account/usage')).data.plan.limits, { linkScans: 40, fileScans: 40, liveMinutes: 240, fastMinutes: 1440 });
});

test('the free plan is shut out of the newest five only once a free model would stay put', async () => {
  // The newest free model predates model choice (it would update itself back): free keeps working.
  published(own, '1.9.1', '1.9.0', '1.8.9', '1.8.8', '1.8.7');
  const free = await signedIn('free');
  assert.equal((await free.post('/api/v1/scan/link', { url: 'https://example.com/' })).status, 200);
  // Once there is a free model that keeps the choice (1.9.2 and later, so this needs a copy newer than 1.9.2), this
  // copy among the five newest is paid only.
  if (models._test.cmp(own, '1.9.2') <= 0) return;
  published(bump(own, 4), bump(own, 3), bump(own, 2), bump(own, 1), own, '1.9.2');
  const locked = await free.post('/api/v1/scan/link', { url: 'https://example.com/' });
  assert.equal(locked.status, 403);
  assert.equal(locked.data.error.code, 'model_requires_plan');
  // As the sixth newest, this copy is the free model again.
  published(bump(own, 5), bump(own, 4), bump(own, 3), bump(own, 2), bump(own, 1), own);
  assert.equal((await free.post('/api/v1/scan/link', { url: 'https://example.com/' })).status, 200);
});

test('once a free model would stay put, the newest five are marked Pro and up for free accounts', async () => {
  published('9.9.5', '9.9.4', '9.9.3', '9.9.2', '9.9.1', '9.9.0', own);
  const versions = (await (await signedIn('free')).get('/api/v1/models')).data.categories.flatMap((c) => c.versions);
  const v = (x) => versions.find((r) => r.version === x);
  assert.deepEqual(['9.9.5', '9.9.4', '9.9.3', '9.9.2', '9.9.1'].map((x) => v(x).available), [false, false, false, false, false]);
  assert.equal(v('9.9.0').available, true);
  const pro = (await (await signedIn('pro')).get('/api/v1/models')).data.categories.flatMap((c) => c.versions);
  assert.ok(pro.filter((r) => r.paidOnly).every((r) => r.available));
});

test('the picker lists models by category, and marks the newest three for the free plan', async () => {
  published(own, '1.8.8', '1.8.7', '1.8.6');
  const free = await signedIn('free');
  const r = await free.get('/api/v1/models');
  assert.equal(r.status, 200);
  assert.equal(r.data.current.version, own);
  const argus = r.data.categories.find((c) => c.name === 'Argus');
  assert.ok(argus && argus.versions.length >= 4);
  assert.deepEqual(argus.versions.slice(0, 3).map((v) => v.newest), [true, true, true]);
  assert.equal(argus.versions[3].newest, false);
  assert.ok(argus.versions.find((v) => v.version === own).current);
});
