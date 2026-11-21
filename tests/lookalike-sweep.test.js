'use strict';
/**
 * Popular real sites are never "misspellings" of a brand (url.brandInfo with the list of the most linked-to sites),
 * and a one-letter-off copy of a popular site that is not a brand is noticed, quietly (url.popularCopy, U24).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'test';
const { analyze, brandInfo, popularSites, isRealWords } = require('../server/lib/scan/url');
const { ALL_CHECKS } = require('../server/lib/scan/checklist');
const offline = require('../server/lib/scan/offline');
const L = require('../server/lib/scan/lists');

const POPULAR = popularSites();
const OFF = new Set();
const parse = (d) => analyze(`https://${d}/`);
const U24 = ALL_CHECKS.find((c) => c.id === 'U24');
const u24 = (d, research = null) => U24.run({ p: parse(d), brand: brandInfo(parse(d)), research, hint: null });

// Every wellknown.txt site the edit-distance rule calls a brand look-alike when the list is not consulted. Reviewed
// by hand (2026-11-20): each is a real site with a name of its own, none a typo squat. instagr.am is Instagram's own.
// A new list that adds a name here fails this test until someone reviews it; a squat that ranks goes to MUST_STAY.
// correios.com.br and telegraaf.nl left this list in 1.21.0: they are foreign words (L.FOREIGN_WORDS), word-alike either way.
const KNOWN_REAL = [
  'allenpress.com aliexpress', 'elle.com zelle', 'elle.fr zelle', 'instagr.am instagram',
  'lacoste.com laposte', 'lexpress.fr aliexpress', 'pcloud.com icloud', 'pcloud.link icloud', 'qcloud.com icloud',
  'tbank.ru tdbank', 'telegraphindia.com telegram'
];
// Ranked sites that are copies all the same, and stay flagged. None in today's list.
const MUST_STAY = [];

test('the sweep: every popular site the look-alike rule hits is a reviewed real site, and the list relieves each one', () => {
  const before = [];
  const after = [];
  const copied = [];
  for (const d of POPULAR) {
    const p = parse(d);
    const off = brandInfo(p, OFF);
    if (off.lookalike) before.push(`${d} ${off.lookalike.token}`);
    const on = brandInfo(p);
    if (on.lookalike) after.push(d);
    if (on.popularLookalike) copied.push(d);
  }
  assert.deepEqual(copied, [], 'no popular site is a copy of another');
  console.log(`popular sites called a look-alike: ${before.length} with the list off, ${after.length} with it on`);
  assert.deepEqual(before.sort(), [...KNOWN_REAL, ...MUST_STAY].sort());
  assert.deepEqual(after.sort(), MUST_STAY.map((e) => e.split(' ')[0]).sort());
  for (const e of KNOWN_REAL) {
    const b = brandInfo(parse(e.split(' ')[0]));
    assert.equal(b.wordLike && b.wordLike.why, 'popular', e);
    assert.equal(u24(e.split(' ')[0]).status, 'pass', e);
  }
});

test('on a popular name, a disguise still alarms: digits, rn, vv, doubled letters, i for l, and the brand inside', () => {
  const j = (...parts) => parts.join('');
  const disguises = [j('paypa', '1.com'), j('rn', 'icrosoft.com'), j('roblo', 'xx.com'), j('onedr', 'lve.com'), j('trezo', 'orr.com'), j('g', '00', 'gle.com'), j('micr', '0', 'soft.com')];
  const listed = new Set(disguises);
  for (const d of disguises) {
    assert.ok(brandInfo(parse(d), OFF).lookalike, `${d} is a look-alike with the list off`);
    assert.ok(brandInfo(parse(d), listed).lookalike, `${d} stays a look-alike when it ranks`);
  }
  const inside = j('paypal', '-help.com');
  const b = brandInfo(parse(inside), new Set([inside]));
  assert.equal(b.inDomain && b.inDomain.token, 'paypal');
  // A customer's page on a hosting platform is never well known, so it is not relieved.
  const short = j('telegrafm', '.com');
  assert.equal(brandInfo(parse(short), new Set([short])).wordLike.why, 'popular');
  assert.equal(brandInfo(parse(`${short.split('.')[0]}.weebly.com`), new Set([`${short.split('.')[0]}.weebly.com`])).lookalike.token, 'telegram');
});

test('overdrive.com and the real sites in the evaluation stay free of a badge', () => {
  assert.equal(offline.scanAddress('https://www.overdrive.com/').overall.badge, null);
  for (const { url } of require('../scripts/evaluate-lookalikes.json')) {
    assert.equal(offline.scanAddress(url).overall.badge, null, url);
  }
});

// Copies of popular sites that are not protected brands, made from the list itself: the middle letter left out,
// or the two middle letters swapped, of every tenth popular name of eight letters or more.
function copies() {
  const out = [];
  let k = 0;
  for (const site of POPULAR) {
    const [name, ...rest] = site.split('.');
    if (!/^[a-z]{8,}$/.test(name) || k++ % 10) continue;
    const m = Math.floor(name.length / 2);
    for (const fake of [name.slice(0, m) + name.slice(m + 1), name.slice(0, m) + name[m + 1] + name[m] + name.slice(m + 2)]) {
      const d = `${fake}.${rest.join('.')}`;
      if (fake === name || POPULAR.has(d) || L.NOT_LOOKALIKES.has(fake)) continue;
      const b = brandInfo(parse(d));
      if (b.owner || b.lookalike || b.wordLike || b.inDomain || b.inSubdomain || isRealWords(fake)) continue;
      out.push({ d, site, b });
    }
  }
  return out;
}

test('a one-letter-off copy of a popular site gains the signal', () => {
  const made = copies();
  assert.ok(made.length >= 200, `only ${made.length} copies made`);
  const missed = made.filter((c) => !c.b.popularLookalike);
  assert.deepEqual(missed.map((c) => c.d), [], 'every copy is noticed');
  // Not on the website's in-browser check, which ships without the list.
  assert.equal(brandInfo(parse(made[0].d), OFF).popularLookalike, null);
  console.log(`copies of popular sites noticed: ${made.length - missed.length} of ${made.length}`);
});

test('the copy signal alone scores nothing; beside a throwaway ending or a young registration it counts', () => {
  const j = (...parts) => parts.join('');
  const alone = j('wikiped', 'ai.org');
  assert.equal(brandInfo(parse(alone)).popularLookalike, 'wikipedia.org');
  assert.deepEqual([u24(alone).status, u24(alone).points], ['pass', 0]);
  assert.equal(offline.scanAddress(`https://${alone}/`).overall.badge, null);
  const cheap = j('wikiped', 'ai.xyz');
  assert.deepEqual([u24(cheap).status, u24(cheap).points], ['fail', 36]);
  assert.match(u24(cheap).detail, /^Similar spelling to wikipedia\.org$/);
  const young = { registration: { available: true, registered: true, createdAt: Date.now() - 20 * 86400000 } };
  const old = { registration: { available: true, registered: true, createdAt: Date.now() - 900 * 86400000 } };
  assert.equal(u24(alone, young).status, 'fail');
  assert.equal(u24(alone, old).status, 'pass');
  // The same name on another ending is the site's country address, not a copy; a digit for a letter is.
  assert.equal(brandInfo(parse('wikipedia.de')).popularLookalike, null);
  assert.equal(brandInfo(parse(j('wikiped', '1a.de'))).popularLookalike, 'wikipedia.org');
});

test('the desktop gets the list: sync-shared copies wellknown.txt', () => {
  const sync = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'scripts', 'sync-shared.js'), 'utf8');
  assert.match(sync, /'wellknown\.txt'/);
});
