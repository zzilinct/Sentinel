'use strict';
// The threat-list import: written in the order of its key, and refreshed below normal priority. A real database file
// in a temporary folder, because the refresh thread cannot share an in-memory one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-feeds-'));
process.env.NODE_ENV = 'development';
process.env.DB_PATH = path.join(dir, 'sentinel.db');
process.env.FEED_REFRESH_HOURS = '0';
const { db, now } = require('../server/lib/db');
const feeds = require('../server/lib/scan/feeds');

test('a list is written in the order of its key, whatever order it came in', async () => {
  const hosts = Array.from({ length: 300 }, (_, i) => `n${(i * 7919 % 1000).toString(36)}-claim.example`);
  assert.notDeepStrictEqual(hosts, [...hosts].sort());
  await feeds.importLines({ id: 'scamsniffer', kind: 'hosts', threat: 'scam', category: 'crypto_scam' }, hosts);
  const stored = db.prepare("SELECT host FROM feed_hosts WHERE source = 'scamsniffer' ORDER BY rowid").all().map((r) => r.host);
  assert.strictEqual(stored.length, hosts.length);
  assert.deepStrictEqual(stored, [...stored].sort());
});

test('a refresh runs below normal priority, and the server has its own priority back afterwards', async () => {
  // Every list marked as just fetched: the refresh thread starts, finds nothing due, and fetches nothing.
  const mark = db.prepare('INSERT INTO feed_status (source, fetched_at, entries, ok, error) VALUES (?, ?, 1, 1, NULL) ON CONFLICT(source) DO UPDATE SET fetched_at = excluded.fetched_at, ok = 1');
  for (const f of feeds.FEEDS) mark.run(f.id, now());
  const before = os.getPriority();
  const r = await feeds._test.refreshInBackground();
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(r.results, []);
  assert.strictEqual(r.priority, os.constants.priority.PRIORITY_BELOW_NORMAL);
  assert.strictEqual(os.getPriority(), before);
});

test.after(() => { try { db.close(); } catch { /* closed */ } fs.rmSync(dir, { recursive: true, force: true }); });
