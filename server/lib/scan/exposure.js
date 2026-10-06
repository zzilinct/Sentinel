'use strict';
/**
 * Exposure alerts: a site you visited that a threat list names later.
 *
 * Live scanning checks a page as you open it. A phishing page is often listed hours or days after it goes up, so a
 * page that was clean when you saw it can be a known scam by the end of the week. This works the way phone exposure
 * notifications do: a private record kept on this computer, matched here against a list that changes later.
 *
 *   remember   When the person has switched this on, every page live scanning finds clean (never one in a private
 *              window) leaves a mark: a keyed hash of its host and of its domain, and the day. Never the address,
 *              never a time of day. Marks are kept 14 days (the hourly sweep in db.js removes older ones), so the
 *              accounts file never holds a readable list of the sites someone visits.
 *   match      Each threat-list import reports the hosts it had never listed before. Each is hashed with the same
 *              key and looked up among the marks. A whole listed domain also matches a visit to any of its subdomains.
 *   tell       A match is an exposure: the listed host (it is public, on the list), its threat, and the day of the
 *              visit. The desktop app asks for new ones and says so, once a day at most.
 *
 * Where the analogy breaks: a site can be hacked after you left it. Only a listing that appears within the 14 days
 * the marks are kept can match, and only on that exact host or domain. Pages people put up on shared platforms
 * (sites.google.com, netlify.app and the like, see isUserContent) are never marked: one bad page there says nothing
 * about the page someone else visited on the same host.
 */
const crypto = require('crypto');
const { db, now } = require('../db');
const config = require('../../config');
const { analyze, isUserContent, brandInfo } = require('./url');

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_MARKS_MS = 14 * DAY_MS;
const KEEP_EXPOSURES_MS = 30 * DAY_MS;

// The key never leaves this server: derived from its own secret, so a copy of the database alone cannot be checked
// against a list of sites to see which were visited.
const KEY = crypto.createHmac('sha256', String(config.secret)).update('sentinel visit marks v1').digest();
const hash = (name) => crypto.createHmac('sha256', KEY).update(String(name)).digest('base64url').slice(0, 22);

const q = {
  any: db.prepare('SELECT 1 FROM visit_marks LIMIT 1'),
  mark: db.prepare(`INSERT INTO visit_marks (user_id, host_hash, reg_hash, day) VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id, host_hash) DO UPDATE SET day = excluded.day`),
  marks: db.prepare('SELECT user_id, host_hash, reg_hash, day FROM visit_marks WHERE day >= ?'),
  forget: db.prepare('DELETE FROM visit_marks WHERE user_id = ?'),
  expose: db.prepare(`INSERT OR IGNORE INTO exposures (user_id, host, threat, category, visited_day, listed_at)
                      VALUES (?, ?, ?, ?, ?, ?)`),
  list: db.prepare(`SELECT host, threat, category, visited_day, listed_at, notified_at FROM exposures
                    WHERE user_id = ? AND dismissed_at IS NULL AND listed_at > ? ORDER BY listed_at DESC LIMIT 50`),
  notified: db.prepare('UPDATE exposures SET notified_at = ? WHERE user_id = ? AND host = ? AND notified_at IS NULL'),
  dismiss: db.prepare('UPDATE exposures SET dismissed_at = ? WHERE user_id = ? AND host = ?')
};

const dayOf = (t) => Math.floor(t / DAY_MS) * DAY_MS;
/** Hosts on shared platforms, where one listed page says nothing about the next. */
const shared = (p) => Boolean(p.hosting) || isUserContent(p.host);
const bare = (host) => String(host).toLowerCase().replace(/^www\./, '');

/** A page live scanning found clean, for someone who switched exposure alerts on. Private windows never get here. */
function remember(userId, url, at = now()) {
  const p = analyze(String(url));
  if (!p || shared(p)) return false;
  q.mark.run(userId, hash(bare(p.host)), hash(bare(p.registrable)), dayOf(at));
  return true;
}

/** Switched off: every mark this account has goes at once. Exposures already found stay until dismissed. */
function forget(userId) { return q.forget.run(userId).changes; }

/** Whether anyone has a mark at all: an import with nobody to tell skips the hashing. */
function watching() { return Boolean(q.any.get()); }

/**
 * Newly listed hosts against the marks. `listed` is [{ host, registrable, threat, category }], hosts a list had not
 * named before this import. Returns how many exposures were new.
 */
function match(listed, at = now()) {
  if (!listed || !listed.length || !watching()) return 0;
  const byHost = new Map();
  const byDomain = new Map();
  for (const item of listed) {
    const host = bare(item.host);
    const p = analyze(`http://${host}`);
    if (!p || shared(p)) continue;
    byHost.set(hash(host), { ...item, host });
    // The whole domain is listed: a visit to any of its subdomains counts too.
    if (host === bare(p.registrable)) byDomain.set(hash(host), { ...item, host });
  }
  if (!byHost.size) return 0;
  let found = 0;
  for (const m of q.marks.all(at - KEEP_MARKS_MS)) {
    const hit = byHost.get(m.host_hash) || byDomain.get(m.reg_hash);
    if (!hit || m.day > at) continue;
    found += Number(q.expose.run(m.user_id, hit.host, hit.threat, hit.category || null, m.day, at).changes);
  }
  return found;
}

/**
 * What a listing means for the person, and what to do about it. The steps are chosen by what the list says the
 * site is; a site that copied a brand gets that brand's real address, which is safe to open.
 */
function advice(row) {
  const p = analyze(`http://${row.host}`);
  const b = p ? brandInfo(p) : {};
  const brand = b.lookalike || b.inDomain || b.inSubdomain || null;
  const realSite = brand && brand.domains && brand.domains[0] ? brand.domains[0] : null;
  const malware = row.threat === 'malware' || row.threat === 'virus';
  const kind = malware ? 'malware' : row.category === 'phishing' ? 'phishing' : row.category === 'crypto_scam' ? 'crypto' : 'scam';
  return { kind, realSite };
}

/** This account's exposures from the last 30 days that it has not dismissed, newest first. */
function list(userId, at = now()) {
  return q.list.all(userId, at - KEEP_EXPOSURES_MS).map((r) => ({
    host: r.host, threat: r.threat, category: r.category, visitedAt: r.visited_day, listedAt: r.listed_at,
    notified: Boolean(r.notified_at), ...advice(r)
  }));
}

function markNotified(userId, hosts, at = now()) {
  let n = 0;
  for (const host of hosts) n += Number(q.notified.run(at, userId, String(host)).changes);
  return n;
}

function dismiss(userId, host, at = now()) { return q.dismiss.run(at, userId, String(host)).changes > 0; }

module.exports = { remember, forget, watching, match, list, markNotified, dismiss, KEEP_MARKS_MS, KEEP_EXPOSURES_MS };
