'use strict';
/** URL parsing and string-similarity helpers shared by every scan stage. */
const crypto = require('crypto');
const L = require('./lists');

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
function deskin(s) {
  let out = String(s).toLowerCase();
  for (const [rx, to] of HOMOGLYPHS) out = out.replace(rx, to);
  return out.replace(/[^a-z]/g, '');
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

/** Where, if anywhere, a protected brand appears in this URL. */
function brandInfo(p) {
  if (p.isIp) return { official: null, inDomain: null, inSubdomain: null, lookalike: null };
  const sldFlat = deskin(p.sld);
  let official = null;
  let inDomain = null;
  let inSubdomain = null;
  let lookalike = null;

  for (const brand of L.PROTECTED_BRANDS) {
    // A customer page on a hosting platform ("x.myshopify.com") is never the platform itself.
    const owns = (d) => (p.hosting ? p.host === d : p.registrable === d || p.host === d || p.host.endsWith('.' + d));
    if (brand.domains.some(owns)) {
      official = brand;
      break;
    }
  }
  if (official) return { official, inDomain, inSubdomain, lookalike };

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

  for (const brand of L.PROTECTED_BRANDS) {
    const t = brand.token;
    // Short or common-word brands ("chase", "apple", "ups") only count as whole
    // words; long distinctive ones ("coinbase", "microsoft") also as substrings.
    const inside = (flat, set) => set.has(t) || (t.length >= 8 && flat.includes(t));
    if (!inDomain && inside(sldFlat, words)) inDomain = brand;
    if (!inSubdomain && subWords.some((s) => inside(s.flat, s.words))) inSubdomain = brand;

    if (!lookalike && t.length >= 5) {
      const maxDist = t.length >= 8 ? 2 : 1;
      for (const part of [sldFlat, ...hyphenParts]) {
        if (part === t) continue;
        const whole = levenshtein(part, t);
        // A misspelled brand glued to another word: "coinbseextension", "ladgerstart".
        const prefix = t.length >= 7 && part.length > t.length ? levenshtein(part.slice(0, t.length), t) : 99;
        if ((whole > 0 && whole <= maxDist) || (prefix > 0 && prefix <= 1)) { lookalike = brand; break; }
      }
    }
  }
  return { official, inDomain, inSubdomain, lookalike };
}

/**
 * An address a person typed or pasted. Like a browser's address bar, a bare
 * domain means HTTPS - otherwise "example.com" would be marked unencrypted.
 */
function typedUrl(raw) {
  const input = String(raw == null ? '' : raw).trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input.replace(/^\/\//, '')}`;
}

module.exports = {
  analyze, typedUrl, urlKey, deskin, levenshtein, entropy, hostWords, nameTokens, brandInfo
};
