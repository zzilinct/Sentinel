'use strict';
/**
 * Public threat-feed ingestion. Every feed is free and keyless. A site found in
 * any of them is a confirmed threat: that is what "known" means in a verdict.
 *
 *   Phishing and scams   OpenPhish, PhishTank, Phishing.Database, the
 *                        malware-filter phishing list, CERT Polska's warning
 *                        list, DurableNapkin's scam blocklist, Spam404
 *   Crypto scams         MetaMask's phishing detector, ScamSniffer,
 *                        the Polkadot.js phishing list
 *   Malware              URLhaus (URLs and hosts), ThreatFox, Feodo Tracker,
 *                        Blackbook
 *
 * Each feed refreshes on its own interval. Imports run in small transactions
 * with yields in between, so a million-row feed never stalls requests. The
 * name-token index used by "compare to known scams" is maintained
 * incrementally - only domains that appear or disappear are re-tokenised -
 * with a full rebuild at most once a week.
 */
const { db, now } = require('../db');
const config = require('../../config');
const L = require('./lists');
const { analyze, urlKey, deskin, nameTokens } = require('./url');

/**
 * kind      'urls' (exact malicious addresses) or 'hosts' (whole domains / IPs)
 * format    how the download is read: plain lines (default), 'hostsfile'
 *           ("0.0.0.0 domain"), 'json' (an array, or the array under `pick`),
 *           'csv' (the column at `column`, header skipped)
 * hours     refresh interval
 */
const FEEDS = [
  // phishing and scams
  { id: 'openphish', name: 'OpenPhish', kind: 'urls', threat: 'scam', category: 'phishing', hours: 6,
    url: 'https://openphish.com/feed.txt' },
  { id: 'phishtank', name: 'PhishTank', kind: 'urls', threat: 'scam', category: 'phishing', hours: 6, format: 'csv', column: 1,
    url: 'http://data.phishtank.com/data/online-valid.csv' },
  { id: 'phishing_database', name: 'Phishing.Database', kind: 'hosts', threat: 'scam', category: 'phishing', hours: 24,
    url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt' },
  { id: 'phishing_filter', name: 'Phishing Filter (malware-filter)', kind: 'hosts', threat: 'scam', category: 'phishing', hours: 12,
    url: 'https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt' },
  { id: 'certpl', name: 'CERT Polska warning list', kind: 'hosts', threat: 'scam', category: 'phishing', hours: 12,
    url: 'https://hole.cert.pl/domains/v2/domains.txt' },
  { id: 'scamblocklist', name: 'DurableNapkin scam blocklist', kind: 'hosts', threat: 'scam', category: 'scam', hours: 24, format: 'hostsfile',
    url: 'https://raw.githubusercontent.com/durablenapkin/scamblocklist/master/hosts.txt' },
  { id: 'spam404', name: 'Spam404', kind: 'hosts', threat: 'scam', category: 'scam', hours: 24,
    url: 'https://raw.githubusercontent.com/Spam404/lists/master/main-blacklist.txt' },
  // crypto scams
  { id: 'metamask', name: 'MetaMask phishing detector', kind: 'hosts', threat: 'scam', category: 'crypto_scam', hours: 24, format: 'json', pick: 'blacklist',
    url: 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json' },
  { id: 'scamsniffer', name: 'ScamSniffer', kind: 'hosts', threat: 'scam', category: 'crypto_scam', hours: 24, format: 'json',
    url: 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json' },
  { id: 'polkadot_phishing', name: 'Polkadot.js phishing list', kind: 'hosts', threat: 'scam', category: 'crypto_scam', hours: 24, format: 'json', pick: 'deny',
    url: 'https://raw.githubusercontent.com/polkadot-js/phishing/master/all.json' },
  // malware
  { id: 'urlhaus', name: 'URLhaus (abuse.ch)', kind: 'urls', threat: 'malware', category: 'malware_distribution', hours: 6,
    url: 'https://urlhaus.abuse.ch/downloads/text_online/' },
  { id: 'urlhaus_hosts', name: 'URLhaus host list (malware-filter)', kind: 'hosts', threat: 'malware', category: 'malware_distribution', hours: 12,
    url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt' },
  { id: 'threatfox', name: 'ThreatFox (abuse.ch)', kind: 'hosts', threat: 'malware', category: 'malware_c2', hours: 12, format: 'hostsfile',
    url: 'https://threatfox.abuse.ch/downloads/hostfile/' },
  { id: 'feodotracker', name: 'Feodo Tracker (abuse.ch)', kind: 'hosts', threat: 'malware', category: 'botnet_c2', hours: 12,
    url: 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt' },
  { id: 'blackbook', name: 'Blackbook malicious domains', kind: 'hosts', threat: 'malware', category: 'malware', hours: 24,
    url: 'https://raw.githubusercontent.com/stamparm/blackbook/master/blackbook.txt' }
];

/** One CSV record's fields (RFC 4180 quoting), enough for the feeds above. */
function csvFields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** The entries (addresses or hosts) a downloaded feed contains, whatever its format. */
function extract(feed, text) {
  if (feed.format === 'json') {
    let data = JSON.parse(text);
    if (feed.pick) data = data[feed.pick];
    return Array.isArray(data) ? data.filter((v) => typeof v === 'string') : [];
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l[0] !== '#' && l[0] !== '!' && l[0] !== '/');
  if (feed.format === 'csv') return lines.slice(1).map((l) => csvFields(l)[feed.column]).filter(Boolean);
  if (feed.format === 'hostsfile') {
    return lines.map((l) => l.split(/\s+/)).filter((parts) => parts.length >= 2 && /^(0\.0\.0\.0|127\.0\.0\.1|::1?)$/.test(parts[0])).map((parts) => parts[1]);
  }
  return lines.map((l) => l.split(/\s+/)[0]);
}

const CHUNK = 4000;
const FULL_REBUILD_MS = 7 * 24 * 60 * 60 * 1000;

// Every domain a feed must never mark: verified sites plus all official brand domains.
const NEVER_LIST = new Set([...L.DEFAULT_ALLOWLIST, ...L.PROTECTED_BRANDS.flatMap((b) => b.domains)]);

const q = {
  hostNew: db.prepare('INSERT OR IGNORE INTO feed_hosts (host, source, threat, category, skeleton, added_at) VALUES (?, ?, ?, ?, ?, ?)'),
  hostTouch: db.prepare('UPDATE feed_hosts SET added_at = ?, threat = ? WHERE host = ? AND source = ?'),
  url: db.prepare(`INSERT INTO feed_urls (url_key, host, source, threat, category, added_at) VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(url_key, source) DO UPDATE SET added_at = excluded.added_at`),
  staleHosts: db.prepare("SELECT host FROM feed_hosts WHERE source = ? AND added_at < ? AND threat = 'scam'"),
  pruneHosts: db.prepare('DELETE FROM feed_hosts WHERE source = ? AND added_at < ?'),
  pruneUrls: db.prepare('DELETE FROM feed_urls WHERE source = ? AND added_at < ?'),
  stillKnown: db.prepare("SELECT 1 FROM feed_hosts WHERE host = ? AND threat = 'scam' UNION SELECT 1 FROM blocklist WHERE host = ? AND threat = 'scam' LIMIT 1"),
  tokenIns: db.prepare('INSERT OR IGNORE INTO scam_tokens (token, host) VALUES (?, ?)'),
  tokenDel: db.prepare('DELETE FROM scam_tokens WHERE host = ?'),
  status: db.prepare(`INSERT INTO feed_status (source, fetched_at, entries, ok, error) VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(source) DO UPDATE SET fetched_at = excluded.fetched_at, entries = excluded.entries, ok = excluded.ok, error = excluded.error`),
  allStatus: db.prepare('SELECT * FROM feed_status ORDER BY source'),
  meta: db.prepare("SELECT fetched_at FROM feed_status WHERE source = '_token_rebuild'")
};

const tick = () => new Promise((r) => setImmediate(r));
const isNever = (p) => NEVER_LIST.has(p.registrable) || NEVER_LIST.has(p.host);

/** Import already-downloaded feed lines. Returns counts and the scam hosts that changed. */
async function importLines(feed, lines) {
  const stamp = now();
  let count = 0;
  const added = new Set();
  const rows = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  const putHost = (p, threat) => {
    const host = p.host.replace(/^www\./, '');
    if (q.hostNew.run(host, feed.id, threat, feed.category, deskin(p.sld), stamp).changes) {
      if (threat === 'scam') added.add(p.registrable);
    } else {
      q.hostTouch.run(stamp, threat, host, feed.id);
    }
  };

  for (let i = 0; i < rows.length; i += CHUNK) {
    db.exec('BEGIN');
    try {
      for (const line of rows.slice(i, i + CHUNK)) {
        const p = analyze(feed.kind === 'hosts' ? `http://${line}` : line);
        if (!p) continue;

        if (feed.kind === 'hosts') {
          if (isNever(p)) continue;
          putHost(p, feed.threat);
          count++;
          continue;
        }

        const threat = feed.threat === 'malware' && L.EXECUTABLE_EXT.has(p.ext) ? 'virus' : feed.threat;
        q.url.run(urlKey(p.url), p.host, feed.id, threat, feed.category, stamp);
        count++;
        // A phishing URL at the root of a non-verified host means the whole host is the scam.
        if ((p.path === '/' || p.path === '') && !p.query && !isNever(p)) putHost(p, threat);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    await tick();
  }

  const removed = new Set(q.staleHosts.all(feed.id, stamp).map((r) => (analyze(`http://${r.host}`) || { registrable: r.host }).registrable));
  q.pruneHosts.run(feed.id, stamp);
  q.pruneUrls.run(feed.id, stamp);
  q.status.run(feed.id, stamp, count, 1, null);
  return { count, added, removed };
}

/** Apply added/removed scam domains to the token index. */
async function updateTokens(added, removed) {
  if (!added.size && !removed.size) return false;
  const addList = [...added];
  for (let i = 0; i < addList.length; i += CHUNK) {
    db.exec('BEGIN');
    try {
      for (const host of addList.slice(i, i + CHUNK)) for (const token of nameTokens(host)) q.tokenIns.run(token, host);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    await tick();
  }
  const removeList = [...removed].filter((h) => !added.has(h));
  db.exec('BEGIN');
  try {
    for (const host of removeList) if (!q.stillKnown.get(host, host)) q.tokenDel.run(host);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  recomputeDf();
  return true;
}

function recomputeDf() {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM token_df');
    db.exec('INSERT INTO token_df (token, df) SELECT token, COUNT(*) FROM scam_tokens GROUP BY token');
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

async function refreshFeed(feed) {
  try {
    const res = await fetch(feed.url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'SentinelScan/1.0 (+threat-feed-sync)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const result = await importLines(feed, extract(feed, text));
    return { source: feed.id, ok: true, entries: result.count, added: result.added, removed: result.removed };
  } catch (err) {
    q.status.run(feed.id, now(), 0, 0, String(err.message).slice(0, 200));
    return { source: feed.id, ok: false, error: err.message };
  }
}

/** Full rebuild of the distinctive-token index from every known scam domain. */
async function rebuildTokens() {
  const hosts = [...new Set([
    ...db.prepare("SELECT host FROM blocklist WHERE threat = 'scam'").all(),
    ...db.prepare("SELECT DISTINCT host FROM feed_hosts WHERE threat = 'scam'").all()
  ].map((r) => (analyze(`http://${r.host}`) || {}).registrable).filter(Boolean))];

  db.exec('DELETE FROM scam_tokens');
  for (let i = 0; i < hosts.length; i += CHUNK) {
    db.exec('BEGIN');
    try {
      for (const host of hosts.slice(i, i + CHUNK)) for (const token of nameTokens(host)) q.tokenIns.run(token, host);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    await tick();
  }
  recomputeDf();
  q.status.run('_token_rebuild', now(), hosts.length, 1, null);
  return hosts.length;
}

/** A feed is due when it has never loaded, last failed, or its own interval has passed. */
function isStale(feed) {
  const row = db.prepare('SELECT fetched_at, ok FROM feed_status WHERE source = ?').get(feed.id);
  const hours = feed.hours || config.feedRefreshHours || 6;
  return !row || !row.ok || now() - row.fetched_at > hours * 3600 * 1000;
}

let running = null;
/** Refresh every feed that is due (or all of them with `force`). */
async function refreshAll({ log = false, force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const results = [];
    const added = new Set();
    const removed = new Set();
    for (const feed of FEEDS) {
      if (!force && !isStale(feed)) continue;
      const r = await refreshFeed(feed);
      results.push({ source: r.source, ok: r.ok, entries: r.entries, error: r.error });
      if (r.ok) { r.added.forEach((h) => added.add(h)); r.removed.forEach((h) => removed.add(h)); }
      if (log) console.log(`  feed      ${feed.id}: ${r.ok ? `${r.entries.toLocaleString()} entries` : `failed (${r.error})`}`);
    }
    const last = q.meta.get();
    if (!last || now() - last.fetched_at > FULL_REBUILD_MS) await rebuildTokens();
    else await updateTokens(added, removed);
    return results;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

function start() {
  if (!config.feedRefreshHours) return;
  if (FEEDS.some(isStale)) setTimeout(() => refreshAll({ log: true }).catch(() => {}), 1500).unref();
  // Check hourly; each feed decides for itself whether it is due.
  setInterval(() => refreshAll().catch(() => {}), 3600 * 1000).unref();
}

/** How many feeds have loaded at least once, for "still downloading" notes. */
function readiness() {
  const ok = new Set(q.allStatus.all().filter((r) => r.ok && !r.source.startsWith('_')).map((r) => r.source));
  return { ready: FEEDS.filter((f) => ok.has(f.id)).length, total: FEEDS.length };
}

module.exports = {
  FEEDS, extract, importLines, refreshAll, rebuildTokens, start, readiness,
  status: () => q.allStatus.all().filter((r) => !r.source.startsWith('_'))
};
