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
