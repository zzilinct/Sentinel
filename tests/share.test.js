'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { route } = require('../web/assets/js/share.js');

const ROOT = path.join(__dirname, '..');

test('share: a link alone goes to the link scan, wherever the app put it', () => {
  // Chrome on Android: the page title and its address.
  assert.deepEqual(route({ title: 'PayPal: Log in', url: 'https://paypa1-secure-login.com/account' }), { kind: 'link', url: 'https://paypa1-secure-login.com/account' });
  // Apps that put the address in text.
  assert.deepEqual(route({ text: 'https://usps-redeliver.top/pay' }), { kind: 'link', url: 'https://usps-redeliver.top/pay' });
  assert.deepEqual(route({ text: '  paypa1-secure-login.com/account \n' }), { kind: 'link', url: 'paypa1-secure-login.com/account' });
  assert.deepEqual(route({ title: 'x.example', text: 'x.example', url: 'https://x.example/' }), { kind: 'link', url: 'https://x.example/' });
  assert.deepEqual(route({ text: 'https://a.example/x', url: 'https://a.example/x' }), { kind: 'link', url: 'https://a.example/x' });
});

test('share: words go to the text scan, with the link kept in them', () => {
  const sms = 'USPS: Your package is on hold. Pay the $1.99 fee at https://usps-redeliver.top/pay';
  assert.deepEqual(route({ text: sms }), { kind: 'text', text: sms });
  // A link sent beside the words, not in them, is added so it is checked too.
  assert.deepEqual(route({ text: 'Is this real?', url: 'https://usps-redeliver.top/pay' }), { kind: 'text', text: 'Is this real?\nhttps://usps-redeliver.top/pay' });
  // An email's subject comes first when the words lack it; a title already in the words is not repeated.
  assert.deepEqual(route({ title: 'Account suspended', text: 'Verify your account now' }), { kind: 'text', text: 'Account suspended\nVerify your account now' });
  assert.deepEqual(route({ title: 'Hi', text: 'Hi mum, I lost my phone' }), { kind: 'text', text: 'Hi mum, I lost my phone' });
  // One word that is not a link, and a sentence with a dot, are words.
  assert.equal(route({ text: 'Thanks.' }).kind, 'text');
  assert.equal(route({ text: 'Call me back. Now' }).kind, 'text');
});

test('share: a picture goes to the screenshot reader, and an empty share opens nothing', () => {
  assert.deepEqual(route({ text: 'look', image: true }), { kind: 'image' });
  assert.deepEqual(route({}), { kind: 'empty' });
  assert.deepEqual(route({ title: '  ', text: '', url: '' }), { kind: 'empty' });
  assert.deepEqual(route(), { kind: 'empty' });
});

test('share: a long share is kept whole for the text scan, which reads its start and newest part (QA 1.18: its end was cut off)', () => {
  const sms = 'USPS: pay the redelivery fee at https://usps-redeliver.top/pay';
  const long = `${'Hi, how was your day? '.repeat(5000)}\n${sms}`;
  const r = route({ text: long });
  assert.equal(r.kind, 'text');
  assert.equal(r.text, long);
  // Past what is kept: its start and its end, so the newest messages are still there.
  const huge = `${'start '.repeat(100000)}${sms}`;
  const h = route({ text: huge });
  assert.ok(h.text.length <= 400000);
  assert.ok(h.text.startsWith('start start'));
  assert.ok(h.text.endsWith(sms));
});

test('share: the manifest, the service worker and the server agree on the share target', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'manifest.webmanifest'), 'utf8'));
  const t = m.share_target;
  assert.equal(t.action, '/app/share');
  assert.equal(t.method, 'POST');
  assert.equal(t.enctype, 'multipart/form-data');
  assert.deepEqual([t.params.title, t.params.text, t.params.url], ['title', 'text', 'url']);
  assert.equal(t.params.files[0].name, 'image');
  const sw = fs.readFileSync(path.join(ROOT, 'web', 'sw.js'), 'utf8');
  assert.match(sw, /form\.getAll\('image'\)/);
  assert.match(sw, /url\.pathname === '\/app\/share'/);
  // The share box survives a new service worker version.
  assert.match(sw, /k !== VERSION && k !== SHARE/);
  const share = require('../web/assets/js/share.js');
  assert.match(sw, new RegExp(`'${share.BOX}'`));
  assert.ok(sw.includes(`'${share.DATA}'`) && sw.includes(`'${share.IMAGE}'`));
  const html = fs.readFileSync(path.join(ROOT, 'web', 'app.html'), 'utf8');
  assert.ok(html.indexOf('share.js') > 0 && html.indexOf('share.js') < html.indexOf('/app.js'));
});

test('share: a page starting while a share arrives never empties the box; only an old share is emptied', async () => {
  const share = require('../web/assets/js/share.js');
  const store = new Map();
  let deleted = 0;
  global.caches = {
    open: async () => ({ match: async (k) => (store.has(k) ? new Response(store.get(k)) : undefined) }),
    delete: async () => { deleted++; store.clear(); return true; }
  };
  try {
    // Nothing there yet (the service worker is still writing it): nothing is deleted.
    assert.equal(await share.waiting(), false);
    assert.equal(deleted, 0);
    store.set(share.DATA, JSON.stringify({ text: 'hi', at: Date.now() }));
    assert.equal(await share.waiting(), true);
    assert.equal(deleted, 0);
    store.set(share.DATA, JSON.stringify({ text: 'old', at: Date.now() - 31 * 60 * 1000 }));
    assert.equal(await share.waiting(), false);
    assert.equal(deleted, 1);
  } finally {
    delete global.caches;
  }
});
