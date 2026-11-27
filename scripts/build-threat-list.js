'use strict';
/**
 * The companion's threat list: every host Sentinel's scanner has on a list (its own database, the community's, and the
 * public feeds), as a small sorted file the companion checks on the person's own device (scripts/engine-bundle.js says
 * how it is laid out). .github/workflows/threat-list.yml runs this each day and publishes the file.
 *
 *   node scripts/build-threat-list.js [out-file]     refreshes the feeds, then writes the file (default threats.bin)
 *
 * Only hosts: an exact page on a shared site (a form on a CRM) is not a host, and stays with the scanner.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listFile } = require('./engine-bundle');

/** What the scanner's own lookup reads for a host (server/lib/scan/knowledge.js): the blocklist and the feed hosts. */
const rowsFrom = (db) => [
  ...db.prepare('SELECT host, threat FROM blocklist').all(),
  ...db.prepare('SELECT host, threat FROM feed_hosts').all()
];

async function main() {
  process.env.DB_PATH = process.env.DB_PATH || path.join(os.tmpdir(), `sentinel-threat-list-${process.pid}.db`);
  process.env.FEED_REFRESH_HOURS = '0';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  require('../server/seed').run({ quiet: true });
  const feeds = require('../server/lib/scan/feeds');
  await feeds.refreshAll({ force: true });
  const { db } = require('../server/lib/db');
  const rows = rowsFrom(db);
  const out = path.resolve(process.argv[2] || 'threats.bin');
  const file = listFile(rows);
  fs.writeFileSync(out, file);
  console.log(`${rows.length} hosts read, ${(file.length - 16) / 8} kept, ${file.length} bytes: ${out}`);
  // A feed that failed to load must not publish a list that has lost its hosts.
  if (rows.length < 1000) { console.error('fewer than 1000 hosts: the feeds did not load, so this list is not published'); process.exit(1); }
}

if (require.main === module) main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
module.exports = { rowsFrom };
