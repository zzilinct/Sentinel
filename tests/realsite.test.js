'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../server/lib/db');
const mySites = require('../server/lib/scan/mysites');
const engine = require('../server/lib/scan/engine');

let n = 0;
function newUser() {
  const id = `usr_${String(++n).padStart(20, '0')}real`;
  db.prepare('INSERT INTO users (id, email, first_name, created_at) VALUES (?, ?, ?, ?)').run(id, `realsite${n}@example.com`, 'Test', Date.now());
  return id;
}
const real = async (url, opts) => (await engine.scanUrl(url, { mode: 'live', detail: 'compact', ...opts })).realSite;

test('a look-alike of a brand leads to the brand\'s own address, never one built from the page', async () => {
  assert.deepEqual(await real('https://paypa1-secure-login.com/account/verify?next=https://evil.example/'), { host: 'paypal.com', url: 'https://paypal.com/' });
  assert.deepEqual(await real('https://paypal-account-verify-login.top/signin'), { host: 'paypal.com', url: 'https://paypal.com/' });
  assert.deepEqual(await real('https://netflix-billing-update.top/pay'), { host: 'netflix.com', url: 'https://netflix.com/' });
});

test('nothing for a generic warning, a clean page or the real site', async () => {
  assert.equal(await real('https://crypto-doubler-elon.live/'), null, 'a listed scam that imitates no brand');
  assert.equal(await real('https://www.paypal.com/signin'), null);
  assert.equal(await real('https://www.wikipedia.org/'), null);
});

test('a look-alike of one of the person\'s own sites leads to that site', async () => {
  const user = newUser();
  mySites.add(user, 'harbourcu.org');
  assert.deepEqual(await real('https://harbourcu-secure-login.com/', { userId: user }), { host: 'harbourcu.org', url: 'https://harbourcu.org/' });
  assert.equal(await real('https://harbourcu-secure-login.com/', { userId: newUser() }), null, 'someone else\'s list is not yours');
});

test('a site the person trusts gets no button', async () => {
  const user = newUser();
  db.prepare('INSERT INTO overrides (user_id, host, action, created_at) VALUES (?, ?, ?, ?)').run(user, 'paypal-account-verify-login.top', 'allow', Date.now());
  assert.equal(await real('https://paypal-account-verify-login.top/signin', { userId: user }), null);
});
