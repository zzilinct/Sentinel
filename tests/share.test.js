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
  // Each share under keys of its own, named by its time, as share.js reads them.
  assert.ok(sw.includes('`' + share.DATA + '/${at}`') && sw.includes('`/share/image/${at}`'));
  assert.ok(!sw.includes('box.delete('));
  const html = fs.readFileSync(path.join(ROOT, 'web', 'app.html'), 'utf8');
  assert.ok(html.indexOf('share.js') > 0 && html.indexOf('share.js') < html.indexOf('/app.js'));
});

/**
 * Cache Storage as browsers keep it: caches.delete(name) lets go of the name, and a Cache opened before keeps taking
 * writes that nothing can open again. The service worker holds its box open while it writes a share.
 */
function fakeCaches() {
  const named = new Map();
  let deletes = 0;
  const make = () => {
    const m = new Map();
    const url = (k) => new URL(typeof k === 'string' ? k : k.url, 'https://sentinel.test').href;
    return {
      put: async (k, res) => { m.set(url(k), await res.text()); },
      match: async (k) => (m.has(url(k)) ? new Response(m.get(url(k))) : undefined),
      delete: async (k) => m.delete(url(k)),
      keys: async () => [...m.keys()].map((u) => ({ url: u }))
    };
  };
  return {
    open: async (n) => { if (!named.has(n)) named.set(n, make()); return named.get(n); },
    delete: async (n) => { deletes++; return named.delete(n); },
    deletes: () => deletes
  };
}
const sharePut = async (c, text, at) => (await c.open('sentinel-share')).put(`/share/data/${at}`, new Response(JSON.stringify({ title: '', text, url: '', at })));

test('share: a page starting while a share arrives never empties the box; only an old share is emptied', async () => {
  const share = require('../web/assets/js/share.js');
  global.caches = fakeCaches();
  try {
    assert.equal(await share.waiting(), false);
    await sharePut(caches, 'hi', Date.now());
    assert.equal(await share.waiting(), true);
    assert.equal((await (await caches.open(share.BOX)).keys()).length, 1, 'a fresh share is left where it is');
    const box = await caches.open(share.BOX);
    for (const k of await box.keys()) await box.delete(k);
    await sharePut(caches, 'old', Date.now() - 31 * 60 * 1000);
    assert.equal(await share.waiting(), false);
    assert.equal((await box.keys()).length, 0, 'an old share is emptied out');
    assert.equal(caches.deletes(), 0, 'the box itself is never deleted');
  } finally {
    delete global.caches;
  }
});

test('share: a page opened for one share leaves a newer share for its own page, and takes its own', async () => {
  const share = require('../web/assets/js/share.js');
  global.caches = fakeCaches();
  try {
    const first = Date.now() - 50;
    const second = Date.now();
    await sharePut(caches, 'Second share', second);
    assert.deepEqual(await share.take(first), { newer: true });
    assert.equal((await (await caches.open(share.BOX)).keys()).length, 1, 'the second share is still waiting for its own page');
    assert.equal((await share.take(second)).text, 'Second share');
    assert.equal((await (await caches.open(share.BOX)).keys()).length, 0);
    // A page that does not know its share (a GET share, or back from signing in) takes whatever is waiting.
    await share.put({ text: 'Any' });
    assert.equal((await share.take()).text, 'Any');
  } finally {
    delete global.caches;
  }
});

test('share: two shares a moment apart, the first page taking its own while the second is written: the second still reaches its page', async () => {
  // verify-web run 44948767446: the first share's page emptied the box while the service worker was writing the second,
  // and the second share's page found nothing.
  const share = require('../web/assets/js/share.js');
  global.caches = fakeCaches();
  try {
    const first = Date.now() - 40;
    await sharePut(caches, 'First share', first);
    const writing = await caches.open(share.BOX);   // the service worker, with the second share's form in hand
    assert.equal((await share.take(first)).text, 'First share');
    const second = Date.now();
    await writing.put(`/share/data/${second}`, new Response(JSON.stringify({ title: '', text: 'Second share', url: '', at: second })));
    const got = await share.take(second);
    assert.ok(got, 'the second share was there for its page');
    assert.equal(got.text, 'Second share');
    // A picture keeps its own key beside its words, and goes with them.
    await writing.put(`/share/image/${second + 1}`, new Response('png'));
    await sharePut(caches, '', second + 1);
    const pic = await share.take(second + 1);
    assert.ok(pic.image);
    assert.equal((await writing.keys()).length, 0);
  } finally {
    delete global.caches;
  }
});
