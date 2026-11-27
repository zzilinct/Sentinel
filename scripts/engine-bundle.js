'use strict';
/**
 * The companion's on-device engine: server/lib/scan/{brands,lists,url}.js, the very files the scanner runs, packed into
 * extension/src/lib/engine.js (one ES module, nothing to fetch) with the two things a browser has no file system for
 * (the ordinary-word list and the most linked-to sites) put in as data. It answers "is this host on the threat list"
 * and "does this address copy a well-known brand", on the person's own device, with nothing sent anywhere.
 *
 *   node scripts/engine-bundle.js --write   rebuild extension/src/lib/engine.js (after changing any of those files)
 *   node scripts/build-extension.js         fails when engine.js is not what those files make
 *
 * tests/device-engine.test.js holds the engine to the scanner's own verdicts.
 * The threat list's file format and its hash live here too, so the builder (scripts/build-threat-list.js) and the
 * browser can never disagree on either.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SCAN = path.join(ROOT, 'server', 'lib', 'scan');
const OUT = path.join(ROOT, 'extension', 'src', 'lib', 'engine.js');

/* ---- these two functions are copied into the engine as written: one definition, node and browser alike ---- */

// A host's 64-bit name for the list: two different 32-bit hashes. ponytail: not a cryptographic hash. A list is public
// and nobody can choose what it holds, so a made-up collision gains an attacker nothing. Two 32-bit halves keep a
// chance match among half a million entries near 1 in 10^13 per lookup.
function hash64(text) {
  let hi = 0x811c9dc5;
  let lo = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    hi = Math.imul(hi ^ c, 0x01000193) >>> 0;
    lo = Math.imul(lo ^ c, 0x5bd1e995) >>> 0;
    lo = (lo ^ (lo >>> 15)) >>> 0;
  }
  return [hi, lo];
}
// Ordinary words are kept as 32-bit hashes, sorted. ponytail: about 1 word in 25,000 that is not on the list reads as
// one (a squat then reads as a different word, and is let by); a Bloom filter or a trie would be exact, and larger.
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The threat list as a file: 16 bytes (SNTL, version, count, made at), then per host two words, sorted: hash high, hash low with the threat in its last two bits. */
const THREATS = ['scam', 'virus', 'malware'];
function listFile(rows, madeAt = Math.floor(Date.now() / 1000)) {
  const seen = new Map();
  for (const { host, threat } of rows) {
    const h = String(host).toLowerCase().replace(/^www\./, '');
    if (!/^[a-z0-9.-]+$/.test(h) || !h.includes('.')) continue;
    const [hi, lo] = hash64(h);
    const key = `${hi}:${lo >>> 2}`;
    const code = Math.max(0, THREATS.indexOf(threat));
    const was = seen.get(key);
    if (!was || code > (was[1] & 3)) seen.set(key, [hi, ((lo & ~3) | code) >>> 0]);
  }
  const all = [...seen.values()].sort((a, b) => a[0] - b[0] || (a[1] >>> 2) - (b[1] >>> 2));
  const buf = Buffer.alloc(16 + all.length * 8);
  buf.writeUInt32LE(0x4c544e53, 0);
  buf.writeUInt32LE(1, 4);
  buf.writeUInt32LE(all.length, 8);
  buf.writeUInt32LE(madeAt >>> 0, 12);
  all.forEach(([hi, lo], i) => { buf.writeUInt32LE(hi, 16 + i * 8); buf.writeUInt32LE(lo, 20 + i * 8); });
  return buf;
}

/* ------------------------------------------------------------------------------------------------ the bundle */

const SOURCES = ['brands', 'lists', 'url'];
const sourceOf = (name) => fs.readFileSync(path.join(SCAN, `${name}.js`), 'utf8').replace(/\r\n/g, '\n');

// url.js reads its two lists from files; the browser has no files, so exactly these two functions are swapped for ones
// that read the packed data. If url.js is changed so they no longer match, the build stops here and says so.
function swapped(url) {
  const swap = (name, body) => {
    const re = new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}\\n`);
    if (!re.test(url)) throw new Error(`scripts/engine-bundle.js cannot find ${name}() in server/lib/scan/url.js: update the swap`);
    url = url.replace(re, () => body);
  };
  swap('ordinaryWords', `function ordinaryWords() {
  if (WORDS) return WORDS;
  const short = new Set(COMMON_SHORT_WORDS);
  let hashes = null;
  WORDS = { has: (w) => short.has(w) || (hashes || (hashes = DATA.words())).has(w) };
  return WORDS;
}
`);
  swap('popularSites', `function popularSites() {
  if (!POPULAR) POPULAR = new Set(DATA.popular());
  return POPULAR;
}
`);
  return url;
}

function build(overrides = {}) {
  const src = Object.fromEntries(SOURCES.map((n) => [n, overrides[n] != null ? overrides[n] : sourceOf(n)]));
  const words = zlib.gunzipSync(fs.readFileSync(path.join(SCAN, 'words.txt.gz'))).toString('utf8').split('\n').map((w) => w.trim()).filter(Boolean);
  const hashes = new Uint32Array([...new Set(words.map(hash32))].sort((a, b) => a - b));
  const popular = fs.readFileSync(path.join(SCAN, 'wellknown.txt'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const sha = crypto.createHash('sha256').update(SOURCES.map((n) => src[n]).join('\0')).update(Buffer.from(hashes.buffer)).update(popular.join('\n')).digest('hex').slice(0, 16);
  const mods = SOURCES.map((n) => `  './${n}': (module, exports, require) => {\n${n === 'url' ? swapped(src[n]) : src[n]}\n  }`).join(',\n');
  return `// GENERATED by scripts/engine-bundle.js from server/lib/scan/{brands,lists,url}.js (sources ${sha}). Do not edit:
// change those files, then run: node scripts/engine-bundle.js --write
// The scanner's own address rules, run on this device. Lists: the most linked-to sites and the ordinary words are data below.
const __engine = (() => {
${hash64}
${hash32}
const WORDS_B64 = '${Buffer.from(hashes.buffer).toString('base64')}';
const POPULAR_SITES = ${JSON.stringify(popular.join('\n'))};
const DATA = {
  words() {
    const bin = atob(WORDS_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const sorted = new Uint32Array(bytes.buffer);
    return { has: (w) => { const h = hash32(w); let lo = 0; let hi = sorted.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (sorted[mid] === h) return true; if (sorted[mid] < h) lo = mid + 1; else hi = mid - 1; } return false; } };
  },
  popular: () => POPULAR_SITES.split('\\n')
};
const defs = {
${mods}
};
const made = {};
function load(name) {
  if (name === 'crypto') return { createHash() { throw new Error('the on-device engine does not hash addresses'); } };
  if (!made[name]) { made[name] = { exports: {} }; defs[name](made[name], made[name].exports, load); }
  return made[name].exports;
}
const url = load('./url');

/** The threat list (file format: scripts/engine-bundle.js listFile). Nothing is listed until a list is loaded. */
let list = null;
function loadList(buffer) {
  const head = new Uint32Array(buffer, 0, 4);
  if (head[0] !== 0x4c544e53 || head[1] !== 1 || buffer.byteLength !== 16 + head[2] * 8) throw new Error('not a threat list');
  list = { count: head[2], madeAt: head[3], at: new Uint32Array(buffer, 16, head[2] * 2) };
  return { count: list.count, madeAt: list.madeAt };
}
const THREAT_NAMES = ['scam', 'virus', 'malware'];
function find(host) {
  const [hi, lo] = hash64(host);
  const want = lo >>> 2;
  let a = 0;
  let b = list.count - 1;
  while (a <= b) {
    const mid = (a + b) >> 1;
    const h = list.at[mid * 2];
    const l = list.at[mid * 2 + 1];
    if (h === hi && (l >>> 2) === want) return THREAT_NAMES[l & 3];
    if (h < hi || (h === hi && (l >>> 2) < want)) a = mid + 1; else b = mid - 1;
  }
  return null;
}
/** The threat a host is listed for, or null: the host, without www, or its registrable domain (what the scanner's own lookup asks, knowledge.js). */
function listed(host) {
  if (!list || !list.count) return null;
  const p = url.analyze('http://' + host + '/');
  if (!p) return null;
  for (const h of new Set([p.host, p.host.replace(/^www\\./, ''), p.registrable])) {
    const t = find(h);
    if (t) return t;
  }
  return null;
}
/** The brand's own address this one copies ("paypal.com" for "paypa1-login.com"), or null. Same rule as the scanner's. */
function lookalike(address) {
  const p = url.analyze(address);
  if (!p) return null;
  const copy = url.brandInfo(p).lookalike;
  return copy ? { host: p.host, brand: copy.domains[0] } : null;
}
return { loadList, listed, lookalike, listInfo: () => (list ? { count: list.count, madeAt: list.madeAt } : null) };
})();
export const { loadList, listed, lookalike, listInfo } = __engine;
`;
}

/** Is the engine in the repository what the scanner's files make? (Line endings are the checkout's, not the engine's.) */
const upToDate = () => fs.readFileSync(OUT, 'utf8').split('\r\n').join('\n') === build();

if (require.main === module) {
  const text = build();
  if (process.argv.includes('--write')) { fs.writeFileSync(OUT, text); console.log(`wrote ${path.relative(ROOT, OUT)}, ${text.length} bytes`); }
  else process.exit(upToDate() ? 0 : (console.error('extension/src/lib/engine.js is out of date: node scripts/engine-bundle.js --write'), 1));
}
module.exports = { build, hash64, hash32, listFile, upToDate, OUT };
