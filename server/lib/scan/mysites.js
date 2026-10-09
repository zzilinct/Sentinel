'use strict';
/**
 * Your sites: look-alikes of the sites a person really uses, not only of the big brands.
 *
 * The brand checks (url.js brandInfo) know PayPal and Chase, but not a small credit union, a school portal or a work
 * sign-in page. Here each person has a list of their own sites, kept on their own computer (the app's embedded
 * server), and an address made to look like one of them is called what it is.
 *
 *   learn      Live scanning, with this on, counts the days it saw each site judged clean (never in a private window).
 *              The count is kept as a keyed hash of the site, like exposure alerts' marks, so the database never holds
 *              a readable list of the places someone merely passed through. A site seen on LEARN_DAYS different days
 *              is one the person uses: only then is its name written down, as a plain host they can read and remove.
 *              Brand sites are left out; the brand checks already cover them.
 *   add        The person can add a site themselves, and remove any.
 *   match      nearCopy(): an address one step from one of the sites. The lessons of url.js hold here too: a name
 *              that reads as ordinary words is another name, not a misspelling ("overdrive" is not "onedrive").
 */
const crypto = require('crypto');
const { db, now } = require('../db');
const config = require('../../config');
const L = require('./lists');
const { analyze, deskin, levenshtein, isRealWords, hostWords, brandInfo, isUserContent } = require('./url');

const DAY_MS = 24 * 60 * 60 * 1000;
const LEARN_DAYS = 3;
const MAX_SITES = 200;

const KEY = crypto.createHmac('sha256', String(config.secret)).update('sentinel your sites v1').digest();
const hash = (name) => crypto.createHmac('sha256', KEY).update(String(name)).digest('base64url').slice(0, 22);
const bare = (host) => String(host).toLowerCase().replace(/^www\./, '');

const q = {
  seen: db.prepare('SELECT days, last_day FROM site_days WHERE user_id = ? AND site_hash = ?'),
  count: db.prepare(`INSERT INTO site_days (user_id, site_hash, days, last_day) VALUES (?, ?, 1, ?)
                     ON CONFLICT(user_id, site_hash) DO UPDATE SET days = days + 1, last_day = excluded.last_day`),
  graduate: db.prepare('DELETE FROM site_days WHERE user_id = ? AND site_hash = ?'),
  add: db.prepare('INSERT OR IGNORE INTO my_sites (user_id, host, source, added_at) VALUES (?, ?, ?, ?)'),
  remove: db.prepare('DELETE FROM my_sites WHERE user_id = ? AND host = ?'),
  list: db.prepare('SELECT host, source, added_at FROM my_sites WHERE user_id = ? ORDER BY source DESC, host LIMIT 200'),
  hosts: db.prepare('SELECT host FROM my_sites WHERE user_id = ?'),
  size: db.prepare('SELECT COUNT(*) AS n FROM my_sites WHERE user_id = ?'),
  forgetSites: db.prepare('DELETE FROM my_sites WHERE user_id = ?'),
  forgetDays: db.prepare('DELETE FROM site_days WHERE user_id = ?')
};

/** The site part of an address, the way it is kept: "online.mycu.org/login" -> "mycu.org". Null when it is no site. */
function siteOf(raw) {
  const p = analyze(String(raw || '').trim());
  if (!p || p.isIp || !p.host.includes('.') || p.labels.length < 2 || !p.sld) return null;
  return bare(p.registrable);
}

/**
 * A page live scanning found clean, for someone who has this on. Returns the site when it has just been learned.
 * `tz` as in exposure.js: the person's calendar day, not the server's.
 */
function seen(userId, url, at = now(), tz) {
  const p = analyze(String(url));
  if (!p || p.isIp || isUserContent(p.host)) return null;
  const site = siteOf(url);
  if (!site || brandInfo(p).owner) return null;
  const offset = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : new Date(at).getTimezoneOffset();
  const day = Math.floor((at - offset * 60 * 1000) / DAY_MS);
  const h = hash(site);
  const row = q.seen.get(userId, h);
  if (row && row.last_day === day) return null;
  if (row && row.days + 1 >= LEARN_DAYS) {
    q.graduate.run(userId, h);
    if (q.size.get(userId).n >= MAX_SITES) return null;
    return q.add.run(userId, site, 'learned', at).changes ? site : null;
  }
  q.count.run(userId, h, day);
  return null;
}

/** Added by the person. Returns the site as kept, or null when it is not a web address. */
function add(userId, raw, at = now()) {
  const site = siteOf(raw);
  if (!site) return null;
  if (q.size.get(userId).n >= MAX_SITES) return null;
  q.add.run(userId, site, 'you', at);
  return site;
}

function remove(userId, raw) { return q.remove.run(userId, siteOf(raw) || bare(raw)).changes > 0; }

function list(userId) { return q.list.all(userId).map((r) => ({ host: r.host, source: r.source, addedAt: r.added_at })); }

/** Everything: the sites, and the day counts of the ones not yet learned. Returns how many sites went. */
function forget(userId) {
  q.forgetDays.run(userId);
  return q.forgetSites.run(userId).changes;
}

/* ------------------------------------------------------------ matching */

const squash = (s) => String(s).replace(/(.)\1+/g, '$1');
const flat = (s) => s.split(/[-_]/).filter(Boolean).map(deskin).join('-');

/** Two neighbouring letters traded places ("hrabour" for "harbour"). */
function swapped(a, b) {
  if (a.length !== b.length || a === b) return false;
  const diff = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

/**
 * Words added to the name ("mycu-secure-login", "mycuonline"): bait words, or, set off with a dash, any word added to
 * a name that is not one ("mycu-alerts", but not "bluewater-cafe").
 */
function extraWords(cand, name) {
  const c = flat(cand);
  const n = flat(name);
  const cf = c.replace(/-/g, '');
  const nf = n.replace(/-/g, '');
  if (cf === nf || nf.length < 4) return false;
  const bait = (rest) => [...hostWords(rest)].some((w) => L.HOST_KEYWORDS[w]);
  const padded = `-${c}-`;
  if (padded.includes(`-${n}-`)) {
    const rest = padded.replace(`-${n}-`, '-').replace(/^-+|-+$/g, '');
    return Boolean(rest) && (bait(rest) || (!isRealWords(name) && isRealWords(rest)));
  }
  // Glued on, only with bait: "trainline" is not "train" with a word added, nor "googlearts" a copy of Google.
  if (!cf.startsWith(nf) && !cf.endsWith(nf)) return false;
  return !isRealWords(cand) && bait(cf.startsWith(nf) ? cf.slice(nf.length) : cf.slice(0, -nf.length));
}

/** How `p` (an analyzed address) imitates the site `s`, or null. */
function imitation(p, s) {
  const name = s.sld.toLowerCase();
  const cand = p.sld.toLowerCase();
  const nf = deskin(name);
  const cf = deskin(cand);
  if (nf.length < 4) return null;
  if (cand === name) return 'ending';
  if (extraWords(cand, name)) return 'extra';
  // A name that reads as ordinary words is its own name: "overdrive", not "onedrive" misspelled.
  if (isRealWords(cand) || L.NOT_LOOKALIKES.has(cf)) return null;
  if (cf === nf) return cand.replace(/[-_]/g, '') === name.replace(/[-_]/g, '') ? 'dash' : 'digit';
  if (nf.length < 5) return null;
  if (squash(cf) === squash(nf)) return 'double';
  if (swapped(cf, nf)) return 'swap';
  const d = levenshtein(cf, nf);
  return d > 0 && d <= (nf.length >= 8 ? 2 : 1) ? 'letter' : null;
}

/**
 * Is this address a near-copy of one of `sites`? Returns { site, how } or null. Any of the sites themselves, or a
 * page on one (a subdomain), is never a copy, and neither is a site a brand owns.
 */
function nearCopy(url, sites) {
  const p = typeof url === 'string' ? analyze(url) : url;
  if (!p || p.isIp || !sites || !sites.length) return null;
  const mine = new Set(sites.map(bare));
  if (mine.has(bare(p.registrable)) || mine.has(bare(p.host))) return null;
  for (const site of mine) {
    const s = parsed(site);
    if (!s) continue;
    const how = imitation(p, s);
    if (how) return brandInfo(p).owner ? null : { site, how };
  }
  return null;
}

// A site as compared, or null for one a brand owns: the brand checks already guard those, with every domain the
// brand really has, which a person's list cannot know ("googlearts.org" is not a copy of googleapis.com).
const parsedSites = new Map();
function parsed(site) {
  if (!parsedSites.has(site)) {
    const s = analyze(`http://${site}`);
    if (parsedSites.size > 5000) parsedSites.clear();
    parsedSites.set(site, s && !s.isIp && !brandInfo(s).owner ? s : null);
  }
  return parsedSites.get(site);
}

/** This person's sites, matched against an address. */
function lookalike(userId, url) {
  const sites = q.hosts.all(userId).map((r) => r.host);
  return sites.length ? nearCopy(url, sites) : null;
}

const HOW = {
  ending: 'it has a different ending',
  extra: 'it adds words to the name',
  digit: 'a number or look-alike letters stand in for a letter',
  dash: 'a dash is added to the name',
  double: 'a letter is doubled',
  swap: 'two letters are swapped',
  letter: 'it is spelled a little differently'
};

/** What the person reads. */
function warning({ site, how }) {
  return `This is not ${site}. You usually go to ${site}; this address looks like it, but ${HOW[how] || HOW.letter}.`;
}

module.exports = { seen, add, remove, list, forget, nearCopy, lookalike, warning, siteOf, LEARN_DAYS };
