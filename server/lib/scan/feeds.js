'use strict';
/**
 * Public threat-feed ingestion. Feeds are free, keyless and refreshed on a timer:
 *
 *   openphish          live phishing URLs
 *   urlhaus            live malware distribution URLs (abuse.ch)
 *   phishing_database  active phishing domains (Phishing.Database project)
 *
 * Imports run in small transactions with yields in between, so a 400k-row feed
 * never stalls requests. The name-token index used by "compare to known scams"
 * is maintained incrementally - only domains that appear or disappear are
 * re-tokenised - with a full rebuild at most once a week.
 */
const { db, now } = require('../db');
const config = require('../../config');
const L = require('./lists');
const { analyze, urlKey, deskin, nameTokens } = require('./url');

const FEEDS = [
  { id: 'openphish', kind: 'urls', threat: 'scam', category: 'phishing', url: 'https://openphish.com/feed.txt' },
  { id: 'urlhaus', kind: 'urls', threat: 'malware', category: 'malware_distribution', url: 'https://urlhaus.abuse.ch/downloads/text_recent/' },
  { id: 'phishing_database', kind: 'hosts', threat: 'scam', category: 'phishing', url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt' }
];

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
    if (q.hostNew.run(p.host, feed.id, threat, feed.category, deskin(p.sld), stamp).changes) {
      if (threat === 'scam') added.add(p.registrable);
    } else {
      q.hostTouch.run(stamp, threat, p.host, feed.id);
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
    const res = await fetch(feed.url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'SentinelScan/1.0 (+threat-feed-sync)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const result = await importLines(feed, text.split(/\r?\n/));
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

let running = null;
async function refreshAll({ log = false } = {}) {
  if (running) return running;
  running = (async () => {
    const results = [];
    const added = new Set();
    const removed = new Set();
    for (const feed of FEEDS) {
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
  const stale = FEEDS.some((f) => {
    const row = db.prepare('SELECT fetched_at, ok FROM feed_status WHERE source = ?').get(f.id);
    return !row || !row.ok || now() - row.fetched_at > config.feedRefreshHours * 3600 * 1000;
  });
  if (stale) setTimeout(() => refreshAll({ log: true }).catch(() => {}), 1500).unref();
  setInterval(() => refreshAll().catch(() => {}), config.feedRefreshHours * 3600 * 1000).unref();
}

module.exports = {
  FEEDS, importLines, refreshAll, rebuildTokens, start,
  status: () => q.allStatus.all().filter((r) => !r.source.startsWith('_'))
};
