'use strict';
/**
 * "Did you type anything?" after a fake sign-in: the Windows app's rules (desktop/src/typedcheck.js) and its reader's
 * part (watch.js), and the companion's (content/typed.js and the worker's typed-* handling). A flagged page with a
 * password or card box, closed or left, is asked about once per site; nothing typed is ever read.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const typedcheck = require('../desktop/src/typedcheck.js');
const SRC = path.join(__dirname, '..', 'extension', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const flat = (rel) => read(rel).replace(/^import\s+[^;]+;\s*$/gm, '').replace(/^export\s+(?=(const|let|function|class|async)\b)/gm, '');

test('the recovery guide is ticked for the boxes the page had, and a page with neither is not asked about', () => {
  assert.equal(typedcheck.happened({ pw: true }), 'password');
  assert.equal(typedcheck.happened({ card: true }), 'card');
  assert.equal(typedcheck.happened({ pw: true, card: true }), 'password,card');
  assert.equal(typedcheck.happened({ pw: false, card: false }), null);
  assert.equal(typedcheck.happened(null), null);
  // Every tick is one the guide knows (recover.js happenedFrom keeps only those).
  const { happenedFrom } = require('../web/assets/js/recover.js');
  assert.deepEqual(happenedFrom('?happened=password,card'), ['password', 'card']);
});

test('asked once per site, and only with a box on the page', () => {
  const t = typedcheck.create();
  assert.equal(t.ask('paypa1-secure-login.com', { pw: false, card: false }), null, 'no box: nothing to ask');
  assert.equal(t.ask('paypa1-secure-login.com', { pw: true }), 'password');
  assert.equal(t.ask('paypa1-secure-login.com', { pw: true, card: true }), null, 'once per site');
  assert.equal(t.ask('netflix-billing-update.top', { card: true }), 'card', 'another site is asked about');
  assert.equal(t.ask('', { pw: true }), null);
});

test('the reader asks only what kind of box is on the flagged page, never what is in it, and never logs the site', () => {
  const { SCRIPT } = require('../desktop/src/watch.js')._test;
  const block = SCRIPT.slice(SCRIPT.indexOf('# The flagged page: another site'), SCRIPT.indexOf('$isPrivate = $title -match $private'));
  assert.ok(block.length > 200, 'the flagged page block is there');
  assert.match(block, /IsPasswordProperty/);
  assert.doesNotMatch(block, /ValuePattern|ValueProperty|TextPattern/, 'what is typed in a box is never read');
  assert.doesNotMatch(block, /Write-Output[^\n]*(\$url|\$flagHost|Name)/, 'only true or false leaves the reader');
  assert.match(SCRIPT, /\$editCache\.Add\(\$A::IsPasswordProperty\); \$editCache\.Add\(\$A::NameProperty\); \$editCache\.Add\(\$A::AutomationIdProperty\)$/m);
  assert.match(SCRIPT, /-not \[SW\]::IsWindow\(\$flagH\)\) \{ \$flagH = \[IntPtr\]::Zero; Write-Output '\{"left":"closed"\}' \}/, 'a closed window is noticed wherever it was');
  const watch = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'watch.js'), 'utf8');
  for (const line of watch.match(/log\(`typed check[^`]*`\)|log\('typed check[^']*'\)/g) || []) assert.doesNotMatch(line, /host|url/, line);
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'main.js'), 'utf8');
  const asked = /appLog\(`typed check:[^`]*`\)/.exec(main);
  assert.ok(asked && !/t\.host|site/.test(asked[0]), 'the app log says it was asked, never where');
  assert.match(main, /fullscreenInFront\(\)/, 'never over a game');
});

test('the shield\'s window asks the question in the house style', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'pages', 'guard.html'), 'utf8');
  const typed = html.slice(html.indexOf('function typed()'), html.indexOf("if (mode === 'escape')"));
  assert.match(typed, /Did you type \$\{what\} on that page\?/);
  assert.match(typed, /'a password or card number'/);
  assert.match(typed, /label: 'No', cancel: true, run: \(\) => act\('dismiss'\)/, 'Escape is No, and changes nothing');
  assert.match(typed, /act\('typed-yes'/);
  assert.doesNotMatch(typed, /—/, 'no em dashes');
});

test('the companion finds password and card boxes by their type and labels, never their contents', () => {
  const { fields, words } = require('../extension/src/content/typed.js');
  const input = (o) => ({ type: 'text', autocomplete: '', name: '', id: '', placeholder: '', labels: [], getAttribute: () => null, ...o });
  const doc = (list) => ({ querySelectorAll: () => list });
  assert.deepEqual(fields(doc([input({ name: 'email' }), input({ type: 'password' })])), { pw: true, card: false });
  assert.deepEqual(fields(doc([input({ autocomplete: 'cc-number' })])), { pw: false, card: true });
  assert.deepEqual(fields(doc([input({ type: 'tel', labels: [{ textContent: 'Card number' }] })])), { pw: false, card: true });
  assert.deepEqual(fields(doc([input({ id: 'cvv' })])), { pw: false, card: true });
  assert.deepEqual(fields(doc([input({ name: 'q', value: '4111 1111 1111 1111' })])), { pw: false, card: false }, 'what is in a box says nothing');
  assert.deepEqual(fields(doc([input({ type: 'checkbox', name: 'save-card-number' })])), { pw: false, card: false });
  assert.equal(words('password'), 'a password');
  assert.equal(words('card'), 'a card number');
  assert.equal(words('password,card'), 'a password or card number');
  assert.doesNotMatch(read('content/typed.js'), /\.value\b/, 'no box\'s value is read');
});

/* The real worker, flattened as for Firefox, with listeners kept so the test can be the browser. */
const area = (store) => ({
  get: async (k) => { const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k || {}); return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, JSON.parse(JSON.stringify(store[x]))])); },
  set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
  remove: async (k) => { delete store[k]; }
});

function worker({ tabs = {} } = {}) {
  const sent = [];
  const created = [];
  const on = {};
  const listener = (name) => ({ addListener: (f) => { on[name] = f; } });
  const store = {
    account: { signedIn: true, plan: { features: { liveFast: true } } },
    intel: { hosts: [{ host: 'paypa1-secure-login.com', threat: 'scam' }, { host: 'netflix-billing-update.top', threat: 'scam' }], at: Date.now() }
  };
  const session = {};
  const ext = {
    runtime: { id: 'me', getURL: (p) => `chrome-extension://me/${p}`, getManifest: () => ({ content_scripts: [], version: '1' }), onMessage: listener('message'), onMessageExternal: listener('external'), onInstalled: listener('installed'), onStartup: listener('startup'), lastError: null },
    storage: { local: area(store), session: area(session), sync: { get: async (d) => ({ ...d }), set: async () => {} }, onChanged: listener('changed') },
    tabs: {
      // A page answers the question when its content script is there (an ordinary web page).
      sendMessage: async (tabId, msg, opts) => { sent.push({ tabId, msg, opts }); return msg.type === 'sentinel:typed-ask' && /^https?:/.test((tabs[tabId] || {}).url || '') ? { shown: true } : undefined; },
      get: async (id) => tabs[id] || null,
      query: async ({ windowId }) => Object.values(tabs).filter((t) => t.active && t.windowId === windowId),
      create: async (o) => { created.push(o.url); },
      onRemoved: listener('removed'), onActivated: listener('activated')
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    alarms: { create: () => {}, onAlarm: listener('alarm') },
    contextMenus: { create: () => {}, onClicked: listener('menu') },
    notifications: { create: async () => {} },
    webNavigation: { onCommitted: listener('committed'), onCompleted: listener('completed') },
    permissions: { contains: async () => true }
  };
  const ctx = { chrome: ext, crypto: globalThis.crypto, TextEncoder, URL, btoa, atob, Uint8Array, AbortController, setTimeout, clearTimeout, console, Promise,
    fetch: async () => { throw new Error('offline'); } };
  vm.createContext(ctx);
  const code = [flat('lib/brand.js'), flat('lib/api.js'), flat('lib/pwalarm.js'), flat('background.js')].join('\n');
  vm.runInContext(`${code}\n;this.handlers = handlers;`, ctx);
  const call = async (type, msg, tabId) => {
    const url = tabs[tabId].url;
    return JSON.parse(JSON.stringify(await ctx.handlers[type]({ type, ...msg }, { id: 'me', url, frameId: 0, tab: { id: tabId, url } })));
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { on, sent, created, session, call, settle, tabs };
}

test('companion: a flagged sign-in page closed asks once, on the page in front, and Yes opens the matching guide', async () => {
  const tabs = {
    5: { id: 5, windowId: 1, active: true, url: 'https://paypa1-secure-login.com/', incognito: false },
    6: { id: 6, windowId: 1, active: false, url: 'https://example.com/recipes', incognito: false }
  };
  const w = worker({ tabs });
  await w.settle();
  await w.on.committed({ frameId: 0, tabId: 5, url: tabs[5].url });
  assert.ok(w.sent.some((s) => s.tabId === 5 && s.msg.type === 'sentinel:typed-watch'), 'the flagged page is watched for boxes');
  assert.deepEqual(await w.call('typed-fields', { pw: true }, 5), { kept: true });
  assert.doesNotMatch(JSON.stringify(w.session), /example\.com/);

  // The flagged tab is closed; the tab left in front gets the question.
  delete tabs[5];
  tabs[6].active = true;
  await w.on.removed(5, { windowId: 1 });
  await w.settle();
  const asks = w.sent.filter((s) => s.msg.type === 'sentinel:typed-ask');
  assert.equal(asks.length, 1);
  assert.deepEqual({ tab: asks[0].tabId, happened: asks[0].msg.happened, site: asks[0].msg.site }, { tab: 6, happened: 'password', site: 'paypa1-secure-login.com' });
  assert.deepEqual(await w.call('typed-yes', {}, 6), { opened: true });
  assert.equal(w.created.length, 1);
  assert.match(w.created[0], /\/recover\?happened=password$/);
  assert.deepEqual(await w.call('typed-yes', {}, 6), { opened: false }, 'one answer per question');

  // The same site again: never asked twice.
  tabs[7] = { id: 7, windowId: 1, active: true, url: 'https://paypa1-secure-login.com/login', incognito: false };
  await w.on.committed({ frameId: 0, tabId: 7, url: tabs[7].url });
  await w.call('typed-fields', { pw: true }, 7);
  delete tabs[7];
  await w.on.removed(7, { windowId: 1 });
  await w.settle();
  assert.equal(w.sent.filter((s) => s.msg.type === 'sentinel:typed-ask').length, 1, 'once per site');
});

test('companion: leaving a flagged card page for another site asks on that next page; a page with no box is never asked about', async () => {
  const tabs = { 3: { id: 3, windowId: 2, active: true, url: 'https://netflix-billing-update.top/pay', incognito: false } };
  const w = worker({ tabs });
  await w.settle();
  await w.on.committed({ frameId: 0, tabId: 3, url: tabs[3].url });
  await w.call('typed-fields', { card: true }, 3);
  // The next page in the same tab: asked once it has loaded.
  tabs[3].url = 'https://example.org/';
  await w.on.committed({ frameId: 0, tabId: 3, url: tabs[3].url });
  await w.on.completed({ frameId: 0, tabId: 3 });
  await w.settle();
  const ask = w.sent.find((s) => s.msg.type === 'sentinel:typed-ask');
  assert.ok(ask && ask.tabId === 3 && ask.msg.happened === 'card', JSON.stringify(w.sent));

  // A flagged page without a password or card box, closed: nothing to ask.
  tabs[4] = { id: 4, windowId: 2, active: false, url: 'https://paypa1-secure-login.com/', incognito: false };
  await w.on.committed({ frameId: 0, tabId: 4, url: tabs[4].url });
  delete tabs[4];
  await w.on.removed(4, { windowId: 2 });
  await w.settle();
  assert.equal(w.sent.filter((s) => s.msg.type === 'sentinel:typed-ask').length, 1);

  // A private window is never watched.
  tabs[9] = { id: 9, windowId: 3, active: true, url: 'https://paypa1-secure-login.com/', incognito: true };
  await w.on.committed({ frameId: 0, tabId: 9, url: tabs[9].url });
  assert.equal(w.session['typed:9'], undefined);
});
