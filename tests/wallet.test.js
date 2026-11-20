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
    assert.deepEqual(swaps, [{ kind: 'btc', reason: 'swap', program: 'stealer', putBack: true }]);
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

test('heard as it happens, a swap 5 ms after the copy is caught; the echo of Sentinel\'s own write and a second copy are not', async () => {
  const { cw, fake, restore } = load();
  const swaps = [];
  let ear = null;
  try {
    cw.start({ links: () => false, commands: () => false, wallets: () => true, browserOpen: () => false, listen: (h) => { ear = h; }, listening: () => Boolean(ear), log: () => {}, onWallet: (w) => swaps.push(w) });
    assert.equal(typeof ear, 'function', 'wallet guard asks to hear clipboard changes');
    const flush = () => new Promise((r) => setImmediate(r));
    // Copied at tick 1000 (the key was pressed just before), swapped at 1005 with nothing touched since.
    ear({ tick: 1000, idle: 40, owner: 'notepad', text: BTC_A });
    fake.board = BTC_B;
    ear({ tick: 1005, idle: 45, owner: 'stealer', text: BTC_B });
    await flush();
    assert.equal(fake.board, BTC_A);
    assert.deepEqual(swaps, [{ kind: 'btc', reason: 'swap', program: 'stealer', putBack: true }]);
    ear({ tick: 1010, idle: 50, owner: 'sentinel', text: BTC_A });   // Sentinel's own write, heard back
    await flush();
    assert.equal(swaps.length, 1);
    // Later, the person copies another address: a key pressed after the first was heard.
    ear({ tick: 5000, idle: 30, owner: 'notepad', text: BTC_B });
    ear({ tick: 5600, idle: 20, owner: 'notepad', text: BTC_A });
    // Something that is not an address in between ends the watch too.
    ear({ tick: 9000, idle: 9000, owner: 'notepad', text: '' });
    ear({ tick: 9005, idle: 9005, owner: 'stealer', text: BTC_B });
    await flush();
    assert.equal(swaps.length, 1);
    // A clipper that waits two seconds, with nothing touched since the copy, is caught too.
    ear({ tick: 20000, idle: 50, owner: 'notepad', text: BTC_A });
    fake.board = BTC_B;
    ear({ tick: 22000, idle: 2050, owner: 'stealer', text: BTC_B });
    await flush();
    assert.equal(swaps.length, 2);
    // Too long after the copy (over 10 s) is not taken for a swap.
    ear({ tick: 40000, idle: 50, owner: 'notepad', text: BTC_A });
    ear({ tick: 51000, idle: 11050, owner: 'stealer', text: BTC_B });
    await flush();
    assert.equal(swaps.length, 2);
    assert.equal(cw.status().hearing, true);
  } finally { restore(); }
  assert.equal(ear, null, 'stopped: no longer listening');
});

// Address poisoning. Every address here is made up: a fixed start and end with an invented middle, so none is anyone's.
const evm = (head, mid, tail) => `0x${head}${mid.repeat(32).slice(0, 32)}${tail}`;
const bech = (head, mid, tail) => `bc1q${head}${mid.repeat(30).slice(0, 30)}${tail}`;
const REAL = evm('a1b2', '5e', 'c3d4');
const PLANTED = evm('a1b2', '07', 'c3d4');

test('a copied address that shares both ends with one copied before gets one quiet note, even after a restart', async () => {
  let disk = null;   // the settings file, as text
  const memory = { read: () => (disk ? JSON.parse(disk) : null), write: (m) => { disk = JSON.stringify(m); } };
  const run = () => {
    const l = load();
    const notes = [];
    const logs = [];
    let ear = null;
    l.cw.start({ links: () => false, commands: () => false, wallets: () => true, browserOpen: () => false, listen: (h) => { ear = h; }, listening: () => Boolean(ear), memory, log: (s) => logs.push(s), onWallet: (w) => notes.push(w) });
    let tick = 1000;
    // Each copy a minute apart, with Ctrl+C pressed just before: the person's own copies, never a swap.
    const copy = async (text) => { tick += 60000; l.fake.board = text; ear({ tick, idle: 20, owner: 'notepad', text }); await new Promise((r) => setImmediate(r)); };
    return { ...l, notes, logs, copy };
  };

  const first = run();
  try {
    await first.copy(REAL);
    await first.copy(REAL);                                   // the same address again: silent
    await first.copy(evm('a1b2', '5e', 'ffff'));              // same start, different end: silent
    await first.copy(bech('w8k3', 'q', 'x7m2'));
    await first.copy(bech('w8k3', 'z', 'x7m3'));              // two bc1q addresses with different ends: silent
    assert.deepEqual(first.notes, []);
  } finally { first.restore(); }

  // A restart: the module and its memory are new, only the settings file is left.
  const second = run();
  try {
    await second.copy(PLANTED);
    assert.deepEqual(second.notes, [{ kind: 'evm', reason: 'lookalike' }], 'the planted look-alike fires');
    assert.equal(second.fake.board, PLANTED, 'the clipboard is never changed');
    await second.copy(REAL);
    await second.copy(PLANTED);
    assert.equal(second.notes.length, 1, 'each pair warns once');
    // Upper and lower case of a hex address are one address.
    await second.copy(`0x${REAL.slice(2).toUpperCase()}`);
    assert.equal(second.notes.length, 1);
    assert.deepEqual(second.logs, ['wallet address look-alike copied (evm)'], 'the log names the kind only');
  } finally { second.restore(); }

  // Never a whole address, nor any 9 characters of one, in the settings file: only the ends and codes.
  for (const a of [REAL, PLANTED, bech('w8k3', 'q', 'x7m2')]) {
    const c = a.toLowerCase().replace(/^0x|^bc1q/, '');
    for (let i = 0; i + 9 <= c.length; i++) assert.ok(!disk.toLowerCase().includes(c.slice(i, i + 9)), `${c.slice(i, i + 9)} is not stored`);
  }
  const kept = JSON.parse(disk);
  assert.deepEqual(Object.keys(kept.seen[0]).sort(), ['at', 'h', 'id', 'k', 't']);
});

test('a copied address is compared without the start every address of its kind shares, and an IBAN is never kept', async () => {
  const { core } = require('../desktop/src/clipwatch.js')._test;
  assert.equal(core('evm', '0xA1B2ffff'), 'a1b2ffff');
  assert.equal(core('btc', 'bc1qW8K3'), 'w8k3');
  assert.equal(core('btc', 'bc1pW8K3'), 'w8k3');
  assert.equal(core('ltc', 'ltc1qW8K3'), 'w8k3');
  assert.equal(core('trx', 'TAbCd'), 'AbCd', 'base58 keeps its case');
  assert.equal(core('sol', 'AbCd'), 'AbCd');
  const { cw, restore } = load();
  let wrote = false;
  let ear = null;
  try {
    cw.start({ links: () => false, commands: () => false, wallets: () => true, browserOpen: () => false, listen: (h) => { ear = h; }, listening: () => true, memory: { read: () => null, write: () => { wrote = true; } }, log: () => {} });
    ear({ tick: 1000, idle: 20, owner: 'notepad', text: 'GB82WEST12345698765432' });
    await new Promise((r) => setImmediate(r));
    assert.equal(wrote, false);
  } finally { restore(); }
});

test('the look-alike note says compare, never scam, makes no sound, and turning wallet guard off forgets', () => {
  const main = read('desktop/src/main.js');
  const note = main.split("w.reason === 'lookalike'")[1].split('return;')[0];
  assert.match(note, /This address looks like one you copied before, but it is a different address\. Compare the middle before you send\./);
  assert.match(note, /, null, true\)/, 'silent');
  assert.doesNotMatch(note, /scam|—|\d+ in /i);
  assert.match(main.split('function setWalletGuard(')[1].split('\n}')[0], /if \(!enabled\) forgetWallets\(\)/);
  assert.match(read('web/privacy.html'), /first and last four characters/);
});

test('wallet guard is on by default on Windows, its off switch is behind the parent lock, and privacy says so', () => {
  const main = read('desktop/src/main.js');
  assert.match(main, /store\.get\('walletGuard', true\)/);
  assert.match(main, /lock\.guard\('wallet guard off', !enabled\)/);
  assert.match(main, /Something on this PC replaced the wallet address you copied\. Sentinel put yours back\. Check every character before you send\./);
  assert.match(read('web/privacy.html'), /Wallet guard/);
  assert.doesNotMatch(read('web/privacy.html').split('Wallet guard')[1].split('</li>')[0], /—/);
});
