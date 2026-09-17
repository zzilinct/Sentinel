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
const { urlKey, isUserContent } = require('./url');

const REPORTS_FOR_CONFIRMED = 3;

const q = {
  block: db.prepare('SELECT host, category, source, threat FROM blocklist WHERE host = ? OR host = ?'),
  allow: db.prepare('SELECT 1 FROM allowlist WHERE host = ? OR host = ?'),
  feedHost: db.prepare('SELECT host, source, threat, category FROM feed_hosts WHERE host = ? OR host = ?'),
  feedUrl: db.prepare('SELECT source, threat, category FROM feed_urls WHERE url_key = ?'),
  feedUrlHostCount: db.prepare('SELECT COUNT(*) AS n FROM feed_urls WHERE host = ?'),
  reports: db.prepare('SELECT category, COUNT(*) AS n FROM reports WHERE host = ? GROUP BY category'),
  sources: db.prepare("SELECT source, entries FROM feed_status WHERE ok = 1 AND substr(source, 1, 1) != '_'")
};

const SOURCE_NAMES = {
  sentinel: 'Sentinel threat database',
  community: 'Sentinel community reports',
  openphish: 'OpenPhish',
  urlhaus: 'URLhaus (abuse.ch)',
  phishing_database: 'Phishing.Database',
  google_safe_browsing: 'Google Safe Browsing'
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

  for (const row of q.block.all(p.host, p.registrable)) add(row.source === 'community' ? 'community' : 'sentinel', row.threat, row.category);
  for (const row of q.feedHost.all(p.host, p.registrable)) add(row.source, row.threat, row.category);

  const key = urlKey(p.url);
  if (key) for (const row of q.feedUrl.all(key)) add(row.source, row.threat, row.category);

  // Several distinct malicious URLs on one host usually means the host itself is
  // compromised - except on verified platforms (GitHub, Google Drive, Discord...)
  // where users upload content: there, only the exact malicious URLs count.
  const userContent = isUserContent(p.host);
  const allowed = Boolean(q.allow.get(p.host, p.registrable));
  const verified = allowed && !userContent;
  if (!matches.length && !allowed && !userContent && q.feedUrlHostCount.get(p.host).n >= 3) add('urlhaus', 'malware', 'compromised_host', 'likely');

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
    sources: checkedSources()
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
