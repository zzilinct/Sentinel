'use strict';
/**
 * Web chats in the companion (extension/src/content/webchat.js): masks beside links in Discord, WhatsApp Web,
 * Messenger, Telegram Web and X messages, and chat safety's hints, from the Windows app's own rules (chat.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { conversation, signsIn } = require('../server/lib/scan/chat');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const ids = (t) => signsIn(t, {}).map((s) => s.id);

test('asked for a code, gift cards, crypto or a "verify your account" step: a scam sign', () => {
  for (const t of ['Hi, I sent you a 6 digit code by mistake, can you send it to me?', 'send me the code you got', 'what is the code you got',
    'just forward me the verification code we sent']) assert.ok(ids(t).includes('creds'), t);
  for (const t of ['buy me a $100 Apple gift card', 'can you get me some steam cards', 'send me the numbers on the back of the card',
    'send a picture of the back of the gift card', 'Pay the fee in Bitcoin and the parcel is yours', 'send $500 worth of bitcoin to this wallet',
    'go to a bitcoin ATM near you']) assert.ok(ids(t).includes('pay'), t);
  for (const t of ['Please verify your account here', 'confirm your details now or lose access', 'your account will be locked today']) {
    assert.ok(ids(t).includes('verify'), t);
  }
});

test('ordinary chat about codes, gift cards and money is not a sign', () => {
  for (const t of ['I got a gift card for mom', 'my code is not working', 'the promo code is SUMMER', 'send me the link', 'I will pay you back in cash',
    'bitcoin is up today', 'did you get the gift card I sent?', 'see you at 5', 'thanks for the birthday card']) assert.deepEqual(ids(t), [], t);
});

test('one such message is enough for a hint, and it is a scam one', () => {
  const r = conversation({}).add({ who: 'Alex', text: 'Pay the release fee in Bitcoin today' });
  assert.equal(r.family, 'scam');
  assert.equal(r.level, 'warn');
  assert.match(r.detail, /^Alex asked to be paid in gift cards or crypto\.$/);
  assert.equal(conversation({}).add({ who: 'Sam', text: 'I sent you a 6 digit code by mistake, send it back please' }).level, 'danger');
});

test('the companion runs the same rules: chat.js is one file for Node and the page', () => {
  assert.equal(read('extension/src/content/chat.js'), read('server/lib/scan/chat.js'), 'scripts/build-extension.js copies it; commit the copy');
  assert.match(read('scripts/build-extension.js'), /'chat\.js'\), path\.join\(SRC, 'src', 'content', 'chat\.js'\)/);
  const page = {};
  vm.createContext(page);
  vm.runInContext(read('server/lib/scan/chat.js'), page);
  assert.equal(typeof page.SentinelChat.conversation, 'function');
  assert.equal(page.SentinelChat.conversation({}).add({ text: 'send me the code you got' }).family, 'scam');
});

test('the web chats content script: where it runs, what it reads, what it sends', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const entry = manifest.content_scripts.find((c) => c.js.includes('src/content/webchat.js'));
  assert.ok(entry, 'declared in the manifest');
  assert.deepEqual(entry.js, ['src/content/masks.js', 'src/content/chat.js', 'src/content/webchat.js'], 'the masks and the rules load first');
  assert.ok(entry.css.includes('src/content/sentinel.css'));
  assert.ok(!entry.all_frames);
  for (const host of ['discord.com', 'web.whatsapp.com', 'www.messenger.com', 'www.facebook.com', 'web.telegram.org', 'x.com']) {
    assert.ok(entry.matches.includes(`https://${host}/*`), host);
  }

  const src = read('extension/src/content/webchat.js');
  const code = strip(src);
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|console\.|localStorage|storage\.(local|sync)\.set/, 'nothing is sent, kept or logged from the page');
  // The only message to the worker is the fast check of link addresses, as search results use.
  assert.deepEqual([...code.matchAll(/send\(\{ type: '([\w-]+)'[^}]*\}/g)].map((m) => m[0]), ["send({ type: 'live-batch', urls, phase: 'quick' }"]);
  assert.match(code, /!inUse\(\)/, 'only while the tab is in use');
  assert.match(code, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.match(code, /prefers-reduced-motion/);
  assert.match(code, /globalThis\.SentinelMasks/);
  assert.match(code, /globalThis\.SentinelChat/);
  assert.match(code, /textContent = r\.detail/, 'a sender\'s name is shown as text, never as markup');
  assert.doesNotMatch(code, /—/);

  // Where a link leads, through Messenger's and X's wrappers.
  const start = src.indexOf('function realUrl');
  const end = src.indexOf('/* ------------------------------------------------------------ masks */');
  assert.ok(start > 0 && end > start);
  const ctx = { URL };
  vm.createContext(ctx);
  vm.runInContext(`${src.slice(start, end)}; this.realUrl = realUrl;`, ctx);
  const dest = 'https://paypa1-secure-login.com/account';
  const base = 'https://www.messenger.com/t/123';
  const cases = [
    [dest, dest, dest],
    [`https://l.facebook.com/l.php?u=${encodeURIComponent(dest)}&h=AT0`, 'paypa1-secure-login.com', dest],
    [`https://l.messenger.com/l.php?u=${encodeURIComponent(dest)}`, '', dest],
    ['https://t.co/AbC123', 'paypa1-secure-login.com/account…', dest],
    ['https://t.co/AbC123', 'a picture', 'https://t.co/AbC123'],
    // A shared post's link card: its label, or a line of it, names where it leads (QA 1.18).
    ['https://t.co/Yy8wP', ['paypa1-secure-login.comAccount review needed', 'paypa1-secure-login.com Account review needed'.split(/\s/)[0]], 'https://paypa1-secure-login.com/'],
    ['https://t.co/Yy8wP', ['', 'Account review needed', 'From paypa1-secure-login.com'], 'https://paypa1-secure-login.com/'],
    ['https://t.co/Yy8wP', ['Account review needed', 'A picture'], 'https://t.co/Yy8wP'],
    ['/t/456', '', 'https://www.messenger.com/t/456'],
    ['javascript:alert(1)', '', null],
    ['mailto:a@b.example', '', null]
  ];
  for (const [href, words, want] of cases) assert.equal(ctx.realUrl(href, words, base), want, href.slice(0, 60));
});

/**
 * The real script, on a small stand-in for a page: Discord's selectors, a counter of every read of a message, and the
 * MutationObserver handed to the test so changes can be delivered by hand.
 */
function chatPage() {
  let reads = 0;
  let wide = 0;
  const hinted = [];
  class El {
    constructor(selector) { this.sel = selector; this.kids = []; this.parent = null; this.nodeType = 1; this.text = ''; this.attrs = {}; this.who = ''; }
    get isConnected() { return Boolean(this.parent); }
    get parentElement() { return this.parent; }
    get previousElementSibling() { const k = this.parent ? this.parent.kids : []; return k[k.indexOf(this) - 1] || null; }
    matches(s) { return this.sel === s; }
    closest(s) { let e = this; while (e) { if (e.sel === s) return e; e = e.parent; } return null; }
    get textContent() { reads++; return this.text; }
    querySelector(s) {
      if (s.includes('message-username')) return this.who ? { textContent: this.who } : null;
      if (s.includes('message-content')) return this;
      return null;
    }
    querySelectorAll(s) {
      if (s === MSG) { const out = this.kids.flatMap((k) => (k.sel === MSG ? [k] : k.querySelectorAll(s))); return out; }
      return [];
    }
    compareDocumentPosition(b) { const k = this.parent.kids; return k.indexOf(this) < k.indexOf(b) ? 4 : 2; }
    after(n) { hinted.push(n); }
  }
  const MSG = 'li[id^="chat-messages-"]';
  const list = new El('ol'); list.parent = {};
  const add = (text, who = '') => { const m = new El(MSG); m.text = text; m.who = who; m.parent = list; list.kids.push(m); return m; };
  let observer = null;
  const timers = [];
  const ctx = {
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 }, URL, Promise, setTimeout: (f, ms) => { timers.push(f); return timers.length; }, clearTimeout() {},
    location: { hostname: 'discord.com', pathname: '/channels/1/2', href: 'https://discord.com/channels/1/2' },
    window: { addEventListener() {} },
    MutationObserver: class { constructor(f) { observer = f; } observe() {} },
    SentinelMasks: { SEVERITY: {} }, chrome: { runtime: { sendMessage: async () => ({}) }, storage: { sync: { get: async () => ({ chatHints: true, enabled: true }) }, onChanged: { addListener() {} } } }
  };
  ctx.globalThis = ctx;
  ctx.SentinelChat = { conversation: () => ({ add: ({ who, text }) => { ctx.judged.push([who, text]); return null; } }) };
  ctx.judged = [];
  ctx.document = {
    body: list, visibilityState: 'visible', hasFocus: () => true, addEventListener() {}, createElement: () => new El('span'),
    querySelectorAll: (s) => { wide++; return list.querySelectorAll(s); }
  };
  vm.createContext(ctx);
  vm.runInContext(read('extension/src/content/webchat.js'), ctx);
  const run = async () => { await new Promise((r) => setImmediate(r)); while (timers.length) timers.shift()(); await new Promise((r) => setImmediate(r)); };
  return { ctx, add, list, run, deliver: (records) => observer(records), counts: () => ({ reads, wide }), reset: () => { reads = 0; wide = 0; } };
}

test('web chats read only what changed: a long chat costs the same as a short one', async () => {
  for (const size of [50, 5000]) {
    const page = chatPage();
    for (let i = 0; i < size; i++) page.add(`message ${i}`, i % 7 ? '' : `person${i}`);
    await page.run();
    assert.equal(page.ctx.judged.length, size, 'all of it is read when the page opens');
    page.reset();
    // A typing indicator, and any other change outside a message: nothing is read at all.
    page.deliver([{ target: page.list, addedNodes: [{ nodeType: 1, matches: () => false, querySelectorAll: () => [] }] }]);
    await page.run();
    assert.deepEqual(page.counts(), { reads: 0, wide: 0 }, `${size} messages: a change outside any message reads none of them`);
    const m = page.add('one more');
    page.deliver([{ target: page.list, addedNodes: [m] }]);
    await page.run();
    assert.deepEqual(page.counts(), { reads: 1, wide: 0 }, `${size} messages: one new message is one read, and no look over the page`);
    assert.equal(page.ctx.judged.at(-1)[0], `person${Math.floor((size - 1) / 7) * 7}`, 'and its sender is found up the run of messages above it');
  }
});

test('web chats: a list drawn again, an edit, and another conversation are all still read', async () => {
  const page = chatPage();
  const a = page.add('first', 'sam');
  await page.run();
  // An edit in place.
  a.text = 'edited';
  page.deliver([{ target: { nodeType: 3, parentElement: a }, addedNodes: [] }]);
  await page.run();
  assert.equal(page.ctx.judged.at(-1)[1], 'edited');
  // A block of messages arriving together, in order.
  const b = page.add('second'); const c = page.add('third');
  page.deliver([{ target: page.list, addedNodes: [{ nodeType: 1, matches: () => false, querySelectorAll: () => [c, b] }] }]);
  await page.run();
  assert.deepEqual(page.ctx.judged.slice(-2).map((j) => j[1]), ['second', 'third'], 'in the order they sit on the page');
  // Another conversation: every message there, even ones drawn before the address changed.
  const d = page.add('drawn before the address changed');
  page.ctx.location.pathname = '/channels/1/3';
  page.deliver([{ target: page.list, addedNodes: [] }]);
  await page.run();
  assert.ok(page.ctx.judged.some((j) => j[1] === d.text));
});
