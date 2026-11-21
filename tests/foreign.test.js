'use strict';
/**
 * Real words in other languages near a brand (lists.js FOREIGN_WORDS): read as the word, a small note, not a
 * misspelled brand. Look-alike letters still win, and the words never join the English list.
 */
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../server/lib/scan/lists');
const U = require('../server/lib/scan/url');
const { scanAddress, _test: { checksOf } } = require('../server/lib/scan/offline');
const { fold, near } = require('../scripts/foreign-words');

const info = (h) => U.brandInfo(U.analyze(`https://${h}/`));
const u24 = (h) => checksOf(`https://${h}/`).find((c) => c.id === 'U24');

test('a real word in Spanish, German, French, Portuguese, Italian or Dutch is the word, not the brand', () => {
  // correo (Spanish, mail), financeiro (Portuguese), medicamento, zellen and welle (German), vento (Italian), and two
  // that used to be hand-kept exceptions: welle and celle.
  for (const h of ['correo.es', 'financeiro.com.br', 'medicamento.com', 'zellen.de', 'vento.it', 'welle.de', 'celle.de', 'revolucion.es']) {
    const b = info(h);
    assert.equal(b.lookalike, null, `${h} is not a look-alike`);
    assert.ok(b.wordLike, `${h} is noted as a word near a brand`);
    assert.equal(u24(h).status, 'warn', h);
    assert.equal(u24(h).points, 12, h);
    assert.equal(scanAddress(`https://${h}/`).overall.badge, null, `${h} is not flagged`);
  }
});

test('look-alike letters still win: a digit, rn, a doubled letter', () => {
  const brand = (h) => (info(h).lookalike || {}).token;
  assert.equal(brand('paypa1.com'), 'paypal');
  assert.equal(brand('onedrlve.com'), 'onedrive');
  assert.equal(brand('robloxx.com'), 'roblox');
  assert.equal(brand('micr0soft.com'), 'microsoft');
  for (const h of ['paypa1.com', 'onedrlve.com', 'robloxx.com', 'micr0soft.com']) assert.equal(u24(h).status, 'fail', h);
});

test('the words stay out of the English list, which also decides brand-plus-word names and typed mashes', () => {
  assert.ok(L.FOREIGN_WORDS.has('welle'));
  assert.equal(U.isRealWords('welle'), false);
  assert.equal(U.isRealWords('paypalwelle'), false);
  // The hand-kept exceptions that are words in another language live here now, not there.
  for (const w of ['welle', 'celle', 'chasse', 'appel', 'leger']) assert.ok(!L.NOT_LOOKALIKES.has(w), w);
  for (const w of L.FOREIGN_WORDS) assert.match(w, /^[a-z]{5,}$/, w);
});

test('the list builder folds words as a domain writes them and keeps only words the spelling test would take', () => {
  assert.equal(fold('Straße'), 'strasse');
  assert.equal(fold('corazón'), 'corazon');
  assert.equal(fold("l'été"), null);
  const tokens = ['paypal', 'correos', 'discord'];
  // paypai reads as paypal at a glance: never kept, so it stays a look-alike.
  const kept = near('correo 120\npaypai 5\npaypall 5\nmaison 900\ndiscorde 4\nzz 1\n', tokens);
  assert.deepEqual([...kept].sort(), ['correo', 'discorde']);
  // telegramm (German) is the one put in by hand: the builder leaves out every word with a brand's letter doubled.
  for (const w of L.FOREIGN_WORDS) assert.equal(near(`${w} 1`, L.PROTECTED_BRANDS.map((b) => b.token).filter((t) => t.length >= 5)).size, w === 'telegramm' ? 0 : 1, `${w} is one the builder keeps`);
});

test('a word of its own that holds a brand, and a word in another language spelled with a doubled letter, are words', () => {
  // telegramm (German), telegramma (Italian), telegrams: the brand is inside the word's own spelling.
  for (const h of ['telegramm.de', 'telegramma.it', 'telegrams.com']) {
    assert.equal(info(h).lookalike, null, h);
    assert.equal(scanAddress(`https://${h}/`).overall.badge, null, `${h} is not flagged`);
  }
  // The brand joined to bait is still borrowed.
  assert.equal(info('telegrammsupport.com').inDomain.token, 'telegram');
  assert.ok(scanAddress('https://telegrammsupport.com/').overall.badge);
  // A plural of a popular site's name is how people write it, not a copy; one letter changed still is.
  assert.equal(info('wikipedias.top').popularLookalike, null);
  assert.equal(info('wikipedla.top').popularLookalike, 'wikipedia.org');
});
