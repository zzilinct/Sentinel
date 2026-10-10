'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { payPage } = require('../server/lib/scan/paycheck');
const paypause = require('../desktop/src/paypause');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SAYS = 'No real company, government office or bank asks to be paid in gift cards or crypto.';

test('pages that sell gift cards are known by their address', () => {
  for (const u of ['https://www.amazon.com/gift-cards/b/?ie=UTF8&node=2238192011', 'https://www.target.com/c/gift-cards/-/N-5xsxu',
    'https://www.walmart.com/cp/gift-cards/96894', 'https://www.apple.com/shop/gift-cards', 'https://www.amazon.com/Amazon-eGift-Card-Logo/dp/B07PCMWTSG',
    'https://store.steampowered.com/digitalgiftcards/', 'https://www.giftcards.com/', 'https://www.cardcash.com/buy-gift-cards/',
    'https://www.raise.com/', 'https://shop.example/giftcard']) assert.equal(payPage(u), 'gift', u);
});

test('crypto send and withdraw pages and crypto ATM locators are known by their address', () => {
  for (const u of ['https://www.binance.com/en/my/wallet/account/main/withdrawal/crypto', 'https://www.coinbase.com/send',
    'https://pro.kraken.com/app/withdraw', 'https://coinatmradar.com/', 'https://bitcoindepot.com/locations/',
    'https://shop.example/bitcoin-atm/', 'https://maps.example/crypto-atms-near-me']) assert.equal(payPage(u), 'crypto', u);
});

test('ordinary pages, a send page off an exchange, and flagged pages are not pay pages', () => {
  for (const u of ['https://www.amazon.com/', 'https://shop.example/gifts', 'https://shop.example/regift-ideas', 'https://www.coinbase.com/price/bitcoin',
    'https://mail.example/send', 'https://news.example/bitcoin-price', 'http://127.0.0.1/gift-cards', 'not a url']) assert.equal(payPage(u), null, u);
  assert.equal(payPage('https://shop.example/gift-cards', { overall: { badge: 'red' } }), null, 'a flagged page has its own warning');
  assert.equal(payPage('https://shop.example/gift-cards', { overall: { badge: 'yellow' } }), 'gift');
});

test('the pause speaks only after a sign in the last hour, the latest sign, once per site', () => {
  const t0 = 1_000_000_000;
  const p = paypause.create();
  assert.deepEqual(p.ask('giftshop.example', { at: t0 }), { sign: null, again: false }, 'never on its own');
  assert.deepEqual(p.ask('giftshop.example', { at: t0 }), { sign: null, again: false }, 'nothing shown, so nothing counted');
  p.sign('page', t0);
  p.sign('call', t0 + 1000);
  p.sign('nonsense', t0 + 2000);
  assert.deepEqual(p.ask('giftshop.example', { at: t0 + 5000 }), { sign: 'call', again: false });
  assert.deepEqual(p.ask('giftshop.example', { at: t0 + 6000 }), { sign: 'call', again: true }, 'once per site');
  assert.deepEqual(p.ask('coinatmradar.com', { at: t0 + paypause.HOUR + 2000 }), { sign: null, again: false }, 'an hour later the signs are old');
  assert.deepEqual(p.ask('coinatmradar.com', { at: t0 + paypause.HOUR + 2000, remoteNow: true }), { sign: 'remote', again: false }, 'a remote-control program running now');
  p.sign('chat', t0 + 2 * paypause.HOUR);
  assert.equal(p.ask('private', { at: t0 + 2 * paypause.HOUR }).sign, 'chat');
});

test('the Windows app and the companion say the one thing, calmly, with one way to close it', () => {
  const guard = read('desktop/src/pages/guard.html');
  const note = read('extension/src/content/guard.js');
  for (const s of [guard, note]) {
    assert.ok(s.includes(SAYS));
    assert.ok(s.includes('I am buying this for myself'));
    assert.ok(s.includes('call your bank on the number on the back of your card'));
  }
  const pause = guard.slice(guard.indexOf('function pause()'), guard.indexOf("if (mode === 'escape')"));
  assert.ok(!/—/.test(pause) && !/—/.test(note.slice(note.indexOf('pauseNote'))), 'no em dashes');
  assert.match(pause, /buttons: \[\{ label: 'I am buying this for myself', primary: true, cancel: true, run: \(\) => act\('dismiss'\) \}\]/, 'one button, and it only closes');
  assert.match(note, /small: true,[\s\S]{0,80}title: 'A moment before you pay'/, 'a corner note, never a block');
});

test('the signs are wired: flagged pages, chat warnings, the shield, the call check; the log never says where', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /remote\.flaggedPage\(\);\s+pause\.sign\('page'\);/);
  assert.match(main, /if \(c\.flagged\) pause\.sign\('chat'\)/);
  assert.match(main, /!alarms\.length\) return;\s+pause\.sign\('remote'\);/);
  assert.match(main, /handle\('sentinel:call-hangup', \(\) => \{ pause\.sign\('call'\);/);
  assert.match(main, /appLog\(`pay pause: \$\{what\}, /);
  assert.ok(!/appLog\(`pay pause:[^\n]*(page\.url|host)/.test(main), 'never the address');
  assert.match(read('web/assets/js/app.js'), /r\.verdict === 'hangup' && window\.sentinelDesktop && window\.sentinelDesktop\.callHangUp\) window\.sentinelDesktop\.callHangUp\(\)/);
  const bg = read('extension/src/background.js');
  assert.match(bg, /if \(severe\) await sessionSet\('paySign', Date\.now\(\)\);\s+else if \(verdict\.paypage\) await payPause/);
});
