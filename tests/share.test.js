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

test('share: a very long share is cut to what the text scan reads', () => {
  const r = route({ text: 'scam '.repeat(20000) });
  assert.equal(r.kind, 'text');
  assert.ok(r.text.length <= 40000);
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
