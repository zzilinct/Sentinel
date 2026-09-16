'use strict';
/** Load shipped allow/block intelligence on boot and index it for comparison. */
const { db, now } = require('./lib/db');
const L = require('./lib/scan/lists');

const insAllow = db.prepare('INSERT INTO allowlist (host, added_at) VALUES (?, ?) ON CONFLICT(host) DO NOTHING');
const insBlock = db.prepare(`INSERT INTO blocklist (host, category, source, note, threat, added_at)
                             VALUES (?, ?, 'sentinel', 'Shipped with Sentinel', ?, ?)
                             ON CONFLICT(host) DO UPDATE SET threat = excluded.threat, category = excluded.category`);

function run({ quiet = false } = {}) {
  const t = now();
  let allowed = 0;
  for (const host of L.DEFAULT_ALLOWLIST) allowed += insAllow.run(host, t).changes;
  for (const entry of L.SEED_BLOCKLIST) insBlock.run(entry.host, entry.category, entry.threat, t);

  // Keep the comparison index usable before the first feed sync finishes.
  const tokens = db.prepare('SELECT COUNT(*) AS n FROM scam_tokens').get().n;
  if (!tokens) {
    const { nameTokens, analyze } = require('./lib/scan/url');
    const ins = db.prepare('INSERT OR IGNORE INTO scam_tokens (token, host) VALUES (?, ?)');
    for (const { host } of db.prepare("SELECT host FROM blocklist WHERE threat = 'scam'").all()) {
      const p = analyze(`http://${host}`);
      if (p) for (const token of nameTokens(p.registrable)) ins.run(token, p.registrable);
    }
    db.exec('DELETE FROM token_df');
    db.exec('INSERT INTO token_df (token, df) SELECT token, COUNT(*) FROM scam_tokens GROUP BY token');
  }
  if (allowed && !quiet) console.log(`  seeded    ${allowed} verified sites, ${L.SEED_BLOCKLIST.length} confirmed threats`);
}

module.exports = { run };
