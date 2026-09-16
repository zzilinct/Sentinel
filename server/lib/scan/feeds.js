'use strict';
/**
 * Public threat-feed ingestion. Feeds are free, keyless and refreshed on a timer:
 *
 *   openphish          live phishing URLs
 *   urlhaus            live malware distribution URLs (abuse.ch)
 *   phishing_database  active phishing domains (Phishing.Database project)
 *
 * Imports run in small transactions with yields in between, so a 400k-row feed
 * never stalls requests being served at the same time.
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
const allow = new Set(L.DEFAULT_ALLOWLIST);

const q = {
  host: db.prepare(`INSERT INTO feed_hosts (host, source, threat, category, skeleton, added_at) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(host, source) DO UPDATE SET added_at = excluded.added_at, threat = excluded.threat`),
  url: db.prepare(`INSERT INTO feed_urls (url_key, host, source, threat, category, added_at) VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(url_key, source) DO UPDATE SET added_at = excluded.added_at`),
  pruneHosts: db.prepare('DELETE FROM feed_hosts WHERE source = ? AND added_at < ?'),
  pruneUrls: db.prepare('DELETE FROM feed_urls WHERE source = ? AND added_at < ?'),
  status: db.prepare(`INSERT INTO feed_status (source, fetched_at, entries, ok, error) VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(source) DO UPDATE SET fetched_at = excluded.fetched_at, entries = excluded.entries, ok = excluded.ok, error = excluded.error`),
  allStatus: db.prepare('SELECT * FROM feed_status ORDER BY source')
};

const tick = () => new Promise((r) => setImmediate(r));

function isAllowlisted(p) {
  return allow.has(p.registrable) || allow.has(p.host) || L.PROTECTED_BRANDS.some((b) => b.domains.includes(p.registrable));
}

/** Import already-downloaded feed lines. Exposed for tests and manual imports. */
async function importLines(feed, lines) {
  const stamp = now();
  let count = 0;
  const rows = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  for (let i = 0; i < rows.length; i += CHUNK) {
    db.exec('BEGIN');
    try {
      for (const line of rows.slice(i, i + CHUNK)) {
        const p = analyze(feed.kind === 'hosts' ? `http://${line}` : line);
        if (!p) continue;

        if (feed.kind === 'hosts') {
          if (isAllowlisted(p)) continue;
          q.host.run(p.host, feed.id, feed.threat, feed.category, deskin(p.sld), stamp);
          count++;
          continue;
        }

        const threat = feed.threat === 'malware' && L.EXECUTABLE_EXT.has(p.ext) ? 'virus' : feed.threat;
        q.url.run(urlKey(p.url), p.host, feed.id, threat, feed.category, stamp);
        count++;
        // A phishing URL at the root of a non-allowlisted host means the whole host is the scam.
        if (feed.kind === 'urls' && (p.path === '/' || p.path === '') && !p.query && !isAllowlisted(p)) {
          q.host.run(p.host, feed.id, threat, feed.category, deskin(p.sld), stamp);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    await tick();
  }

  q.pruneHosts.run(feed.id, stamp);
  q.pruneUrls.run(feed.id, stamp);
  q.status.run(feed.id, stamp, count, 1, null);
  return count;
}

async function refreshFeed(feed) {
  try {
    const res = await fetch(feed.url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'SentinelScan/1.0 (+threat-feed-sync)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const count = await importLines(feed, text.split(/\r?\n/));
    return { source: feed.id, ok: true, entries: count };
  } catch (err) {
    q.status.run(feed.id, now(), 0, 0, String(err.message).slice(0, 200));
    return { source: feed.id, ok: false, error: err.message };
  }
}

/**
 * Rebuild the distinctive-token index from every known scam domain. Tokens are
 * what "compare to known scams" uses to spot a new domain built the same way.
 */
async function rebuildTokens() {
  const hosts = [
    ...db.prepare("SELECT host FROM blocklist WHERE threat = 'scam'").all(),
    ...db.prepare("SELECT DISTINCT host FROM feed_hosts WHERE threat = 'scam'").all()
  ].map((r) => r.host);

  db.exec('DELETE FROM scam_tokens');
  const ins = db.prepare('INSERT OR IGNORE INTO scam_tokens (token, host) VALUES (?, ?)');
  for (let i = 0; i < hosts.length; i += CHUNK) {
    db.exec('BEGIN');
    try {
      for (const host of hosts.slice(i, i + CHUNK)) {
        const p = analyze(`http://${host}`);
        if (!p || p.isIp) continue;
        for (const token of nameTokens(p.registrable)) ins.run(token, p.registrable);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    await tick();
  }
  db.exec('DELETE FROM token_df');
  db.exec('INSERT INTO token_df (token, df) SELECT token, COUNT(*) FROM scam_tokens GROUP BY token');
  return hosts.length;
}

let running = null;
async function refreshAll({ log = false } = {}) {
  if (running) return running;
  running = (async () => {
    const results = [];
    for (const feed of FEEDS) {
      const r = await refreshFeed(feed);
      results.push(r);
      if (log) console.log(`  feed      ${feed.id}: ${r.ok ? `${r.entries.toLocaleString()} entries` : `failed (${r.error})`}`);
    }
    await rebuildTokens();
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

module.exports = { FEEDS, importLines, refreshAll, rebuildTokens, start, status: () => q.allStatus.all() };
