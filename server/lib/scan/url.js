'use strict';
/** URL parsing and string-similarity helpers shared by every scan stage. */
const crypto = require('crypto');
const L = require('./lists');

/*
 * Ordinary words, to read a name the way a person does: "overdrive" is two real words ("over", "drive"), not
 * "onedrive" misspelled. The ENABLE word list (public domain), words of four letters or more; shorter words only
 * from the short list below, so obscure three-letter words cannot make any string look like words.
 */
const COMMON_SHORT_WORDS = ['one', 'two', 'ten', 'new', 'net', 'web', 'app', 'pay', 'get', 'all', 'box', 'bit', 'big', 'now', 'top', 'hub',
  'the', 'and', 'for', 'car', 'buy', 'sea', 'sky', 'sun', 'air', 'art', 'fly', 'fit', 'fix', 'job', 'key', 'lab', 'law', 'map', 'max', 'mix',
  'out', 'own', 'pet', 'pro', 'run', 'tax', 'way', 'zip', 'dev', 'doc', 'kit', 'cup', 'eat', 'cat', 'dog', 'red', 'hot', 'bet', 'day', 'eye',
  'fun', 'gym', 'ink', 'joy', 'kid', 'man', 'men', 'mom', 'dad', 'oil', 'old', 'our', 'pen', 'pop', 'raw', 'sip', 'spa', 'tea', 'toy', 'van',
  'war', 'win', 'yes', 'you', 'zoo', 'bus', 'bay', 'bee', 'bio', 'blue', 'cab', 'cam', 'cod', 'com', 'cow', 'cut', 'die', 'dry', 'ear', 'egg',
  'end', 'fan', 'far', 'fat', 'fee', 'few', 'fox', 'gap', 'gas', 'gem', 'god', 'gun', 'guy', 'hat', 'hen', 'hip', 'hit', 'ice', 'ivy', 'jam',
  'jet', 'leg', 'lid', 'lip', 'log', 'low', 'mad', 'mat', 'mud', 'nut', 'oak', 'off', 'pad', 'pan', 'pie', 'pig', 'pin', 'pot', 'rat', 'ray',
  'rib', 'rod', 'row', 'rub', 'sad', 'saw', 'set', 'sew', 'sit', 'six', 'ski', 'son', 'spy', 'sum', 'tab', 'tan', 'tap', 'tip', 'toe', 'ton',
  'tub', 'use', 'vet', 'wax', 'wet', 'who', 'why', 'wig', 'yard', 'yet'];
let WORDS = null;
function ordinaryWords() {
  if (WORDS) return WORDS;
  try {
    const text = require('zlib').gunzipSync(require('fs').readFileSync(require('path').join(__dirname, 'words.txt.gz'))).toString('utf8');
    WORDS = new Set(text.split('\n').map((w) => w.trim()).filter(Boolean));
  } catch { WORDS = new Set(); }
  for (const w of COMMON_SHORT_WORDS) WORDS.add(w);
  return WORDS;
}
/*
 * The most linked-to sites on the web (wellknown.txt, made by scripts/wellknown.js; its header names the source and
 * licence). Read once. Where it is not shipped (the website's in-browser check) the set is empty and nothing changes.
 */
let POPULAR = null;
function popularSites() {
  if (POPULAR) return POPULAR;
  let text = '';
  try { text = String(require('fs').readFileSync(require('path').join(__dirname, 'wellknown.txt'), 'utf8') || ''); } catch { /* not shipped */ }
  POPULAR = new Set(text.split(/\r?\n/).filter((l) => l && !l.startsWith('#')));
  return POPULAR;
}

/** Is this name one to three ordinary words ("overdrive", "over-drive", "bluewater")? */
function isRealWords(name) {
  const W = ordinaryWords();
  const parts = String(name || '').toLowerCase().split(/[-_]/).filter(Boolean);
  if (!parts.length || parts.some((p) => /[^a-z]/.test(p))) return false;
  const split = (s, left) => {
    if (W.has(s)) return true;
    if (left <= 1) return false;
    for (let i = 3; i <= s.length - 3; i++) if (W.has(s.slice(0, i)) && split(s.slice(i), left - 1)) return true;
    return false;
  };
  return parts.every((p) => split(p, 3));
}

// Country-code second levels ("com.bi", "co.ke", "org.ng") that behave like suffixes.
const GENERIC_SECOND_LEVEL = new Set(['com', 'net', 'org', 'co', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'mil', 'nic']);
// Hosting platforms where each customer gets a subdomain: treat those like public
// suffixes, so "brand-login.weebly.com" is judged as its own site, not as weebly.com.
const HOSTING_SUFFIXES = new Set(L.FREE_HOSTING.filter((d) => !L.PATH_HOSTING.includes(d)));

function splitHost(host) {
  const labels = host.split('.');
  let suffix = labels[labels.length - 1] || '';
  let sldIndex = labels.length - 2;

  for (let take = Math.min(4, labels.length - 1); take >= 2; take--) {
    const candidate = labels.slice(-take).join('.');
    if (HOSTING_SUFFIXES.has(candidate) && labels.length > take) {
      suffix = candidate;
      sldIndex = labels.length - take - 1;
      return finish();
    }
  }
  if (labels.length >= 3) {
    const last2 = labels.slice(-2).join('.');
    const [second, top] = [labels[labels.length - 2], labels[labels.length - 1]];
    if (L.MULTI_SUFFIXES.has(last2) || (top.length === 2 && GENERIC_SECOND_LEVEL.has(second))) {
      suffix = last2;
      sldIndex = labels.length - 3;
    }
  }
  return finish();

  function finish() {
    const sld = sldIndex >= 0 ? labels[sldIndex] : labels[0];
    const registrable = sldIndex >= 0 ? `${sld}.${suffix}` : host;
    const subdomains = sldIndex > 0 ? labels.slice(0, sldIndex) : [];
    const hosting = HOSTING_SUFFIXES.has(suffix) ? suffix : null;
    return { labels, suffix, sld, registrable, subdomains, hosting };
  }
}

/** Normalise a raw href into the shape the checks work on. Returns null for non-web links. */
function analyze(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 4096) return null;
  let input = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) input = 'http://' + input;
  let u;
  try { u = new URL(input); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return null;

  const bare = host.replace(/^\[|\]$/g, '');
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(':');
  const parts = isIp
    ? { labels: [host], suffix: '', sld: host, registrable: host, subdomains: [], hosting: null }
    : splitHost(host);

  const file = decodeSafe(u.pathname.split('/').pop() || '');
  const exts = file.includes('.') ? file.toLowerCase().split('.').slice(1) : [];

  return {
    url: u.href,
    scheme: u.protocol.slice(0, -1),
    host,
    isIp,
    port: u.port,
    path: u.pathname || '/',
    query: u.search || '',
    file,
    ext: exts.length ? exts[exts.length - 1] : '',
    exts,
    hasUserinfo: Boolean(u.username || u.password) || /^[a-z]+:\/\/[^/]*@/i.test(raw.trim()),
    raw,
    ...parts
  };
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Stable key for exact-URL feed matching: no fragment, no trailing slash, lower-case host. */
function urlKey(input) {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `http://${input}`);
    u.hash = '';
    const pathname = u.pathname.replace(/\/+$/, '') || '';
    const key = `${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}${pathname}${u.search}`;
    return crypto.createHash('sha1').update(key).digest('hex');
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- similarity */

const HOMOGLYPHS = [
  [/[1|!]/g, 'l'], [/0/g, 'o'], [/3/g, 'e'], [/4/g, 'a'], [/5/g, 's'],
  [/7/g, 't'], [/8/g, 'b'], [/9/g, 'g'], [/\$/g, 's'], [/rn/g, 'm'], [/vv/g, 'w']
];

/** Collapse look-alike characters so "paypa1" and "paypal" compare equal. */
/** Runs of one letter as one ("trezoorr" -> "trezor"): doubled letters are a look-alike the eye skips over. */
function squash(s) {
  return String(s).replace(/(.)\1+/g, '$1');
}

function deskin(s) {
  let out = String(s).toLowerCase();
  for (const [rx, to] of HOMOGLYPHS) out = out.replace(rx, to);
  return out.replace(/[^a-z]/g, '');
}

/**
 * An international name's label ("xn--mnchen-3ya") in the letters people see ("münchen"): RFC 3492 punycode, here
 * so the server, the desktop and the static site (which has no url.domainToUnicode) all read a name the same way.
 * null when the label does not decode to a name (a broken encoding, no letter outside a-z, a symbol): such a label
 * is a disguise of its own, judged by U02.
 */
function decodeLabel(label) {
  const s = String(label).toLowerCase();
  if (!s.startsWith('xn--')) return s;
  const input = s.slice(4);
  if (!/^[a-z0-9-]+$/.test(input)) return null;
  const d = input.lastIndexOf('-');
  const out = d > 0 ? [...input.slice(0, d)].map((c) => c.charCodeAt(0)) : [];
  const adapt = (delta, count, first) => {
    delta = first ? Math.floor(delta / 700) : delta >> 1;
    delta += Math.floor(delta / count);
    let k = 0;
    for (; delta > 455; k += 36) delta = Math.floor(delta / 35);
    return k + Math.floor((36 * delta) / (delta + 38));
  };
  let n = 128;
  let i = 0;
  let bias = 72;
  for (let at = d >= 0 ? d + 1 : 0; at < input.length;) {
    const old = i;
    for (let w = 1, k = 36; ; k += 36) {
      if (at >= input.length) return null;
      const c = input.charCodeAt(at++);
      const digit = c >= 97 ? c - 97 : c >= 48 && c <= 57 ? c - 22 : 36;
      if (digit >= 36) return null;
      i += digit * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < t) break;
      w *= 36 - t;
      if (i > 0x7fffffff || w > 0x7fffffff) return null;
    }
    bias = adapt(i - old, out.length + 1, old === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    out.splice(i++, 0, n);
  }
  const name = String.fromCodePoint(...out);
  // The zero-width joiners Persian and Indic names are spelled with count between two letters of such a script;
  // never beside a Latin letter, where they only hide.
  const letters = name.replace(/(?<=[\p{M}]|[^\P{L}\p{Script=Latin}])[‌‍](?=[^\P{L}\p{Script=Latin}])/gu, '');
  return /[^\x00-\x7f]/.test(name) && /^[\p{L}\p{M}\p{Nd}-]+$/u.test(letters) ? name : null;
}

/** A host with each international label decoded; the host as written when one does not decode. */
const shownHost = (host) => String(host).split('.').map((l) => decodeLabel(l) || l).join('.');

/*
 * Cyrillic, Greek and Armenian letters drawn like Latin ones, each as Unicode's confusables.txt (version 18.0.0, the
 * "MA" table) maps it to a single Latin letter. Only those: letters it maps elsewhere (Greek kappa to the Latin kra,
 * the Cyrillic soft sign to the tone six) are left out, so a name holding them never reads as a brand.
 */
const CONFUSABLES = {
  // Cyrillic: 0430 0441 0501 0435 04BB 0456 0458 04CF 043E 0440 051B 0433 0455 051D 0445 0443
  'а': 'a', 'с': 'c', 'ԁ': 'd', 'е': 'e', 'һ': 'h', 'і': 'i', 'ј': 'j', 'ӏ': 'l', 'о': 'o', 'р': 'p', 'ԛ': 'q', 'г': 'r',
  'ѕ': 's', 'ԝ': 'w', 'х': 'x', 'у': 'y',
  // Greek: 03B1 03F2 03B9 03F3 03BF 03C1 03C5 03BD 03B3
  'α': 'a', 'ϲ': 'c', 'ι': 'i', 'ϳ': 'j', 'ο': 'o', 'ρ': 'p', 'υ': 'u', 'ν': 'v', 'γ': 'y',
  // Armenian: 0581 0570 0578 0585 0566 057D 0561
  'ց': 'g', 'հ': 'h', 'ո': 'n', 'օ': 'o', 'զ': 'q', 'ս': 'u', 'ա': 'w',
  // Latin letters with no accent to drop: 0131 0251 0261 map to one letter; 00F8 0142 0111 map to a letter and a
  // combining stroke, which skeleton() drops the way it drops any accent.
  'ı': 'i', 'ɑ': 'a', 'ɡ': 'g', 'ø': 'o', 'ł': 'l', 'đ': 'd'
};

/**
 * How a decoded label reads to the eye: accents dropped, then each letter in CONFUSABLES as its Latin twin.
 * `disguised`: how many letters changed to get there. A letter left outside a-z means the name does not read as a
 * Latin one at all ("яндекс" keeps its я), and such a skeleton is never compared with a brand.
 */
function skeleton(name) {
  let disguised = 0;
  let text = '';
  for (const ch of String(name).normalize('NFC')) {
    const bare = ch.normalize('NFD').replace(/\p{M}/gu, '');
    const to = CONFUSABLES[bare] || bare;
    if (to !== ch) disguised++;
    text += to;
  }
  return { text, disguised };
}

// The writing systems a name's letters come from. A letter of none of these counts as 'Other'.
const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Bopomofo', 'Arabic',
  'Hebrew', 'Thai', 'Devanagari', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Gujarati', 'Gurmukhi',
  'Sinhala', 'Georgian', 'Ethiopic', 'Khmer', 'Lao', 'Myanmar', 'Tibetan', 'Cherokee', 'Thaana', 'Mongolian']
  .map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'u')]);
// The writing systems with letters drawn like Latin ones (CONFUSABLES). Two of them in one name is how a disguise
// mixes letters; Latin beside Thai, Devanagari, Han or Hangul has no letter that can pass for another, so it is a
// name, not a disguise.
const LOOKALIKE_SCRIPTS = new Set(['Latin', 'Cyrillic', 'Greek', 'Armenian']);

/** The writing systems of a decoded label, and whether they are mixed the way a disguise mixes them. */
function scriptsOf(name) {
  const found = new Set();
  for (const ch of String(name)) {
    if (!/\p{L}/u.test(ch) || /[\p{Script=Common}\p{Script=Inherited}]/u.test(ch)) continue;
    found.add((SCRIPTS.find(([, rx]) => rx.test(ch)) || ['Other'])[0]);
  }
  const list = [...found];
  return { list, mixed: list.filter((s) => LOOKALIKE_SCRIPTS.has(s)).length > 1 };
}

/**
 * The brand an international label is drawn to look like ("pаypal" with a Cyrillic а is paypal), or null. Exact
 * only: the whole name reads as the brand, or as the brand and a real word, hyphened or glued on; the brand has five
 * letters or more; at least one letter was changed to get there. No near spellings: an honest name in its own
 * alphabet is never called a misspelling.
 */
function idnLookalike(label) {
  if (!/^xn--/i.test(label)) return null;
  const name = decodeLabel(label);
  if (!name) return null;
  const { text, disguised } = skeleton(name);
  if (!disguised || !/^[a-z-]+$/.test(text)) return null;
  for (const brand of L.PROTECTED_BRANDS) {
    const t = brand.token;
    if (t.length < 5) continue;
    // Joined by a hyphen, or glued on ("paypalsecure"): the same brand-and-word rule brandInfo applies to plain names.
    const rest = text.startsWith(t) ? text.slice(t.length) : text.endsWith(t) ? text.slice(0, -t.length) : null;
    const word = rest && (rest.startsWith('-') ? rest.slice(1) : rest.endsWith('-') ? rest.slice(0, -1) : rest.length >= 4 ? rest : '');
    if (text === t || (word && isRealWords(word))) return { brand, name, scripts: scriptsOf(name).list };
  }
  return null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 3) return Math.abs(a.length - b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** One pair of neighbouring letters swapped ("medicrae" for "medicare"). */
function swapped(a, b) {
  if (a.length !== b.length || a === b) return false;
  const i = [...a].findIndex((ch, k) => ch !== b[k]);
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

/** Shannon entropy per character - random-looking names score high. */
function entropy(s) {
  if (!s) return 0;
  const counts = {};
  for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
  let e = 0;
  for (const n of Object.values(counts)) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

/* ------------------------------------------------------- keyword matching */

const FILLER = new Set([
  'now', 'online', 'center', 'centre', 'help', 'my', 'the', 'your', 'official',
  'service', 'services', 'team', 'portal', 'page', 'site', 'web', 'app', 'id',
  'us', 'uk', 'eu', 'gb', 'net', 'info', 'mail', 'inc', 'ltd', 'co', 'here',
  'get', 'go', 'new', 'live', 'real', 'fast', 'safe', 'best', 'top', 'www', 'pay', 'fee',
  'bank', 'member', 'members', 'check', 'user', 'users', 'client', 'customer', 'customers', 'access',
  'notice', 'alert', 'process', 'service', 'document', 'documents', 'file', 'files', 'payment', 'payments',
  'reset', 'status', 'center', 'grand', 'day', 'prize', 'shop', 'store', 'mobile', 'secured', 'profile'
]);

// Compound tokens: "comcastmemberupdate" = comcast + member + update, even with
// unknown glue. Words must be long enough not to hide inside ordinary words.
const COMPOUND_MIN = 5;

let dictionaryCache = null;
function dictionary() {
  if (dictionaryCache) return dictionaryCache;
  const words = new Set(Object.keys(L.HOST_KEYWORDS));
  for (const b of L.PROTECTED_BRANDS) words.add(b.token);
  for (const f of FILLER) words.add(f);
  for (const w of [...L.TECH_SUPPORT_WORDS, ...L.DELIVERY_WORDS, ...L.GOV_WORDS]) words.add(w);
  dictionaryCache = words;
  return words;
}

/** Split `token` end to end into dictionary words, or return null. */
function segments(token, words = dictionary(), depth = 0) {
  if (!token) return [];
  if (depth > 6) return null;
  for (let len = Math.min(token.length, 14); len >= 2; len--) {
    const head = token.slice(0, len);
    if (!words.has(head)) continue;
    if (len === token.length) return [head];
    const rest = segments(token.slice(len), words, depth + 1);
    if (rest) return [head, ...rest];
  }
  return null;
}

/**
 * Words present in a hostname as whole words: a separator-delimited token, or
 * part of a token that splits cleanly into known words ("verifyaccount").
 * Never an accidental substring ("freelance" is not "free").
 */
function hostWords(host) {
  const found = new Set();
  for (const token of String(host).toLowerCase().split(/[^a-z]+/)) {
    if (token.length < 2) continue;
    const parts = segments(token);
    if (parts) { parts.forEach((p) => found.add(p)); continue; }
    found.add(token);
    for (const w of compoundWords(token)) found.add(w);
  }
  return found;
}

/**
 * Recognised words buried in a longer token with unknown glue between them.
 * Needs at least two long words covering most of the token, so "purchase"
 * never yields "chase" and "pineapple" never yields "apple".
 */
function compoundWords(token) {
  if (token.length < 10) return [];
  const words = dictionary();
  const hits = [];
  let covered = 0;
  for (let i = 0; i < token.length;) {
    let matched = null;
    for (let len = Math.min(16, token.length - i); len >= COMPOUND_MIN; len--) {
      const w = token.slice(i, i + len);
      if (words.has(w)) { matched = w; break; }
    }
    if (matched) { hits.push(matched); covered += matched.length; i += matched.length; } else { i++; }
  }
  return hits.length >= 2 && covered / token.length >= 0.6 ? hits : [];
}

/** Distinctive tokens of a domain name, used for known-scam comparison. */
function nameTokens(registrable) {
  const sld = String(registrable).split('.')[0].toLowerCase();
  const out = new Set();
  for (const raw of sld.split(/[^a-z0-9]+/)) {
    const token = deskin(raw);
    if (token.length < 3) continue;
    const parts = segments(token);
    if (parts && parts.length > 1) parts.filter((p) => p.length >= 3).forEach((p) => out.add(p));
    else out.add(token);
  }
  return [...out];
}

/* ------------------------------------------------------------ brands */

/**
 * Hosts where the page at a URL was put there by a user of the platform, not
 * by the platform: storage buckets, site builders, tunnels, "sites.google.com".
 * The platform's good name says nothing about such a page.
 */
function isUserContent(host) {
  return L.PATH_HOSTING.includes(host) || L.OBJECT_STORAGE.test(host)
    || L.FREE_HOSTING.some((d) => host !== d && host.endsWith('.' + d));
}

/**
 * Where, if anywhere, a protected brand appears in this URL.
 *   owner     the brand that owns the registrable domain (so the name is not borrowed)
 *   official  the same, unless the page is user content on that brand's platform
 */
function brandInfo(p, popular = popularSites()) {
  if (p.isIp) return { official: null, owner: null, inDomain: null, inSubdomain: null, lookalike: null };
  const sldFlat = deskin(p.sld);
  let owner = null;
  let inDomain = null;
  let inSubdomain = null;
  let lookalike = null;
  let visual = false;    // the look-alike reads as the brand to the eye: a digit or i for l, or a doubled letter
  let wordLike = null;   // spelled near a brand, but ordinary words (see isRealWords)

  for (const brand of L.PROTECTED_BRANDS) {
    // A customer page on a hosting platform ("x.myshopify.com") is never the platform itself.
    const owns = (d) => (p.hosting ? p.host === d : p.registrable === d || p.host === d || p.host.endsWith('.' + d));
    if (brand.domains.some(owns)) {
      owner = brand;
      break;
    }
  }
  if (owner) return { official: isUserContent(p.host) ? null : owner, owner, inDomain, inSubdomain, lookalike };

  // Letters from another alphabet drawn like the brand's own ("pаypal" with a Cyrillic а), in the name or in front.
  const idn = [p.sld, ...p.subdomains].map(idnLookalike).find(Boolean) || null;
  if (idn) { lookalike = idn.brand; visual = true; }

  // Words from the name as written ("shopee0146" -> shopee) and with look-alike
  // characters undone ("paypa1-login" -> paypal, login).
  const labelWords = (label) => {
    const set = hostWords(label);
    for (const w of hostWords(label.split(/[-_]/).map(deskin).join('-'))) set.add(w);
    return set;
  };
  const words = labelWords(p.sld);
  const subWords = p.subdomains.map((s) => ({ words: labelWords(s), flat: deskin(s) }));
  const hyphenParts = p.sld.split(/[-_]/).map(deskin).filter((s) => s.length >= 4);

  // On a free hosting platform the name in front ("xfinitymaillog.weebly.com") is chosen by whoever made the page,
  // and run-on names are the norm there: a brand of six letters or more inside it counts, not only eight or more.
  const substringMin = p.hosting ? 6 : 8;
  // One of the most linked-to sites on the web (see isWellKnown) has a name of its own: elle.com is not Zelle,
  // lacoste.com is not La Poste. Only a spelling near a brand is relieved, never a disguise (see lookAlikeLetters).
  const listed = popular.has(p.registrable) && isWellKnown(p, popular);
  // The whole name is one word of its own, in English or another language ("telegrams", Italian "telegramma"): a
  // brand inside it is that word's spelling, not a borrowed name. Not on a risky ending (U24's list) unless the site is
  // a popular one: there a word that holds a brand is still read as the brand (telegramm.top).
  const wordsCount = !L.RISKY_TLDS[p.suffix] || popular.has(p.registrable);
  const oneWord = wordsCount && (ordinaryWords().has(sldFlat) || L.FOREIGN_WORDS.has(sldFlat));
  for (const brand of L.PROTECTED_BRANDS) {
    const t = brand.token;
    // Short or common-word brands ("chase", "apple", "ups") only count as whole
    // words; long distinctive ones ("coinbase", "microsoft") also as substrings.
    const inside = (flat, set) => set.has(t) || (t.length >= substringMin && flat.includes(t));
    if (!inDomain && (sldFlat === t || !oneWord) && inside(sldFlat, words)) inDomain = brand;
    // The brand at the start or end, joined to a real word the small built-in list does not know ("paypalresolution",
    // "applebees"): found here, and judged by the word it is joined to (see U22).
    const rest = sldFlat.startsWith(t) ? sldFlat.slice(t.length) : sldFlat.endsWith(t) ? sldFlat.slice(0, -t.length) : '';
    if (!inDomain && t.length >= 4 && rest.length >= 4 && isRealWords(rest)) inDomain = brand;
    if (!inSubdomain && subWords.some((s) => inside(s.flat, s.words))) inSubdomain = brand;
    // A hyphen put inside the brand's name ("tik-tokbusiness", "pay-pal-help"): the name only appears once the
    // hyphens are gone. Nobody splits a brand in two by accident.
    // Six letters or more: a shorter brand is made by ordinary words meeting at a hyphen ("my-app-lessons" is not Apple).
    const split = (label) => t.length >= 6 && /[-_]/.test(label) && !label.split(/[-_]/).some((part) => deskin(part).includes(t)) && deskin(label.replace(/[-_]/g, '')).includes(t);
    if (!inDomain && split(p.sld)) inDomain = brand;
    // The name of one of the brand's own sites as a part of this one ("ezpassnj-toll" borrows ezpassnj.com). A site
    // that is a part of another of the brand's sites is not a name: "update.microsoft.com" made every "-update" Microsoft.
    const ownName = (d) => !brand.domains.some((o) => d.endsWith(`.${o}`)) && deskin(d.split('.')[0]);
    if (!inDomain && hyphenParts.length > 1 && brand.domains.some((d) => { const n = ownName(d); return n && n.length >= 6 && hyphenParts.includes(n); })) inDomain = brand;
    if (!inSubdomain && p.subdomains.some(split)) inSubdomain = brand;

    // Characters swapped for look-alikes ("paypa1", "g00gle", "micr0soft"): the name as written is not the brand, but
    // reads as it. That is a misspelling of the brand, and it was reported as "not a misspelling" because the
    // comparison below only ever saw the name with the swaps undone.
    // So are "rn" for "m" and "vv" for "w" ("rnedicare"), one letter longer than the brand.
    if (!lookalike && t.length >= 4 && [p.sld, ...p.sld.split(/[-_]/)].some((raw) => raw !== t && deskin(raw) === t && ((raw.length === t.length && /\d/.test(raw)) || /rn|vv/.test(raw.toLowerCase())))) { lookalike = brand; visual = true; }

    if (!lookalike && t.length >= 5) {
      // Two edits only on nine letters or more: on eight, two letters changed is a quarter of the word and makes
      // other names ("medscape" is not "medicare"). Two letters swapped side by side ("medicrae") is one slip.
      const maxDist = t.length >= 9 ? 2 : 1;
      const tSquashed = squash(t);
      const rawOf = new Map([[sldFlat, p.sld], ...p.sld.split(/[-_]/).map((r) => [deskin(r), r])]);
      for (const part of [sldFlat, ...hyphenParts]) {
        if (part === t || L.NOT_LOOKALIKES.has(part)) continue;
        const whole = levenshtein(part, t);
        // Doubled letters ("trezoorr", "logiin"): the same word to the eye, however many edits apart.
        // Six letters or more: shorter brands collide with real words ("chasse" is French, not "chase").
        const doubled = t.length >= 6 && squash(part) === tSquashed;
        // A misspelled brand glued to another word: "coinbseextension", "ladgerstart", and with a letter left out
        // or added before the rest ("m3tamsklgn" = metamsk + lgn), so the front is compared one letter shorter
        // and longer as well.
        let prefix = 99;
        if (t.length >= 7 && part.length > t.length) {
          for (const n of [t.length - 1, t.length, t.length + 1]) {
            if (L.NOT_LOOKALIKES.has(part.slice(0, n))) continue;   // "mobileshop" starts with a word, not with T-Mobile
            prefix = Math.min(prefix, levenshtein(part.slice(0, n), t));
          }
        }
        if ((whole > 0 && whole <= maxDist) || swapped(part, t) || doubled || (prefix > 0 && prefix <= 1)) {
          // Spelled close to the brand, but written in ordinary words, with no digit for a letter and no doubled
          // letter: another word ("overdrive", not "onedrive"), which a person reads as a different name. Noted,
          // not treated as a disguise.
          const raw = rawOf.get(part) || part;
          const foreign = wordsCount && L.FOREIGN_WORDS.has(raw.toLowerCase());
          const real = isRealWords(raw) || foreign;
          // A word in another language that is spelled with the doubled letter ("telegramm", German): read by hand, so
          // its doubled letter is its own.
          if ((!doubled && real) || foreign) { if (!wordLike) wordLike = { brand, word: raw }; continue; }
          // "paypai", "robloxx": the same word at a glance. Not "goggles", a real word whose doubled letter is its own.
          const il = (s) => s.replace(/i/g, 'l');
          const eyeTwin = doubled || (part.length === t.length && il(part) === il(t));
          if (listed && !eyeTwin && !lookAlikeLetters(raw)) { if (!wordLike) wordLike = { brand, word: raw, why: 'popular' }; continue; }
          lookalike = brand;
          visual = !real && eyeTwin;
          break;
        }
      }
    }
  }
  const popularLookalike = lookalike || wordLike || inDomain || inSubdomain ? null : popularCopy(p, sldFlat, popular);
  return { official: null, owner: null, inDomain, inSubdomain, lookalike, visual, idn, wordLike: lookalike ? null : wordLike, popularLookalike };
}

/** A digit, "rn", "vv" or a sign standing in for a letter ("g00gle", "rnicrosoft"): a disguise, never a name of its own. */
function lookAlikeLetters(raw) {
  return deskin(raw) !== String(raw).toLowerCase().replace(/[^a-z]/g, '');
}

// The popular sites' names of eight letters or more (name -> site), and by length, made once per list.
let popularIndex = { from: null };
function popularNames(popular) {
  if (popularIndex.from === popular) return popularIndex;
  const sites = new Map();
  const byLength = new Map();
  for (const site of popular) {
    const name = site.split('.')[0];
    if (!/^[a-z]{8,}$/.test(name) || sites.has(name)) continue;
    sites.set(name, site);
    if (!byLength.has(name.length)) byLength.set(name.length, []);
    byLength.get(name.length).push(name);
  }
  popularIndex = { from: popular, sites, byLength };
  return popularIndex;
}

/**
 * A copy of a popular site that is not a protected brand: one letter changed, added, left out, two side by side
 * swapped, or a digit for a letter ("wikipedla" for wikipedia.org). Returns the popular site, or null. Never a popular
 * site itself, never ordinary words, and never the same name on another ending (wikipedia.de).
 */
function popularCopy(p, sldFlat, popular) {
  // The name as written, letters only ("techcrunch" keeps its "rn"), and as read (sldFlat: digits undone).
  const plain = p.sld.toLowerCase().replace(/[^a-z]/g, '');
  if (!popular.size || popular.has(p.registrable) || Math.max(plain.length, sldFlat.length) < 7 || L.NOT_LOOKALIKES.has(sldFlat) || isRealWords(p.sld)) return null;
  const { sites, byLength } = popularNames(popular);
  // The popular name itself on another ending is the same site's country address (wikipedia.de).
  if (sites.has(plain)) return null;
  if (sites.has(sldFlat)) return sites.get(sldFlat);   // a digit for a letter
  for (const form of new Set([plain, sldFlat])) {
    for (const n of [form.length - 1, form.length, form.length + 1]) {
      // The name with an "s" on the end, or without its own ("wikipedias"): how people write the plural, not a copy.
      for (const name of byLength.get(n) || []) if ((oneEdit(form, name) && form !== `${name}s` && name !== `${form}s`) || swapped(form, name)) return sites.get(name);
    }
  }
  return null;
}

/** One letter changed, added or left out, in one pass (the copy check runs against thousands of names). */
function oneEdit(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * An address a person typed or pasted. Like a browser's address bar, a bare
 * domain means HTTPS - otherwise "example.com" would be marked unencrypted.
 */
function typedUrl(raw) {
  // A doubled scheme ("https://https://...") is a paste slip, not a host called "https".
  const input = String(raw == null ? '' : raw).trim().replace(/^(https?:\/\/)(?:https?:\/\/)+/i, '$1');
  // "example.com:8443/login" is a host and a port, not a scheme called "example.com".
  if (/^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i.test(input)) return `https://${input}`;
  return /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input.replace(/^\/\//, '')}`;
}

/**
 * A site whose own name is well known: a brand Sentinel protects, a site on its verified list, or one of the most
 * linked-to sites on the web (`popular`, popularSites() from wellknown.txt). Its address is not the
 * danger, so the shape of a link on it says nothing: links on cdn.discordapp.com, googleusercontent.com or
 * amazonaws.com are long, signed and random by design. What is served there still can be dangerous: the threat
 * lists, the download checks and the impersonation checks still apply to it.
 * Never a name someone else chose on a shared platform: a customer's subdomain, a storage bucket, a dynamic-DNS name.
 * Never a link shortener: there the address is not the site, the hidden destination is.
 */
function isWellKnown(p, popular = null) {
  if (!p || p.isIp || p.hosting || L.OBJECT_STORAGE.test(p.host) || L.DYNAMIC_DNS.some((d) => p.host === d || p.host.endsWith('.' + d))) return false;
  if (L.URL_SHORTENERS.has(p.registrable) || L.URL_SHORTENERS.has(p.host)) return false;
  if (popular && popular.has(p.registrable)) return true;
  if (L.DEFAULT_ALLOWLIST.some((d) => p.registrable === d || p.host === d || p.host.endsWith('.' + d))) return true;
  return L.PROTECTED_BRANDS.some((b) => b.domains.some((d) => p.registrable === d || p.host === d || p.host.endsWith('.' + d)));
}

/*
 * Link wrappers that carry the real address in a parameter: [host, path (any when null), parameters]. Google's /url,
 * Facebook's and Instagram's link pages, Outlook's safe links, DuckDuckGo, YouTube, Slack and the ad-click trackers.
 */
const WRAPPERS = [
  [/(^|\.)google\.[a-z.]+$/, /^\/url$/, ['q', 'url']],
  [/(^|\.)facebook\.com$/, /^\/l\.php$/, ['u']],
  [/^l\.instagram\.com$/, null, ['u']],
  [/(^|\.)safelinks\.protection\.outlook\.com$/, null, ['url']],
  [/(^|\.)duckduckgo\.com$/, /^\/l\//, ['uddg']],
  [/(^|\.)youtube\.com$/, /^\/redirect$/, ['q']],
  [/^slack-redir\.net$/, /^\/link$/, ['url']],
  [/(^|\.)(clickserve\.dartsearch\.net|ad\.doubleclick\.net|googleadservices\.com|click\.linksynergy\.com|go\.redirectingat\.com)$/, null, ['adurl', 'url', 'murl', 'u', 'dest', 'destination']]
];
/** Where a link really goes, through up to three wrappers. */
function unwrapLink(href) {
  let url = String(href || '');
  for (let i = 0; i < 3; i++) {
    let u;
    try { u = new URL(url); } catch { return url; }
    const w = WRAPPERS.find(([host, path]) => host.test(u.hostname) && (!path || path.test(u.pathname)));
    const inner = w && w[2].map((k) => u.searchParams.get(k)).find((v) => v && /^https?:\/\//i.test(v));
    if (!inner) return url;
    url = inner;
  }
  return url;
}

// A file name is not an address: "readme.md", "index.js" and "setup.py" end like country domains.
const FILE_ENDING = /^(pdf|docx?|xlsx?|pptx?|txt|csv|md|js|mjs|cjs|ts|tsx|jsx|json|py|rb|rs|sh|php|html?|css|xml|ya?ml|ini|log|exe|msi|zip|rar|png|jpe?g|gif|svg|webp|mp[34]|mov)$/;

/**
 * A link whose words show one site and which opens another: { shown, real, brand }, or null. Words count only when
 * they are themselves an address ("https://www.paypal.com/...", "www.paypal.com", or "paypal.com" written in lower
 * case, so "ASP.NET" and "Node.js" stay names), name a protected brand that the address imitates (brandInfo), or
 * hold a protected brand's own address anywhere in them ("Visit PayPal.com"), over a site that is not well known.
 * Silent whenever it cannot tell or both sides are one owner: the same site or a subdomain, one brand's own sites
 * (microsoft.com words over live.com), a shortener or an email service's click counter (the real address is not in
 * the link), a web archive, or a well-known site's page about the shown one ("from?site=github.com").
 * The words can only ever add a warning: they never make a link look safer. `wellKnown`: the link's site is well
 * known (knowledge.js), when the caller knows it; otherwise isWellKnown's own lists decide.
 */
function shownVersusReal(text, href, wellKnown = null) {
  const words = String(text || '').trim().slice(0, 120);
  const real = analyze(unwrapLink(href));
  if (!words || !real || real.isIp) return null;
  const opaque = (list) => list.some((d) => real.host === d || real.host.endsWith(`.${d}`) || real.registrable === d);
  if (L.URL_SHORTENERS.has(real.registrable) || L.URL_SHORTENERS.has(real.host) || opaque(L.CLICK_TRACKERS) || opaque(L.ARCHIVES)) return null;

  const bare = words.replace(/^[<("'[\s]+|[>)"'\].,;:!?\s]+$/g, '');
  const written = /^(https?:\/\/)?((www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d+)?([/?#]\S*)?$/i.exec(bare);
  const tld = written && written[2].split('.').pop();
  const plain = written && !written[1] && !written[3];
  const shown = written && /^[a-z]{2,24}$/i.test(tld) && !(plain && (written[2] !== written[2].toLowerCase() || (!written[6] && FILE_ENDING.test(tld)))) && analyze(written[0]);
  const known = wellKnown === null ? isWellKnown(real) : wellKnown;
  if (shown) {
    if (shown.registrable === real.registrable) return null;
    const owns = (b, q) => Boolean(b && b.domains.some((d) => q.registrable === d || q.host === d || q.host.endsWith(`.${d}`)));
    if (owns(brandInfo(shown).owner, real) || owns(brandInfo(real).owner, shown)) return null;
    // A well-known site under the same name on another ending (statista.de words over de.statista.com), or its page
    // about the shown site.
    if (known && (shown.sld === real.sld || decodeSafe(real.path + real.query).toLowerCase().split(/[/?&=#]/).includes(shown.registrable))) return null;
    return { shown: shown.host.replace(/^www\./, ''), real: real.host, brand: null };
  }

  // Words that are a brand's name and little else ("PayPal", "Log in to PayPal", "Bank of America"), over an address
  // made to look like that brand's and not well known. A headline or a citation that mentions the brand ("PayPal to
  // acquire Curv", over the company's own newsroom) says nothing about the address.
  if (known) return null;
  const info = brandInfo(real);
  if (info.owner) return null;
  const resembled = [info.lookalike, info.inDomain, info.inSubdomain, info.wordLike && info.wordLike.brand].filter(Boolean);
  const single = words.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const b of resembled) {
    for (let i = 0; i < single.length; i++) {
      for (let n = 1; n <= 3 && i + n <= single.length; n++) {
        if (single.slice(i, i + n).join('') !== b.token) continue;
        const rest = [...single.slice(0, i), ...single.slice(i + n)];
        if (rest.every((w) => CLAIM_WORDS.has(w))) return { shown: b.domains[0], real: real.host, brand: b };
      }
    }
  }
  // A protected brand's own address inside a sentence, in any case ("Log in to PayPal.com to confirm"), over a site
  // that is not well known and not the brand's: the commonest words of a phishing link.
  for (const tok of words.match(/(?:[a-z0-9-]+\.)+[a-z]{2,24}/gi) || []) {
    const q = analyze(tok);
    if (q && L.PROTECTED_BRANDS.some((b) => b.domains.includes(q.registrable))) return { shown: q.host.replace(/^www\./, ''), real: real.host, brand: null };
  }
  return null;
}
// What may stand beside a brand's name in a link that claims to be it: "Log in to PayPal", "PayPal account".
const CLAIM_WORDS = new Set(['log', 'in', 'login', 'logon', 'sign', 'signin', 'on', 'to', 'your', 'my', 'the', 'account', 'accounts',
  'official', 'site', 'website', 'page', 'secure', 'security', 'verify', 'here', 'go', 'visit', 'open', 'home', 'support', 'help',
  'center', 'centre', 'customer', 'service', 'online', 'now', 'continue', 'with', 'www', 'com']);

module.exports = {
  analyze, typedUrl, urlKey, deskin, levenshtein, entropy, hostWords, nameTokens, brandInfo, isUserContent, isRealWords, isWellKnown,
  decodeLabel, shownHost, skeleton, scriptsOf, popularSites, unwrapLink, shownVersusReal
};
