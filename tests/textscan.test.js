'use strict';
process.env.NODE_ENV = 'test';
process.env.RESEARCH_ALLOW_PRIVATE = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startFixtureServer, applyFacts, client, startApp } = require('./fixtures');
const shot = require('../web/assets/js/textshot.js');

/* ------------------------------------------------- reading a phone screenshot */

test('screenshot: an iPhone text keeps the sender and the message, not the phone\'s own words', () => {
  const r = shot.read(['9:41', '5G 87', '<', '+1 (415) 555-0199 >', 'Text Message', 'Today 10:32 AM',
    'USPS: Your package is on hold due to an', 'unpaid redelivery fee of $1.99. Pay at', 'https://usps-redeliver.top/pay',
    'If you did not expect this message from an unknown sender, it could be from someone trying to scam you.',
    'Delivered', 'Text Message'].join('\n'));
  assert.equal(r.from, '+1 (415) 555-0199');
  assert.equal(r.text, 'USPS: Your package is on hold due to an\nunpaid redelivery fee of $1.99. Pay at\nhttps://usps-redeliver.top/pay');
});

test('screenshot: Android, WhatsApp and a short code', () => {
  const android = shot.read(['10:32 ▼▲ 87%', '←', '72975', 'Today • 10:32 AM', 'Your toll balance is overdue. Pay now at ezpass-toll-pay.com/x', '10:32 AM', 'RCS message'].join('\n'));
  assert.equal(android.from, '72975');
  assert.equal(android.text, 'Your toll balance is overdue. Pay now at ezpass-toll-pay.com/x');
  const wa = shot.read(['Emma', 'online', 'Messages and calls are end-to-end encrypted. No one outside of this chat can read them.', 'Hi Mum, this is my new number', '10:31', 'Can you send me money for a bill today?', '10:31', 'Message'].join('\n'));
  assert.equal(wa.from, 'Emma');
  assert.equal(wa.text, 'Hi Mum, this is my new number\nCan you send me money for a bill today?');
});

test('screenshot: a message is never taken for its sender', () => {
  assert.deepEqual(shot.read('Hi Mum\nthis is my new number'), { from: '', text: 'Hi Mum\nthis is my new number' });
  assert.equal(shot.read('Your USPS package is waiting for you now. Track at usps-help.top/a').from, '');
  assert.equal(shot.read('Sent you the money, check now').text, 'Sent you the money, check now', 'a message that starts like a label stays');
  assert.equal(shot.read('Monica\nAre you free Friday?').from, 'Monica', 'a name that starts like a weekday is still a name');
});

/* ---------------------------------------------------------- the server route */

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
  const email = `texter${++n}_${Date.now()}@example.com`;
  assert.equal((await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'Test', lastName: '', ageConfirmed: true, termsAccepted: true })).status, 201);
  assert.equal((await c.post('/api/v1/auth/login', { email, password: 'Correct-Horse-42' })).status, 200);
  if (plan !== 'free') assert.equal((await c.post('/api/v1/billing/plan', { plan })).status, 200);
  return c;
}

test('text scan: a scam text is flagged on the free plan, and counts as one fast link scan', async () => {
  const c = await newUser();
  const r = await c.post('/api/v1/scan/text', { from: '+1 (415) 555-0199', text: 'USPS: Your package is on hold due to an unpaid redelivery fee of $1.99. Pay at https://usps-redeliver.top/pay' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.text.flag.level, 'danger');
  assert.equal(r.data.text.sender, 'number');
  assert.deepEqual(r.data.text.links.map((l) => l.url), ['https://usps-redeliver.top/pay']);
  assert.equal(r.data.usage.linkScans.used, 1);
  assert.equal(r.data.usage.deepScans.used, 0, 'no research, so never a delicate scan');
});

test('text scan: family on a new number, an ordinary text, and a link on a threat list', async () => {
  const c = await newUser('pro');
  const mum = await c.post('/api/v1/scan/text', { from: '', text: 'Hi Mum, this is my new number, my phone broke. Can you send me money for a bill today?' });
  assert.equal(mum.data.text.flag.level, 'danger');
  assert.equal(mum.data.text.flag.title, 'Someone may be pretending to be family');
  assert.equal((await c.post('/api/v1/scan/text', { from: 'Mom', text: 'can you pick me up at 5' })).data.text.flag, null);
  const listed = await c.post('/api/v1/scan/text', { from: '+1 917 555 0101', text: 'Your order is ready, details at https://paypa1-secure-login.com/' });
  assert.ok(listed.data.text.flag, 'the link alone makes the text a warning');
  assert.ok(['red', 'orange'].includes(listed.data.text.links[0].badge), JSON.stringify(listed.data.text.links));
  assert.equal(listed.data.text.links[0].host, 'paypa1-secure-login.com');
  assert.equal(listed.data.usage.linkScans.used, 3);
});

test('text scan: an empty text costs nothing, and nothing about a text is kept', async () => {
  const c = await newUser();
  const empty = await c.post('/api/v1/scan/text', { from: '12345', text: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.error.code, 'empty_text');
  await c.post('/api/v1/scan/text', { from: '+1 917 555 0101', text: 'Your order is ready, details at https://paypa1-secure-login.com/' });
  const me = await c.get('/api/v1/auth/me');
  assert.equal(me.data.usage.linkScans.used, 1);
  const history = await c.get('/api/v1/account/history');
  assert.equal(history.data.items.length, 0, 'not in the history, not even its flagged link');
  assert.equal((await client(app.base).post('/api/v1/scan/text', { text: 'hi' })).status, 401, 'signed in only');
});

test('text scan: the weekly fast scans run out like link scans do', async () => {
  const c = await newUser();
  for (let i = 0; i < 10; i++) assert.equal((await c.post('/api/v1/scan/text', { text: `see you at ${i}` })).status, 200);
  const over = await c.post('/api/v1/scan/text', { text: 'see you later' });
  assert.equal(over.status, 429);
  assert.equal(over.data.error.code, 'weekly_limit_reached');
});
