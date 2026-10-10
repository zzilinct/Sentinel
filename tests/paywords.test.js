'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fromTitle, fromWords, kind, TITLE } = require('../server/lib/scan/paywords');
const { payPage } = require('../server/lib/scan/paycheck');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('titles that sell gift cards or send crypto', () => {
  for (const t of ['Gift Cards | Target', 'Amazon.com: Gift Cards', 'Buy Steam Gift Cards Online - Microsoft Edge', 'Apple Gift Card - Apple',
    'eGift cards and more - Shop', 'Giftcards - Store']) assert.equal(fromTitle(t), 'gift', t);
  for (const t of ['Send Bitcoin - Wallet - Google Chrome', 'Withdraw Crypto | Exchange', 'Withdraw your USDT', 'USDT withdrawal - Exchange',
    'Bitcoin ATMs near you', 'Enter wallet address - Wallet']) assert.equal(fromTitle(t), 'crypto', t);
});

test('titles about gift cards or crypto that sell nothing', () => {
  for (const t of ['Gift card scams | Consumer Advice', 'Check your gift card balance', 'How to redeem a gift card - Help', 'Best gift card ideas for dads',
    'Ethereum whales send $1B to exchanges - News', 'Bitcoin price today', 'Send money to friends', 'Withdraw cash - My Bank', 'Checkout', '', null]) {
    assert.equal(fromTitle(t), null, String(t));
  }
});

test('page wording: a send dialog and a gift card form are known by their labels', () => {
  assert.equal(fromWords(['Send crypto', 'Recipient address', 'Paste address', 'Continue']), 'crypto', 'one sure label');
  assert.equal(fromWords(['Send', 'To', 'Amount', 'Bitcoin', 'Review']), 'crypto', "a wallet's send dialog: the button, the field and a coin");
  assert.equal(fromWords(['Withdraw', 'Network', 'Select network', 'USDT', 'Withdraw']), 'crypto', "an exchange's withdraw modal");
  assert.equal(fromWords(['Withdraw to external wallet']), 'crypto');
  assert.equal(fromWords(['Buy gift cards', 'Choose a design']), 'gift');
  assert.equal(fromWords(['Store card', 'Gift card amount', 'Recipient email']), 'gift');
  assert.equal(fromWords(['Gift cards', '$25', '$50', '$100', 'Add to cart']), 'gift', 'a gift card heading beside amounts to choose');
});

test('page wording: ordinary pages that merely mention gift cards or crypto say nothing', () => {
  assert.equal(fromWords(['Kitchen goods', 'Add to cart', 'Quantity', 'Gift cards']), null, 'a section heading with no amount to choose');
  assert.equal(fromWords(['Check your gift card balance', 'Card number', 'PIN', 'Amount']), null, 'a balance check');
  assert.equal(fromWords(['Gift card scams', 'Never buy gift cards to pay someone you do not know']), null, 'advice about scams');
  assert.equal(fromWords(['Bitcoin price today', 'Send', 'Email address']), null, 'a newsletter box on a news page');
  assert.equal(fromWords(['Send', 'To', 'Subject', 'Message']), null, 'an email form');
  assert.equal(fromWords(['Transfer', 'Amount', 'From account', 'To']), null, "a bank's own transfer");
  assert.equal(fromWords(null), null);
  assert.equal(fromWords(['x'.repeat(200) + ' buy gift cards']), null, 'long text is not a label');
  assert.equal(kind({ title: 'Wallet', words: ['Send', 'To', 'Amount', 'ETH'] }), 'crypto');
  assert.equal(kind({ title: 'Gift Cards | Store' }), 'gift');
  assert.equal(kind(), null);
});

test('the scanner takes the kind the client saw only for an address that says nothing, and never on a flagged page', () => {
  assert.equal(payPage('https://wallet.example/home', null, 'crypto'), 'crypto');
  assert.equal(payPage('https://store.example/p/123', null, 'gift'), 'gift');
  assert.equal(payPage('https://store.example/p/123', null, 'anything'), null);
  assert.equal(payPage('https://store.example/p/123', { overall: { badge: 'red' } }, 'gift'), null);
  assert.equal(payPage('http://127.0.0.1/p/1', null, 'gift'), null);
  assert.equal(payPage('https://shop.example/gift-cards', null, 'crypto'), 'gift', 'the address says it first');
  assert.match(read('server/routes/scan.routes.js'), /payPage\(String\(url\), verdict, body\.paykind\)/);
});

test('one file: the Windows app and the companion carry the same rules', () => {
  assert.equal(read('extension/src/content/paywords.js'), read('server/lib/scan/paywords.js'), 'scripts/build-extension.js copies it; commit the copy');
  assert.match(read('desktop/scripts/sync-shared.js'), /'paywords\.js'/);
  assert.match(read('scripts/build-extension.js'), /'paywords\.js'\), path\.join\(SRC, 'src', 'content', 'paywords\.js'\)/);
});

test("the Windows app's reader matches titles with the same rules, and only the kind leaves it", () => {
  const { SCRIPT, payTitles } = require('../desktop/src/watch.js')._test;
  // payTitles needs desktop/shared/paywords.js (sync-shared.js); the test makes it if this file runs first.
  const to = path.join(ROOT, 'desktop', 'shared', 'paywords.js');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!fs.existsSync(to) || fs.readFileSync(to, 'utf8') !== read('server/lib/scan/paywords.js')) fs.copyFileSync(path.join(ROOT, 'server', 'lib', 'scan', 'paywords.js'), to);
  const body = payTitles(SCRIPT);
  for (const [name, src] of [['payGift', TITLE.gift], ['payNotGift', TITLE.notGift], ['payCrypto', TITLE.crypto]]) {
    assert.ok(body.includes(`$${name} = '${src.replace(/'/g, "''")}'`), name);
  }
  assert.ok(!/__PAY_/.test(body));
  assert.ok(!/\$/.test(TITLE.gift + TITLE.notGift + TITLE.crypto), 'nothing PowerShell would read as a variable');
  assert.match(SCRIPT, /paykind = \$payKind \}/);
  assert.ok(!/title = \$title/.test(SCRIPT), 'never the title');
  const w = read('desktop/src/watch.js');
  assert.match(w, /\.\.\.\(page\.paykind \? \{ paykind: page\.paykind \} : \{\}\)/);
});

test('the companion reads wording only when asked, in the hour after a warning, and sends only the kind', () => {
  const bg = read('extension/src/background.js');
  assert.match(bg, /else if \(verdict\.paypage\) await payPause\(details\.tabId, details\.url, verdict\.paypage\);\s+else await payLook\(details\.tabId, details\.url\);/);
  const look = bg.slice(bg.indexOf('async function payLook'), bg.indexOf('async function realSiteFor'));
  assert.match(look, /if \(!at \|\| Date\.now\(\) - at > PAUSE_HOUR\) return;/);
  assert.match(look, /files: \['src\/content\/paywords\.js', 'src\/content\/payread\.js'\]/);
  const handler = bg.slice(bg.indexOf('async paywords('), bg.indexOf("async 'typed-no'"));
  assert.ok(!/apiFetch|fetch\(/.test(handler), 'nothing is sent');
  assert.match(handler, /badge === 'red' \|\| badge === 'orange'/);
  const reader = read('extension/src/content/payread.js');
  assert.match(reader, /sendMessage\(\{ type: 'paywords', kind \}\)/);
  assert.ok(!/\.value\b/.test(reader), 'never what is typed');
  assert.match(reader, /footer, nav, a,/);
  assert.ok(!JSON.parse(read('extension/manifest.json')).content_scripts.some((c) => c.js.includes('src/content/payread.js')), 'not on every page');
});

test('the privacy page says what is read for it', () => {
  const p = read('web/privacy.html');
  assert.match(p, /when the address says nothing, by its title/);
  assert.match(p, /only whether the page is a gift card or crypto page goes anywhere, never the words/);
  assert.ok(!/—/.test(p.slice(p.indexOf('A pause before paying'), p.indexOf('Live scanning in the Windows app'))));
});
