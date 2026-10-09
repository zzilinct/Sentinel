'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
// clipwatch requires the copy of clickfix in desktop/shared (as tests/clickfix.test.js makes it).
{
  const from = path.join(__dirname, '..', 'server', 'lib', 'scan', 'clickfix.js');
  const to = path.join(__dirname, '..', 'desktop', 'shared', 'clickfix.js');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  let same = false;
  try { same = fs.readFileSync(to).equals(fs.readFileSync(from)); } catch { /* not there yet */ }
  if (!same) fs.copyFileSync(from, to);
}
const BTC_A = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const BTC_B = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

// clipwatch with a stand-in clipboard: board is what Windows holds.
function load() {
  const Module = require('module');
  const fake = { board: '', clipboard: { readText: async () => fake.board, writeText: async (t) => { fake.board = t; } } };
  const original = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? fake : original.call(this, req, ...rest); };
  const file = require.resolve('../desktop/src/clipwatch.js');
  delete require.cache[file];
  const cw = require(file);
  return { cw, fake, restore: () => { cw.stop(); Module._load = original; } };
}

test('a copied wallet address is recognised by kind, and checksums keep look-alikes out', () => {
  const { walletIn } = require('../desktop/src/clipwatch.js')._test;
  const kinds = {
    [BTC_A]: 'btc', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy': 'btc', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq': 'btc',
    '0x52908400098527886E0F7030069857D2E4169EE7': 'evm', ' 0xde709f2102306220921060314715629080e2fb77 ': 'evm',
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': 'trx', 'So11111111111111111111111111111111111111112': 'sol',
    'ltc1qg82tez4j6ftzq6ccasnsnuwmyrnfmnx6xgqhyc': 'ltc',
    '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A': 'xmr',
    'GB82WEST12345698765432': 'iban', 'DE89 3704 0044 0532 0130 00': 'iban'
  };
  for (const [t, kind] of Object.entries(kinds)) assert.equal(walletIn(t), kind, t);
  for (const t of [
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb',     // one character off: the checksum fails
    'GB82WEST12345698765433',                 // IBAN check digits fail
    'Send 0.1 BTC to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'hello', 'https://example.com', '0x1234', '12345678', ''
  ]) assert.equal(walletIn(t), null, t);
});

test('an address swapped with no key or mouse touched goes back, once named and never logged', async () => {
  const { cw, fake, restore } = load();
  const logs = [];
  const swaps = [];
  let idle = 60000;
  try {
    cw.start({ links: () => false, commands: () => false, wallets: () => true, browserOpen: () => false, clipOwner: async () => ({ owner: 'stealer', idle }), log: (l) => logs.push(l), onWallet: (w) => swaps.push(w) });
    await new Promise((r) => setImmediate(r));
    fake.board = BTC_A; await cw._test.tick();
    assert.equal(cw.status().every, 500, 'an address raises the pace for a few seconds');
    fake.board = BTC_B; await cw._test.tick();
    assert.equal(fake.board, BTC_A, 'the copied address is back');
    assert.deepEqual(swaps, [{ kind: 'btc', program: 'stealer', putBack: true }]);
    assert.match(logs.join('\n'), /wallet address swap caught \(btc\), written by stealer/);

    // It swaps again each time: put back, but the person is told only once, and after three times Sentinel stops.
    for (let i = 0; i < 4; i++) { fake.board = BTC_B; await cw._test.tick(); }
    assert.equal(fake.board, BTC_B);
    assert.equal(swaps.length, 1);
    assert.equal(logs.filter((l) => /swap caught/.test(l)).length, 3);
    assert.doesNotMatch(logs.join('\n'), /1A1z|1BvB/, 'no address in the log');
  } finally { restore(); }
});

test('two addresses the person copied, with a key pressed between them, are left alone', async () => {
  const { cw, fake, restore } = load();
  const swaps = [];
  let idle = 60000;
  try {
    cw.start({ links: () => false, commands: () => false, wallets: () => true, browserOpen: () => false, clipOwner: async () => ({ owner: 'notepad', idle }), log: () => {}, onWallet: (w) => swaps.push(w) });
    await new Promise((r) => setImmediate(r));
    fake.board = BTC_A; await cw._test.tick();
    await new Promise((r) => setTimeout(r, 400));
    idle = 10;   // Ctrl+C just now
    fake.board = BTC_B; await cw._test.tick();
    assert.equal(fake.board, BTC_B);
    // A different kind, or not knowing whether a key was pressed: also left alone.
    idle = 60000;
    fake.board = '0x52908400098527886E0F7030069857D2E4169EE7'; await cw._test.tick();
    assert.equal(fake.board, '0x52908400098527886E0F7030069857D2E4169EE7');
    assert.deepEqual(swaps, []);
  } finally { restore(); }
  const blind = load();
  try {
    blind.cw.start({ links: () => false, commands: () => false, wallets: () => true, browserOpen: () => false, clipOwner: async () => null, log: () => {}, onWallet: () => assert.fail('acted without knowing') });
    await new Promise((r) => setImmediate(r));
    blind.fake.board = BTC_A; await blind.cw._test.tick();
    blind.fake.board = BTC_B; await blind.cw._test.tick();
    assert.equal(blind.fake.board, BTC_B);
  } finally { blind.restore(); }
});

test('wallet guard is on by default on Windows, its off switch is behind the parent lock, and privacy says so', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /store\.get\('walletGuard', true\)/);
  assert.match(main, /lock\.guard\('wallet guard off', !enabled\)/);
  assert.match(main, /Something on this PC replaced the wallet address you copied\. Sentinel put yours back\. Check every character before you send\./);
  assert.match(read('web/privacy.html'), /Wallet guard/);
  assert.doesNotMatch(read('web/privacy.html').split('Wallet guard')[1].split('</li>')[0], /—/);
});
