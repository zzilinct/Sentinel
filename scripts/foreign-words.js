'use strict';
/**
 * Makes lists.js's FOREIGN_WORDS: real words in Spanish, German, French, Portuguese, Italian and Dutch that are
 * spelled within two letters of a brand Sentinel protects ("chasse" near chase, "welle" near wells). Read as words,
 * they are a local name, not a misspelled brand (url.js, brandInfo).
 *
 *   node scripts/foreign-words.js --dir <folder with es_50k.txt, de_50k.txt, ...>
 *
 * The lists are hermitdave/FrequencyWords, 2018 (the 50,000 most frequent words of OpenSubtitles2018 per language),
 * content licensed CC BY-SA 4.0. Runs on GitHub's machines only (.github/workflows/foreign-words.yml), which
 * downloads them; the result is printed, kept as an artifact and committed by hand after a read-through.
 */
const fs = require('fs');
const path = require('path');
const L = require('../server/lib/scan/lists');
const { levenshtein, isRealWords } = require('../server/lib/scan/url');

const LANGS = ['es', 'de', 'fr', 'pt', 'it', 'nl'];

/** A word the way a domain writes it: accents dropped, ß as ss, letters a-z only; null when that is not possible. */
function fold(word) {
  const s = String(word).toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');
  return /^[a-z]+$/.test(s) ? s : null;
}

// Two letters side by side swapped ("medicrae").
const swapped = (a, b) => {
  if (a.length !== b.length) return false;
  const d = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0);
  return d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]];
};

/**
 * The words of one list (lines of "word count") that brandInfo's spelling test would take for a brand: one letter
 * off a brand of five to eight letters, two off one of nine or more, two letters swapped, or a brand of seven or
 * more one letter off at the front of a longer word. The same test as url.js, so no word is kept that never mattered.
 */
function near(text, tokens) {
  const kept = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const w = fold(line.split(' ')[0]);
    if (!w || w.length < 5 || tokens.includes(w) || isRealWords(w) || L.NOT_LOOKALIKES.has(w)) continue;   // known already
    // A word that reads as the brand at a glance (i for l, a doubled letter) stays a look-alike, word or not.
    const il = (s) => s.replace(/i/g, 'l').replace(/(.)\1+/g, '$1');
    if (tokens.some((t) => il(w) === il(t))) continue;
    const hit = tokens.some((t) => {
      const d = levenshtein(w, t);
      if ((d > 0 && d <= (t.length >= 9 ? 2 : 1)) || swapped(w, t)) return true;
      return t.length >= 7 && w.length > t.length && [t.length - 1, t.length, t.length + 1].some((n) => { const p = levenshtein(w.slice(0, n), t); return p > 0 && p <= 1; });
    });
    if (hit) kept.add(w);
  }
  return kept;
}

function main() {
  const i = process.argv.indexOf('--dir');
  if (i < 0) throw new Error('usage: node scripts/foreign-words.js --dir <folder>');
  const tokens = [...new Set(L.PROTECTED_BRANDS.map((b) => b.token).filter((t) => t.length >= 5))];
  const all = new Set();
  for (const lang of LANGS) {
    const kept = near(fs.readFileSync(path.join(process.argv[i + 1], `${lang}_50k.txt`), 'utf8'), tokens);
    console.log(`${lang}: ${kept.size} words kept`);
    for (const w of kept) all.add(w);
  }
  console.log(`all: ${all.size} words`);
  const words = [...all].sort();
  const lines = [];
  for (let at = 0; at < words.length; at += 12) lines.push(`  ${words.slice(at, at + 12).map((w) => `'${w}'`).join(', ')}`);
  console.log(`\n${lines.join(',\n')}`);
}

if (require.main === module) main();
module.exports = { fold, near };
