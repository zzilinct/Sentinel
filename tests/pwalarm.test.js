'use strict';
/**
 * Password alarm (extension/src/lib/pwalarm.js, the worker's pw-* messages, content/pwalarm.js): a password learned on
 * its own sign-in site raises the alarm anywhere else, only a hash is ever stored, and only the right senders can
 * change what is protected.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'extension', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const flat = (rel) => read(rel).replace(/^import\s+[^;]+;\s*$/gm, '').replace(/^export\s+(?=(const|let|function|class|async)\b)/gm, '');

function lib() {
  const ctx = { crypto: globalThis.crypto, TextEncoder, URL, btoa, atob, Uint8Array };
  vm.createContext(ctx);
  vm.runInContext(`${flat('lib/pwalarm.js')}; this.L = { PRESETS, MIN_LENGTH, isHome, bankDomain, newSalt, hashPassword, sameHash, homeAccount, guardedHere };`, ctx);
  return ctx.L;
}

test('a password belongs on its sign-in hosts, not on every host a brand owns', () => {
  const L = lib();
  const google = L.PRESETS.find((p) => p.id === 'google').homes;
  assert.equal(L.isHome('accounts.google.com', google), true);
  assert.equal(L.isHome('accounts.google.com.evil.top', google), false);
  assert.equal(L.isHome('sites.google.com', google), false, 'anyone can publish on Google Sites');
  assert.equal(L.isHome('xyz.googleusercontent.com', google), false);
  const ms = L.PRESETS.find((p) => p.id === 'microsoft').homes;
  assert.equal(L.isHome('login.microsoftonline.com', ms), true);
  assert.equal(L.isHome('evil.sharepoint.com', ms), false);
  assert.equal(L.isHome('x.blob.core.windows.net', ms), false);
  const amazon = L.PRESETS.find((p) => p.id === 'amazon').homes;
  assert.equal(L.isHome('www.amazon.co.uk', amazon), true);
  assert.equal(L.isHome('bucket.s3.amazonaws.com', amazon), false);
});

test('a bank is its own domain, and never an ending or a host anyone can publish on', () => {
  const L = lib();
  assert.equal(L.bankDomain('https://www.chase.com/login?x=1'), 'chase.com');
  assert.equal(L.bankDomain('Online.TD.com'), 'online.td.com');
  for (const bad of ['', 'com', 'co.uk', 'bank', 'not a domain', 'mybank.github.io', 'x.netlify.app', 'evil.blob.core.windows.net']) {
    assert.equal(L.bankDomain(bad), null, bad);
  }
});

test('the same password hashes the same with its salt, and a different one does not', async () => {
  const L = lib();
  const salt = L.newSalt();
  const a = await L.hashPassword('correct horse battery', salt);
  assert.equal(L.sameHash(a, await L.hashPassword('correct horse battery', salt)), true);
  assert.equal(L.sameHash(a, await L.hashPassword('correct horse batterz', salt)), false);
  assert.notEqual(a, await L.hashPassword('correct horse battery', L.newSalt()), 'a new salt gives a new hash');
});

/** The real worker, flattened as for Firefox, with a browser that keeps storage in memory. */
/** A storage area kept in a plain object. */
const area = (store) => ({
  get: async (k) => { const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k || {}); return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, JSON.parse(JSON.stringify(store[x]))])); },
  set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
  remove: async (k) => { delete store[k]; }
});

/** The worker; pass the storage of an earlier one to start it again, as the browser does after it idles. */
function worker(store = {}, session = {}) {
  const sent = [];
  const noop = () => {};
  const listener = { addListener: noop };
  const ext = {
    runtime: { id: 'me', getURL: (p) => `chrome-extension://me/${p}`, getManifest: () => ({ content_scripts: [], version: '1' }), onMessage: listener, onMessageExternal: listener, onInstalled: listener, onStartup: listener, lastError: null },
    storage: {
      local: area(store),
      session: area(session),
      sync: { get: async (d) => ({ ...d }), set: async () => {} },
      onChanged: listener
    },
    tabs: { sendMessage: async (tabId, msg, opts) => { sent.push({ tabId, msg, opts }); }, get: async () => null, create: noop, query: async () => [], onRemoved: listener, onActivated: listener },
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setTitle: noop },
    alarms: { create: noop, onAlarm: listener },
    contextMenus: { create: noop, onClicked: listener },
    notifications: { create: noop },
    webNavigation: { onCommitted: listener, onCompleted: listener, onHistoryStateUpdated: listener, onReferenceFragmentUpdated: listener },
    permissions: { contains: async () => true }
  };
  const ctx = { chrome: ext, crypto: globalThis.crypto, TextEncoder, URL, btoa, atob, Uint8Array, AbortController, setTimeout, clearTimeout, console, Promise,
    fetch: async () => { throw new Error('offline'); } };
  vm.createContext(ctx);
  const code = [flat('lib/brand.js'), flat('lib/api.js'), flat('lib/pwalarm.js'), flat('background.js')].join('\n');
  vm.runInContext(`${code}\n;this.handlers = handlers;`, ctx);
  const page = (url, tabId = 7) => ({ id: 'me', url, tab: { id: tabId, url } });
  const options = { id: 'me', url: 'chrome-extension://me/src/options.html', tab: { id: 1, url: 'chrome-extension://me/src/options.html' } };
  // Answers come from another realm: compared as plain data.
  const call = async (type, msg, sender) => JSON.parse(JSON.stringify(await ctx.handlers[type]({ type, ...msg }, sender)));
  return { store, session, sent, call, page, options };
}

test('learn on the sign-in site, alarm on a look-alike, never store the password', async () => {
  const w = worker();
  await w.call('pw-set', { id: 'google', on: true }, w.options);
  assert.deepEqual(await w.call('pw-config', {}, w.page('https://accounts.google.com/signin')), { learn: true, lengths: [], tell: null });
  assert.deepEqual(await w.call('pw-learn', { password: 'hunter2hunter2' }, w.page('https://accounts.google.com/signin')), { learned: true });
  assert.doesNotMatch(JSON.stringify(w.store), /hunter2/, 'only the hash is kept');

  const evil = w.page('https://accounts-google.com.verify-login.top/');
  assert.deepEqual((await w.call('pw-config', {}, evil)).lengths, [14]);
  assert.deepEqual(await w.call('pw-check', { password: 'something-else!' }, evil), { match: null });
  assert.deepEqual(await w.call('pw-check', { password: 'hunter2hunter2' }, evil), { match: { name: 'Google' } });
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].msg.type, 'sentinel:pw-alarm');
  assert.equal(w.sent[0].msg.host, 'accounts-google.com.verify-login.top');
  assert.equal(w.sent[0].opts.frameId, 0, 'the alarm is shown by the top frame');

  // At home it is never checked; a password learned on a look-alike would be worthless, so learning there does nothing.
  assert.deepEqual(await w.call('pw-check', { password: 'hunter2hunter2' }, w.page('https://accounts.google.com/x')), { match: null });
  assert.deepEqual(await w.call('pw-learn', { password: 'attacker-chosen' }, evil), { learned: false });
});

test('the first password learned for an account is said once, in the top frame of the tab it was learned in', async () => {
  const w = worker();
  await w.call('pw-set', { id: 'google', on: true }, w.options);
  const top = (url, tabId = 7) => ({ ...w.page(url, tabId), frameId: 0 });
  await w.call('pw-learn', { password: 'hunter2hunter2' }, top('https://accounts.google.com/signin'));
  assert.equal((await w.call('pw-config', {}, top('https://accounts.google.com/signin'))).tell, 'Google');
  assert.equal((await w.call('pw-config', {}, top('https://mail.google.com/', 7))).tell, 'Google', 'still said on the page the sign-in moved on to');
  assert.equal((await w.call('pw-config', {}, { ...w.page('https://accounts.google.com/frame'), frameId: 3 })).tell, null, 'not in a frame');
  assert.equal((await w.call('pw-config', {}, top('https://example.com/', 9))).tell, null, 'not in another tab');
  assert.deepEqual(await w.call('pw-told', {}, top('https://mail.google.com/')), { told: true });
  assert.equal((await w.call('pw-config', {}, top('https://mail.google.com/'))).tell, null, 'said once');
  await w.call('pw-learn', { password: 'second-account-pw' }, top('https://accounts.google.com/signin'));
  assert.equal((await w.call('pw-config', {}, top('https://accounts.google.com/signin'))).tell, null, 'a second password is not news');
});

test('"I use this password here on purpose" allows only the host the alarm was raised on, and settings come only from the options page', async () => {
  const w = worker();
  await w.call('pw-set', { id: 'paypal', on: true }, w.options);
  await w.call('pw-learn', { password: 'pa55word-pp' }, w.page('https://www.paypal.com/signin'));
  const other = w.page('https://shop.example/checkout', 9);
  assert.deepEqual(await w.call('pw-allow', {}, other), { allowed: false }, 'no alarm on this tab, nothing to allow');
  await w.call('pw-check', { password: 'pa55word-pp' }, other);
  assert.deepEqual(await w.call('pw-allow', {}, other), { allowed: true });
  assert.deepEqual(await w.call('pw-check', { password: 'pa55word-pp' }, other), { match: null });
  assert.deepEqual((await w.call('pw-list', {}, w.options)).accounts[0].allowed, ['shop.example']);

  // A web page's content script cannot change what is protected or read the list.
  await assert.rejects(w.call('pw-forget', { id: 'paypal' }, other), /Not allowed/);
  await assert.rejects(w.call('pw-list', {}, other), /Not allowed/);
  assert.doesNotMatch(JSON.stringify(await w.call('pw-list', {}, w.options)), /hash|salt/, 'the options page never sees hashes');
  // Forgetting removes the hash with the account.
  await w.call('pw-forget', { id: 'paypal' }, w.options);
  assert.deepEqual(await w.call('pw-check', { password: 'pa55word-pp' }, w.page('https://shop.example/')), { match: null });
});

test('the page script empties the box on a match, and holds then replays a sign-in press while it checks', async () => {
  const handlers = {};
  let answer = null;
  const replies = [];
  const ext = {
    runtime: { id: 'me', sendMessage: (msg) => new Promise((resolve) => {
      if (msg.type === 'pw-config') resolve({ ok: true, learn: false, lengths: [8] });
      else replies.push(() => resolve(answer));
    }), onMessage: { addListener() {} } },
    storage: { onChanged: { addListener() {} } }
  };
  const win = { addEventListener: (type, fn) => { handlers[type] = fn; } };
  const ctx = { chrome: ext, window: win, document: { querySelectorAll: () => [] }, Event: class { constructor(type) { this.type = type; } }, WeakMap, Promise };
  win.top = win;
  vm.createContext(ctx);
  vm.runInContext(read('content/pwalarm.js'), ctx);
  await new Promise((r) => setImmediate(r));

  const events = [];
  const box = { tagName: 'INPUT', type: 'password', value: 'abcdefgh', form: null, dispatchEvent: (e) => events.push(e.type) };
  const ev = (target, extra = {}) => ({ composedPath: () => [target], target, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra });

  // A match: the box is emptied and the page is told.
  handlers.input(ev(box));
  answer = { ok: true, match: { name: 'Google' } };
  replies.shift()();
  await new Promise((r) => setImmediate(r));
  assert.equal(box.value, '');
  assert.deepEqual(events, ['input', 'change']);

  // No match: a submit pressed while the check runs is held, then sent.
  let submitted = 0;
  const form = { isConnected: true, requestSubmit: () => { submitted++; } };
  box.value = 'zzzzzzzz';
  handlers.input(ev(box));
  const submit = ev(form, { submitter: null });
  handlers.submit(submit);
  assert.equal(submit.prevented, true, 'held while the worker answers');
  answer = { ok: true, match: null };
  replies.shift()();
  await new Promise((r) => setImmediate(r));
  assert.equal(submitted, 1, 'replayed once nothing matched');
  assert.equal(box.value, 'zzzzzzzz');

  // A password of another length is never sent to the worker at all.
  box.value = 'short';
  handlers.input(ev(box));
  assert.equal(replies.length, 0);

  // "Show password" turns the box into plain text: it is still a password box.
  box.type = 'text';
  box.value = 'yyyyyyyy';
  handlers.input(ev(box));
  assert.equal(replies.length, 1, 'still checked after Show password');
  // Enter in a box with no form is the page's own key handler: never held, since it could not be replayed.
  const enter = ev(box, { key: 'Enter' });
  handlers.keydown(enter);
  assert.equal(enter.prevented, false);
  answer = { ok: true, match: null };
  replies.shift()();
  await new Promise((r) => setImmediate(r));
});

test('with nothing protected, a page never messages the worker', async () => {
  const asked = [];
  const ext = {
    runtime: { id: 'me', sendMessage: async (msg) => { asked.push(msg.type); return { ok: true, learn: false, lengths: [] }; }, onMessage: { addListener() {} } },
    storage: { local: { get: async () => ({ pwalarmOn: 0 }) }, onChanged: { addListener() {} } }
  };
  const ctx = { chrome: ext, window: { addEventListener() {} }, document: { querySelectorAll: () => [] }, WeakMap, WeakSet, Promise };
  ctx.window.top = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(read('content/pwalarm.js'), ctx);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, []);
});

test('"I use this password here on purpose" still works after the worker was stopped and started again', async () => {
  const w = worker();
  await w.call('pw-set', { id: 'google', on: true }, w.options);
  await w.call('pw-learn', { password: 'hunter2hunter2' }, w.page('https://accounts.google.com/'));
  assert.ok(w.store.pwalarmOn > 0, 'pages are told something is protected');
  const corp = w.page('https://sso.mycompany.example/', 5);
  await w.call('pw-check', { password: 'hunter2hunter2' }, corp);
  assert.match(w.sent[0].msg.recover, /\/recover\?happened=password$/, 'the alarm links to the recovery guide');
  const again = worker(w.store, w.session);   // the browser stopped the idle worker; a new one starts
  assert.deepEqual(await again.call('pw-allow', {}, corp), { allowed: true });
  assert.deepEqual(await again.call('pw-allow', {}, corp), { allowed: false }, 'once');
});

test('the last three passwords are kept per account, and AWS is not an Amazon sign-in site', async () => {
  const w = worker();
  await w.call('pw-set', { id: 'google', on: true }, w.options);
  const home = w.page('https://accounts.google.com/');
  for (const pw of ['first-account-pw', 'second-account', 'third-account-pw', 'second-account']) await w.call('pw-learn', { password: pw }, home);
  const hashes = w.store.pwalarm.accounts.google.hashes;
  assert.equal(hashes.length, 3, 'the same password signed in again is not kept twice');
  const evil = w.page('https://google-login.evil.top/');
  for (const pw of ['first-account-pw', 'second-account', 'third-account-pw']) {
    assert.deepEqual(await w.call('pw-check', { password: pw }, evil), { match: { name: 'Google' } }, pw);
  }
  await w.call('pw-learn', { password: 'fourth-account!' }, home);
  assert.deepEqual(await w.call('pw-check', { password: 'first-account-pw' }, evil), { match: null }, 'the oldest is let go');
  assert.ok((await w.call('pw-list', {}, w.options)).accounts[0].learnedAt, 'protected since');

  // A password kept before this change (one hash on the account) still counts.
  const L = lib();
  const salt = L.newSalt();
  const old = { accounts: { paypal: { id: 'paypal', name: 'PayPal', homes: ['paypal.com'], on: true, allowed: [], salt, hash: await L.hashPassword('old-style-pw', salt), length: 12, learnedAt: 1 } } };
  assert.equal(L.guardedHere(old, 'evil.top').length, 1);

  const amazon = L.PRESETS.find((p) => p.id === 'amazon');
  assert.equal(L.isHome('signin.aws.amazon.com', amazon.homes, amazon.except), false);
  assert.equal(L.isHome('www.amazon.com', amazon.homes, amazon.except), true);
  assert.equal(L.homeAccount({ accounts: { amazon: { id: 'amazon', on: true, homes: amazon.homes } } }, 'signin.aws.amazon.com'), null, 'an account saved before this change gets the preset\'s exception too');
});

test('the page says "Your Google password is now protected" quietly, in the top frame only, and tells the worker it was said', async () => {
  const run = async (top) => {
    const asked = [];
    const shown = [];
    const timers = [];
    const ext = {
      runtime: { id: 'me', sendMessage: async (msg) => { asked.push(msg.type); return { ok: true, learn: false, lengths: [14], tell: 'Google' }; }, onMessage: { addListener() {} } },
      storage: { onChanged: { addListener() {} } }
    };
    const win = { addEventListener() {} };
    win.top = top ? win : {};
    const ctx = { chrome: ext, window: win, document: { body: {}, querySelectorAll: () => [] }, WeakMap, WeakSet, Promise,
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
      SentinelAlarm: { show: (o) => { shown.push(o); return { close() {} }; } } };
    vm.createContext(ctx);
    vm.runInContext(read('content/pwalarm.js'), ctx);
    await new Promise((r) => setImmediate(r));
    for (const t of timers.sort((a, b) => a.ms - b.ms)) t.fn();
    await new Promise((r) => setImmediate(r));
    return { asked, shown };
  };
  const top = await run(true);
  assert.equal(top.shown.length, 1);
  assert.equal(top.shown[0].title, 'Your Google password is now protected');
  assert.equal(top.shown[0].small, true, 'a corner note, not a block');
  assert.deepEqual(top.asked, ['pw-config', 'pw-told']);
  const frame = await run(false);
  assert.equal(frame.shown.length, 0);
  assert.deepEqual(frame.asked, ['pw-config']);
});
