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

/** The words of one list (lines of "word count") that sit within two letters of a brand of five letters or more. */
function near(text, tokens) {
  const kept = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const w = fold(line.split(' ')[0]);
    if (!w || w.length < 5 || tokens.includes(w) || isRealWords(w)) continue;   // English words are known already
    if (tokens.some((t) => Math.abs(t.length - w.length) <= 2 && levenshtein(w, t) <= 2)) kept.add(w);
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
