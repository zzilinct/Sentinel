'use strict';
// Download my data: the person's own rows, one entry per row of the Privacy Policy's "What an account stores", no
// secret, and only with the password. And a false alarm report never counts against the site it is about.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { client, startApp } = require('./fixtures');

let app;
test.before(async () => { app = await startApp(); });
test.after(() => app.server.close());

let n = 0;
async function newUser() {
  const c = client(app.base);
  const email = `export${++n}_${Date.now()}@example.com`;
  await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'Ada', lastName: '', ageConfirmed: true, termsAccepted: true });
  assert.equal((await c.post('/api/v1/auth/login', { email, password: 'Correct-Horse-42' })).status, 200);
  c.email = email;
  return c;
}

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/** The "What" column of section 3 of the Privacy Policy, row by row. */
function policyRows() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'privacy.html'), 'utf8');
  const table = html.split('What an account stores</h2>')[1].split('</table>')[0];
  return [...table.matchAll(/<tr><td>(.*?)<\/td>/g)].map((m) => decode(m[1]));
}

test('the export holds exactly the rows the Privacy Policy says an account stores, plus the Windows-app memories it describes', async () => {
  const c = await newUser();
  await c.post('/api/v1/sites/override', { url: 'https://example.org', action: 'allow' });
  const r = await c.post('/api/v1/account/export', { password: 'Correct-Horse-42' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.headers.get('content-disposition'), /attachment; filename="sentinel-data-\d{4}-\d{2}-\d{2}\.json"/);
  const what = r.data.held.map((h) => h.what.replace(/'/g, '’'));
  const policy = policyRows();
  assert.ok(policy.length >= 10, 'the policy table was found');
  assert.deepEqual(what.slice(0, policy.length), policy, 'the export and the policy list the same things in the same order');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'privacy.html'), 'utf8');
  for (const extra of what.slice(policy.length)) assert.ok(html.includes(`<b>${extra}.</b>`), `the policy describes ${extra}`);
  const held = Object.fromEntries(r.data.held.map((h) => [h.what, h.data]));
  assert.equal(held['Email address, first name, optional last name'].email, c.email);
  assert.deepEqual(held['Sites you have trusted or blocked'].map((s) => [s.host, s.action]), [['example.org', 'allow']]);
});

test('the export carries no secret and none of anyone else', async () => {
  const other = await newUser();
  await other.post('/api/v1/sites/override', { url: 'https://other-person.example', action: 'block' });
  const c = await newUser();
  const r = await c.post('/api/v1/account/export', { password: 'Correct-Horse-42' });
  const text = JSON.stringify(r.data);
  for (const secret of ['password_hash', 'token_hash', 'totp_secret', 'key_cipher', '$scrypt', 'Correct-Horse-42']) assert.ok(!text.includes(secret), secret);
  assert.ok(!text.includes(other.email) && !text.includes('other-person.example'), 'another account leaked into the export');
  assert.deepEqual(JSON.parse(text).held.find((h) => h.what.startsWith('Password')).data, { set: true });
});

test('the export needs the password, and a signed-out call gets nothing', async () => {
  const c = await newUser();
  assert.equal((await c.post('/api/v1/account/export', { password: 'wrong-password-1' })).status, 401);
  assert.equal((await c.post('/api/v1/account/export', {})).status, 401);
  assert.equal((await client(app.base).post('/api/v1/account/export', { password: 'Correct-Horse-42' })).status, 401);
});

test('a false alarm report is kept, and never counts toward condemning the site', async () => {
  const { db } = require('../server/lib/db');
  const weekAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  for (let k = 0; k < 3; k++) {
    const c = await newUser();
    db.prepare('UPDATE users SET created_at = ?, email_verified_at = ? WHERE email = ?').run(weekAgo, weekAgo, c.email);
    const r = await c.post('/api/v1/report', { url: 'https://safe-bakery.example/menu', category: 'false_alarm', note: 'My local bakery' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.promoted, false);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reports WHERE host = 'safe-bakery.example' AND category = 'false_alarm'").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocklist WHERE host = 'safe-bakery.example'").get().n, 0);
  const { analyze } = require('../server/lib/scan/url');
  const known = await require('../server/lib/scan/knowledge').lookup(analyze('https://safe-bakery.example/menu'), { useSafeBrowsing: false });
  assert.equal(known.reports, 0, 'a false alarm reads as a report against the site');
  assert.ok(!known.matches.some((m) => m.source === 'community'));
});
