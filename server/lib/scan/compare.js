'use strict';
/**
 * Stage 3 - compare against known scams.
 *
 *  - Domain: does this name share a skeleton or distinctive tokens with domains
 *    already confirmed as scams?
 *  - Content (research only): does the page read like a known scam kit, or like
 *    a page Sentinel has already confirmed?
 */
const crypto = require('crypto');
const { db, now } = require('../db');
const L = require('./lists');
const { analyze, deskin, nameTokens, levenshtein } = require('./url');

// Tokens that appear in so many scam domains they say nothing specific.
const MAX_TOKEN_DF = 4000;

// Every name is compared with at least this many known scam domains.
const MIN_COMPARED = 10;

// A skeleton that is itself a common word (verify, secure, password...) matches
// every honest site named after that word. Such matches are marked generic so
// the rules can discount them.
const GENERIC_WORDS = new Set(['password', 'verify', 'secure', 'security', 'bank', 'banking', 'support', 'wallet', 'update', 'invoice', 'delivery', 'login', 'account', 'service', 'online', 'official', 'payment', 'billing', 'portal', 'access', 'alert', 'alerts', 'notice', 'recovery', 'refund', 'reward', 'rewards', 'claim', 'claims', 'parcel', 'outlet', 'clearance', 'airdrop', 'giveaway', 'prize', 'prizes']);
const isGeneric = (skeleton) => skeleton.length < 6 || GENERIC_WORDS.has(skeleton) || L.HOST_KEYWORDS[skeleton] !== undefined;

const q = {
  skeleton: db.prepare('SELECT host, threat, category FROM feed_hosts WHERE skeleton = ? AND host != ? LIMIT 10'),
  // Known hosts whose skeleton starts the same way, for the nearest-name pass.
  skeletonNear: db.prepare("SELECT host, skeleton FROM feed_hosts WHERE skeleton >= ? AND skeleton < ? AND threat = 'scam' LIMIT 60"),
  df: db.prepare('SELECT df FROM token_df WHERE token = ?'),
  tokenHosts: db.prepare('SELECT host FROM scam_tokens WHERE token = ? LIMIT 400'),
  blockHosts: db.prepare('SELECT host, threat, category FROM blocklist'),
  fingerprints: db.prepare('SELECT simhash, host, threat, label FROM scam_fingerprints ORDER BY added_at DESC LIMIT 5000'),
  addFingerprint: db.prepare(`INSERT OR IGNORE INTO scam_fingerprints (simhash, host, threat, label, added_at) VALUES (?, ?, ?, ?, ?)`)
};

/* ---------------------------------------------------------------- domain */

// Pre-computed skeletons of our confirmed list, rebuilt when the list changes
// (checked at most every 30 seconds) instead of on every scan.
const stampStmt = db.prepare('SELECT COUNT(*) AS n, MAX(added_at) AS t FROM blocklist');
let skeletonCache = { key: null, checkedAt: 0, rows: [] };
function blockSkeletons() {
  if (Date.now() - skeletonCache.checkedAt < 30_000) return skeletonCache.rows;
  const s = stampStmt.get();
  const key = `${s.n}|${s.t}`;
  if (key !== skeletonCache.key) {
    skeletonCache.rows = q.blockHosts.all()
      .map((row) => ({ ...row, skeleton: deskin(row.host.split('.')[0]) }))
      .filter((row) => row.skeleton.length >= 6);
    skeletonCache.key = key;
  }
  skeletonCache.checkedAt = Date.now();
  return skeletonCache.rows;
}

function compareDomain(p) {
  if (p.isIp) return { skeletonMatches: [], tokenMatches: [], nearest: null, compared: 0, closest: [] };
  const sld = p.sld;
  const skeleton = deskin(sld);
  const out = { skeletonMatches: [], tokenMatches: [], nearest: null, compared: 0, closest: [] };
  // Every known host this name was measured against, with its edit distance.
  const candidates = new Map();
  const consider = (host, hostSkeleton) => {
    if (!host || host === p.registrable || host === p.host || candidates.has(host)) return;
    const sk = hostSkeleton || deskin(host.split('.')[0]);
    candidates.set(host, levenshtein(sk, skeleton));
  };

  if (skeleton.length >= 6) {
    // A stored name is only as good as the hosting list was on the day it was stored:
    // a tenant of a service we had not yet recognised was filed under the service's own
    // name ("myportfolio"), which then matched every innocent "my-portfolio". Check it
    // against how the host reads today.
    // And a listed host on the very same domain is not a look-alike of it: web.archive.org is not an
    // imitation of ia601403.us.archive.org, it is the same site.
    const current = (row) => { const known = analyze(`http://${row.host}/`); return Boolean(known) && deskin(known.sld) === skeleton && known.registrable !== p.registrable; };
    out.skeletonMatches = q.skeleton.all(skeleton, p.registrable).filter(current).map((row) => ({ ...row, generic: isGeneric(skeleton) }));
    // Our own confirmed list is small enough to compare with edit distance.
    for (const row of blockSkeletons()) {
      if (row.host === p.registrable || row.host === p.host) continue;
      consider(row.host, row.skeleton);
      const other = analyze(`http://${row.host}/`);
      if (other && other.registrable === p.registrable) continue;
      if (Math.abs(row.skeleton.length - skeleton.length) <= 2 && levenshtein(row.skeleton, skeleton) <= 2) {
        out.skeletonMatches.push({ ...row, generic: isGeneric(row.skeleton) });
      }
    }
    for (const row of out.skeletonMatches) consider(row.host, row.skeleton);
  }

  // Token overlap weighted by rarity: sharing "paypal" + "refund" with known
  // scams means more than sharing "online".
  const tokens = nameTokens(p.registrable);
  if (tokens.length >= 2) {
    const scores = new Map();
    const informative = [];
    for (const token of tokens) {
      const row = q.df.get(token);
      if (!row || row.df > MAX_TOKEN_DF) continue;
      informative.push(token);
      const weight = 1 / Math.log2(2 + row.df);
      for (const { host } of q.tokenHosts.all(token)) {
        if (host === p.registrable) continue;
        const entry = scores.get(host) || { host, shared: [], weight: 0 };
        entry.shared.push(token);
        entry.weight += weight;
        scores.set(host, entry);
      }
    }
    for (const host of scores.keys()) consider(host);
    out.tokenMatches = [...scores.values()]
      .filter((e) => e.shared.length >= 2 && e.shared.length >= Math.ceil(informative.length * 0.66))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);
  }

  // Names with nothing distinctive in them still get measured against known
  // scam domains that start the same way, so no comparison is ever skipped.
  if (candidates.size < MIN_COMPARED && skeleton.length >= 3) {
    const prefix = skeleton.slice(0, 3);
    for (const row of q.skeletonNear.all(prefix, prefix + '\uffff')) consider(row.host, row.skeleton);
  }
  if (candidates.size < MIN_COMPARED) {
    for (const row of blockSkeletons()) { if (candidates.size >= MIN_COMPARED) break; consider(row.host, row.skeleton); }
  }

  out.compared = candidates.size;
  out.closest = [...candidates.entries()].sort((a, b) => a[1] - b[1]).slice(0, 10).map(([host, distance]) => ({ host, distance }));
  out.nearest = out.skeletonMatches[0] ? out.skeletonMatches[0].host : (out.tokenMatches[0] ? out.tokenMatches[0].host : (out.closest[0] ? out.closest[0].host : null));
  return out;
}

/* --------------------------------------------------------------- content */

function simhash(text) {
  const words = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  if (words.length < 12) return null;
  const vector = new Array(64).fill(0);
  for (let i = 0; i < words.length - 2; i++) {
    const hash = crypto.createHash('sha1').update(`${words[i]} ${words[i + 1]} ${words[i + 2]}`).digest();
    for (let bit = 0; bit < 64; bit++) {
      vector[bit] += (hash[bit >> 3] >> (bit % 8)) & 1 ? 1 : -1;
    }
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit++) if (vector[bit] > 0) out |= 1n << BigInt(bit);
  return out.toString(16).padStart(16, '0');
}

function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/**
 * @param {string} text visible page text, lower-cased
 * @param {string} html raw html, lower-cased (kits hide field names there)
 */
function compareContent(text, html, host) {
  const haystack = `${text}\n${html}`;
  const kits = [];
  for (const kit of L.SCAM_KITS) {
    const hits = kit.phrases.filter((phrase) => haystack.includes(phrase));
    if (hits.length >= kit.min) {
      kits.push({ id: kit.id, label: kit.label, threat: kit.threat, hits, strength: hits.length >= kit.min + 1 ? 'strong' : 'partial' });
    }
  }

  const fingerprint = simhash(text);
  const similarPages = [];
  if (fingerprint) {
    for (const row of q.fingerprints.all()) {
      if (row.host === host) continue;
      const distance = hamming(fingerprint, row.simhash);
      if (distance <= 6) similarPages.push({ host: row.host, threat: row.threat, label: row.label, similarity: Math.round((1 - distance / 64) * 100) });
      if (similarPages.length >= 3) break;
    }
  }

  return { kits, similarPages, fingerprint };
}

/** Remember a confirmed scam page so future lookalike pages match it. */
function learn(fingerprint, host, threat, label) {
  if (fingerprint) q.addFingerprint.run(fingerprint, host, threat, label || null, now());
}

module.exports = { compareDomain, compareContent, learn };
