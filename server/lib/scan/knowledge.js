'use strict';
/**
 * Stage 1 - knowledge. Before any checklist runs, look the site up in everything
 * Sentinel already knows: its own threat database, the imported public feeds,
 * community reports and (when configured) Google Safe Browsing.
 *
 * A match is evidence. No match anywhere is also information: it lowers the odds
 * that the site is a scam, which the engine applies as a discount.
 */
const { db } = require('../db');
const safeBrowsing = require('./safebrowsing');
const feeds = require('./feeds');
const { urlKey, isUserContent } = require('./url');

const REPORTS_FOR_CONFIRMED = 3;

// Lists are queried by the exact host, the registrable domain and the host
// without "www.", so a list that says "www.evil.com" still catches "evil.com".
const q = {
  block: db.prepare('SELECT host, category, source, threat FROM blocklist WHERE host IN (?, ?, ?, ?)'),
  allow: db.prepare('SELECT 1 FROM allowlist WHERE host IN (?, ?, ?, ?)'),
  feedHost: db.prepare('SELECT host, source, threat, category FROM feed_hosts WHERE host IN (?, ?, ?, ?)'),
  feedUrl: db.prepare('SELECT source, threat, category FROM feed_urls WHERE url_key = ?'),
  feedUrlHost: db.prepare('SELECT source, threat, COUNT(*) AS n FROM feed_urls WHERE host IN (?, ?, ?) GROUP BY source, threat ORDER BY n DESC'),
  reports: db.prepare('SELECT category, COUNT(*) AS n FROM reports WHERE host = ? GROUP BY category'),
  sources: db.prepare("SELECT source, entries FROM feed_status WHERE ok = 1 AND substr(source, 1, 1) != '_'")
};

const SOURCE_NAMES = {
  sentinel: 'Sentinel threat database',
  community: 'Sentinel community reports',
  google_safe_browsing: 'Google Safe Browsing',
  ...Object.fromEntries(feeds.FEEDS.map((f) => [f.id, f.name]))
};

// The source list only changes when a feed refreshes, so read it at most once a minute.
let sourcesCache = { at: 0, names: [] };
function checkedSources() {
  if (Date.now() - sourcesCache.at < 60_000) return sourcesCache.names;
  const names = ['Sentinel threat database', 'Sentinel community reports'];
  for (const row of q.sources.all()) names.push(SOURCE_NAMES[row.source] || row.source);
  if (safeBrowsing.enabled()) names.push('Google Safe Browsing');
  sourcesCache = { at: Date.now(), names: [...new Set(names)] };
  return sourcesCache.names;
}

/**
 * @param {object} p parsed URL from url.analyze
 * @returns {Promise<{known: boolean, trusted: boolean, matches: object[], reports: number, sources: string[]}>}
 */
async function lookup(p, { useSafeBrowsing = true } = {}) {
  const matches = [];
  const add = (source, threat, category, strength = 'confirmed') => {
    matches.push({ source, sourceName: SOURCE_NAMES[source] || source, threat, category: category || threat, strength });
  };

  const bare = p.host.replace(/^www\./, '');
  const www = `www.${bare}`;
  for (const row of q.block.all(p.host, p.registrable, bare, www)) add(row.source === 'community' ? 'community' : 'sentinel', row.threat, row.category);
  for (const row of q.feedHost.all(p.host, p.registrable, bare, www)) add(row.source, row.threat, row.category);

  const key = urlKey(p.url);
  if (key) for (const row of q.feedUrl.all(key)) add(row.source, row.threat, row.category);

  // A host that serves a listed malicious address is itself dangerous: the
  // site is either the attacker's or compromised, and either way a visitor
  // is at risk anywhere on it. The one exception is a verified platform where
  // users upload content (GitHub, Google Drive, storage buckets...): there,
  // only the exact malicious URLs count.
  const userContent = isUserContent(p.host);
  const allowed = Boolean(q.allow.get(p.host, p.registrable, bare, www));
  const verified = allowed && !userContent;
  if (!allowed && !userContent) {
    for (const row of q.feedUrlHost.all(p.host, bare, www)) {
      add(row.source, row.threat, row.n >= 3 ? 'compromised_host' : row.threat === 'scam' ? 'hosts_phishing_page' : 'hosts_malware');
    }
  }

  let reports = 0;
  for (const row of q.reports.all(p.registrable)) reports += row.n;
  if (reports >= REPORTS_FOR_CONFIRMED) add('community', 'scam', 'community_confirmed');
  else if (reports > 0) add('community', 'scam', 'community_reported', 'reported');

  if (useSafeBrowsing) {
    const gsb = await safeBrowsing.lookup(p.url);
    if (gsb.hit) {
      const threat = /MALWARE|UNWANTED|HARMFUL/.test(gsb.threatType) ? 'malware' : 'scam';
      add('google_safe_browsing', threat, gsb.threatType.toLowerCase());
    }
  }

  const trusted = !matches.length && verified;
  // Exposed so scoring can skip the unknown-site discount for uploaded pages.
  return {
    known: matches.some((m) => m.strength === 'confirmed'),
    trusted,
    userContent,
    matches: dedupe(matches),
    reports,
    sources: checkedSources(),
    feeds: feeds.readiness()
  };
}

function dedupe(matches) {
  const seen = new Set();
  return matches.filter((m) => {
    const k = `${m.source}:${m.threat}:${m.category}:${m.strength}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

module.exports = { lookup };
