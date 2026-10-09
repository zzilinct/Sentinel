'use strict';
/**
 * End-to-end runs only (scripts/desktop-e2e.ps1, on a GitHub test desktop): tell a freshly installed Sentinel when two
 * stand-in shops were registered, as a registry lookup from an earlier delicate scan would have left it (research.js
 * keeps it under "lite:<host>"). Fast scanning looks nothing up, so "Before you pay" uses only this. Never run on a
 * real computer.
 *   node scripts/e2e-pay.js <path to sentinel.db>
 */
const { DatabaseSync } = require('node:sqlite');

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/e2e-pay.js <sentinel.db>'); process.exit(2); }
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout = 10000');
const set = db.prepare(`INSERT INTO research_cache (host, payload, checked_at) VALUES (?, ?, ?)
                        ON CONFLICT(host) DO UPDATE SET payload = excluded.payload, checked_at = excluded.checked_at`);
for (const [host, days] of [['youngshop.test', 21], ['oldshop.test', 9 * 365]]) {
  const registration = { available: true, registered: true, createdAt: now - days * DAY };
  set.run(`lite:${host}`, JSON.stringify({ performed: true, lite: true, checkedAt: now, registration, dns: { resolves: true, addresses: ['127.0.0.1'], mx: false, nameservers: [] }, http: { ok: false, chain: [] } }), now);
  console.log(`${host}: registered ${days} days ago`);
}
db.close();
