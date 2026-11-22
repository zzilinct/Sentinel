'use strict';
/**
 * International names (U02, U24, url.js decodeLabel and idnLookalike): a name in another alphabet drawn to read as a
 * brand is named as that brand; an honest name in its own alphabet is not held against it.
 *
 * Every test host is made here from its letters with url.domainToASCII, never pasted in its encoded form.
 */
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { domainToASCII, domainToUnicode } = require('url');
const U = require('../server/lib/scan/url');
const { scanAddress, _test: { checksOf } } = require('../server/lib/scan/offline');
const { engineBundle } = require('../scripts/build-static');
const { plainFor: explain } = require('../server/lib/scan/plain');

const ROOT = path.join(__dirname, '..');
const ch = (...codes) => String.fromCodePoint(...codes);
// Cyrillic, Greek and Armenian letters drawn like Latin ones, by code point.
const CY = { a: 0x430, c: 0x441, e: 0x435, o: 0x43e, p: 0x440, y: 0x443, l: 0x4cf, s: 0x455, i: 0x456 };
const GR = { a: 0x3b1, o: 0x3bf, p: 0x3c1, y: 0x3b3, i: 0x3b9, v: 0x3bd };
const AR = { g: 0x581, o: 0x585 };
/** A word with the given letters swapped for another alphabet's twins. */
const swap = (word, table, which = Object.keys(table)) => [...word].map((c) => (which.includes(c) && table[c] ? ch(table[c]) : c)).join('');
const host = (unicode) => {
  const a = domainToASCII(unicode);
  assert.ok(a && a.includes('xn--'), `the test needs ${unicode} to encode`);
  return a;
};
const check = (h, id) => checksOf(`https://${h}/`).find((c) => c.id === id);

const FAKES = [
  ['paypal', swap('paypal', CY)],            // every letter Cyrillic
  ['paypal', swap('paypal', CY, ['a'])],     // one Cyrillic letter among Latin ones
  ['paypal', swap('paypal', GR)],
  ['apple', swap('apple', CY)],
  ['apple', swap('apple', GR, ['a', 'p'])],
  ['google', swap('google', CY)],
  ['google', swap('google', GR)],
  ['google', swap('google', AR)],
  ['microsoft', swap('microsoft', CY)],
  ['microsoft', swap('microsoft', GR)]
].map(([brand, name]) => [brand, host(`${name}.com`)]);

const HONEST = [
  `m${ch(0xfc)}nchen.de`,                                   // münchen
  `b${ch(0xfc)}cher.ch`,                                    // bücher
  `${ch(0x65e5, 0x672c, 0x8a9e)}.jp`,                       // 日本語
  `${ch(0x44f, 0x43d, 0x434, 0x435, 0x43a, 0x441)}.${ch(0x440, 0x444)}`,   // яндекс.рф
  `${ch(0x3b5, 0x3bb, 0x3bb, 0x3ac, 0x3b4, 0x3b1)}.gr`,     // ελλάδα
  `${ch(0x131)}${ch(0x15f)}${ch(0x131)}k.com.tr`,           // ışık, with the Turkish dotless i
  `${ch(0x30bd, 0x30cb, 0x30fc)}tv.jp`,                     // Katakana beside Latin, with the long-vowel mark
  `${ch(0xd55c)}${ch(0xad6d)}bank.kr`                       // Hangul beside Latin
].map(host);

test('a name in another alphabet drawn as a brand is named as that brand, at the look-alike weight', () => {
  for (const [brand, h] of FAKES) {
    const u24 = check(h, 'U24');
    assert.equal(u24.status, 'fail', `${domainToUnicode(h)} (${h})`);
    assert.equal(u24.points, 70, h);
    assert.match(u24.detail, new RegExp(`look like ${brand}\\.com$`), h);
    assert.ok(scanAddress(`https://${h}/`).overall.badge, `${h} is flagged`);
  }
});

test('Latin mixed with Cyrillic or Greek in one name fails U02; one alphabet alone is judged by U24', () => {
  assert.equal(check(FAKES[1][1], 'U02').status, 'fail');
  assert.equal(check(FAKES[1][1], 'U02').points, 30);
  assert.match(check(FAKES[1][1], 'U02').detail, /^Mixes (Latin and Cyrillic|Cyrillic and Latin) letters in one name$/);
  const whole = check(FAKES[0][1], 'U02');   // all Cyrillic: no mixing, and U24 names the brand
  assert.equal(whole.status, 'pass');
  assert.match(whole.detail, /names the brand/);
});

test('honest international names pass U02 with no points and are no look-alike', () => {
  for (const h of HONEST) {
    const u02 = check(h, 'U02');
    assert.equal(u02.status, 'pass', `${domainToUnicode(h)}: ${u02.detail}`);
    assert.equal(u02.points, 0, h);
    assert.notEqual(check(h, 'U24').status, 'fail', h);
    assert.equal(scanAddress(`https://${h}/`).overall.badge, null, `${domainToUnicode(h)} is not flagged`);
  }
  // The international names in the honest sample the false-alarm gate judges.
  const sample = fs.readFileSync(path.join(ROOT, 'scripts', 'fpgate', 'domains.txt'), 'utf8').split(/\r?\n/).filter((l) => l.includes('xn--') && !l.startsWith('#'));
  assert.ok(sample.length > 10);
  for (const h of sample) assert.equal(check(h.trim(), 'U02').status, 'pass', h);
});

test('a label that does not decode to a name keeps the old 30 points', () => {
  const emoji = host(`${ch(0x1f4a9)}.com`);   // a symbol, which no honest name is spelled with
  assert.equal(U.decodeLabel(emoji.split('.')[0]), null);
  const u02 = check(emoji, 'U02');
  assert.equal(u02.status, 'fail');
  assert.equal(u02.points, 30);
  for (const bad of ['xn--', 'xn--a', 'xn--zz', 'xn--abc-', 'xn--99zz']) assert.equal(U.decodeLabel(bad), null, bad);
});

test('only letters in the table count: an unmapped letter never matches, nor a near spelling or a short brand', () => {
  // paypal with a Cyrillic soft sign for the l: confusables.txt maps it to a different letter.
  assert.equal(U.brandInfo(U.analyze(`https://${host(`${swap('paypa', CY)}${ch(0x44c)}.com`)}/`)).idn, null);
  // One letter off the brand once read: never a match on international names.
  assert.equal(U.brandInfo(U.analyze(`https://${host(`${swap('paypl', CY)}.com`)}/`)).idn, null);
  // A four-letter brand (visa): too short to read as copied.
  assert.equal(U.brandInfo(U.analyze(`https://${host(`vis${ch(CY.a)}.com`)}/`)).idn, null);
  // The brand and a real word joined by a hyphen still reads as the brand.
  assert.equal(U.brandInfo(U.analyze(`https://${host(`${swap('paypal', CY, ['a'])}-help.com`)}/`)).idn.brand.token, 'paypal');
});

test('a Cyrillic copy glued to a word, and Latin letters with a stroke or another shape, are named as the brand', () => {
  // paypal with one Cyrillic letter, glued to "secure": the closest real shape of the disguise.
  const glued = host(`${swap('paypal', CY, ['a'])}secure.com`);
  assert.equal(check(glued, 'U24').points, 70, glued);
  assert.ok(scanAddress(`https://${glued}/`).overall.badge, `${glued} is flagged`);
  // Dotless i, the script g, the alpha a, o with a stroke: one script, no accent to drop.
  for (const [brand, name] of [['linkedin', `l${ch(0x131)}nkedin`], ['google', `goo${ch(0x261)}le`], ['paypal', `p${ch(0x251)}ypal`], ['facebook', `faceb${ch(0xf8)}ok`]]) {
    const u24 = check(host(`${name}.com`), 'U24');
    assert.equal(u24.points, 70, name);
    assert.equal(u24.detail, `Written with altered letters to look like ${brand}.com`, name);
  }
});

test('Latin beside an alphabet with no look-alike letters, and a joiner inside a Persian or Indic name, are honest', () => {
  for (const h of [host(`shop${ch(0xe44, 0xe17, 0xe22)}.com`),            // Latin beside Thai
    host(`${ch(0x645, 0x6cc, 0x200c, 0x62e, 0x648)}.ir`)]) {              // Persian, with the zero-width non-joiner
    assert.equal(check(h, 'U02').status, 'pass', `${domainToUnicode(h)}: ${check(h, 'U02').detail}`);
    assert.equal(scanAddress(`https://${h}/`).overall.badge, null, h);
  }
  // Three alphabets read "Latin, Cyrillic and Greek".
  assert.match(check(host(`p${ch(CY.a)}yp${ch(GR.a)}l.com`), 'U02').detail, /^Mixes \w+, \w+ and \w+ letters in one name$/);
});

test('the decoder agrees with Node on every international name Sentinel knows', () => {
  const names = [...fs.readFileSync(path.join(ROOT, 'server', 'lib', 'scan', 'wellknown.txt'), 'utf8').split(/\r?\n/),
    ...fs.readFileSync(path.join(ROOT, 'scripts', 'fpgate', 'domains.txt'), 'utf8').split(/\r?\n/), ...HONEST, ...FAKES.map((f) => f[1])];
  let n = 0;
  for (const h of names) {
    for (const label of h.trim().split('.')) {
      if (!label.startsWith('xn--')) continue;
      assert.equal(U.decodeLabel(label), domainToUnicode(label), label);
      n++;
    }
  }
  assert.ok(n > 30, `${n} labels`);
});

test('the website\'s bundle gives the same verdict on international names as the server', async () => {
  const gz = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'scan', 'words.txt.gz'));
  const win = {};
  vm.runInNewContext(engineBundle(), {
    window: win,
    document: { currentScript: { src: 'https://example.github.io/sentinel/assets/js/engine.js' } },
    fetch: async (url) => {
      const b = url.endsWith('wellknown.txt.gz') ? require('zlib').gzipSync(fs.readFileSync(path.join(ROOT, 'server', 'lib', 'scan', 'wellknown.txt'))) : gz;
      return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    },
    URL, Response, Blob, DecompressionStream, TextDecoder, console
  });
  for (const h of [...FAKES.map((f) => f[1]), ...HONEST]) {
    const url = `https://${h}/`;
    assert.deepEqual(JSON.parse(JSON.stringify(await win.SentinelEngine.scan(url))), JSON.parse(JSON.stringify(scanAddress(url))), h);
  }
});

test('the plain sentence names the alphabet and the brand', () => {
  const u24 = check(FAKES[0][1], 'U24');
  assert.equal(explain(u24), 'The name is written in Cyrillic letters that look like ordinary ones, to pass for paypal.com.');
  assert.match(explain(check(FAKES[1][1], 'U02')), /^The name mixes (Latin and Cyrillic|Cyrillic and Latin) letters/);
  assert.doesNotMatch(explain(u24) + explain(check(FAKES[1][1], 'U02')), /—/);
  // An accent-only copy names no alphabet: its letters are Latin ones changed.
  assert.equal(explain(check(host(`payp${ch(0xe1)}l.com`), 'U24')), 'The name uses letters with small marks or changed shapes, to pass for paypal.com.');
});

test('deskin, which compare, feeds and my sites also use, reads every plain name exactly as before', () => {
  const lines = ['server/lib/scan/wellknown.txt', 'scripts/fpgate/domains.txt']
    .flatMap((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/)).filter((l) => l && !l.startsWith('#'));
  const sum = crypto.createHash('sha256').update(lines.map((l) => U.deskin(l)).join('\n')).digest('hex');
  assert.equal(sum, DESKIN_SUM, `deskin changed: ${sum}`);
});
// The sum of deskin over those names with the rules of 1.20.4.
const DESKIN_SUM = '3fd77efa51d1298f1824aa10ce13a939cba4813ed185e3ccf6c1ca46a2efcbf7';
