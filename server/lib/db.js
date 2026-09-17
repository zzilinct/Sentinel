'use strict';
/** SQLite persistence on Node's built-in `node:sqlite`, with versioned migrations. */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA temp_store = MEMORY;');
db.exec('PRAGMA cache_size = -32000;');      // ~32 MB page cache for the feed tables
db.exec('PRAGMA mmap_size = 268435456;');    // map up to 256 MB for faster reads

const MIGRATIONS = [
  // 1 - original schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT,
    first_name TEXT NOT NULL, last_name TEXT, google_sub TEXT UNIQUE, avatar_url TEXT,
    created_at INTEGER NOT NULL, last_login_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'web', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, created_at INTEGER NOT NULL, next_url TEXT);
  CREATE TABLE IF NOT EXISTS ai_connections (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL,
    key_cipher TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, provider)
  );
  CREATE TABLE IF NOT EXISTS blocklist (
    host TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'scam', source TEXT NOT NULL DEFAULT 'sentinel',
    note TEXT, added_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS allowlist (host TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, host TEXT NOT NULL, url TEXT, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    category TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reports_host ON reports(host);
  CREATE TABLE IF NOT EXISTS overrides (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, host TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('allow','block')), created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, host)
  );
  CREATE TABLE IF NOT EXISTS verdict_cache (
    host TEXT PRIMARY KEY, score INTEGER NOT NULL, level TEXT NOT NULL, payload TEXT NOT NULL, checked_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scan_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, host TEXT NOT NULL, level TEXT NOT NULL,
    blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_user_time ON scan_events(user_id, created_at);
  `,

  // 2 - plans, quotas, threat categories, feeds, research cache, 2FA, lockout, audit
  `
  ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
  ALTER TABLE users ADD COLUMN totp_secret TEXT;
  ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE blocklist ADD COLUMN threat TEXT NOT NULL DEFAULT 'scam';

  DROP TABLE IF EXISTS verdict_cache;
  DROP TABLE IF EXISTS scan_events;

  CREATE TABLE usage_counters (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week INTEGER NOT NULL, metric TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, week, metric)
  );

  CREATE TABLE live_minutes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    minute INTEGER NOT NULL,
    PRIMARY KEY (user_id, minute)
  );

  -- Hosts that exist only to scam / spread malware (domain-level feeds).
  CREATE TABLE feed_hosts (
    host TEXT NOT NULL, source TEXT NOT NULL, threat TEXT NOT NULL, category TEXT,
    skeleton TEXT, added_at INTEGER NOT NULL,
    PRIMARY KEY (host, source)
  );
  CREATE INDEX idx_feed_hosts_skeleton ON feed_hosts(skeleton);

  -- Exact malicious URLs (these often live on otherwise-legitimate hosts).
  CREATE TABLE feed_urls (
    url_key TEXT NOT NULL, host TEXT NOT NULL, source TEXT NOT NULL, threat TEXT NOT NULL,
    category TEXT, added_at INTEGER NOT NULL,
    PRIMARY KEY (url_key, source)
  );
  CREATE INDEX idx_feed_urls_host ON feed_urls(host);

  -- Distinctive name tokens of known scam domains, for "looks like a known scam" matching.
  CREATE TABLE scam_tokens (token TEXT NOT NULL, host TEXT NOT NULL, PRIMARY KEY (token, host));
  CREATE TABLE token_df (token TEXT PRIMARY KEY, df INTEGER NOT NULL);

  CREATE TABLE feed_status (
    source TEXT PRIMARY KEY, fetched_at INTEGER, entries INTEGER, ok INTEGER, error TEXT
  );

  -- Content fingerprints of pages confirmed as scams, for page-to-page comparison.
  CREATE TABLE scam_fingerprints (
    simhash TEXT NOT NULL, host TEXT NOT NULL, threat TEXT NOT NULL, label TEXT, added_at INTEGER NOT NULL,
    PRIMARY KEY (simhash, host)
  );

  CREATE TABLE file_hashes (
    sha256 TEXT PRIMARY KEY, threat TEXT NOT NULL, name TEXT, source TEXT NOT NULL, added_at INTEGER NOT NULL
  );

  -- Research results (RDAP, DNS, TLS, page analysis) cached per host.
  CREATE TABLE research_cache (
    host TEXT PRIMARY KEY, payload TEXT NOT NULL, checked_at INTEGER NOT NULL
  );

  CREATE TABLE scan_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, target TEXT NOT NULL, mode TEXT NOT NULL,
    scam TEXT, virus TEXT, malware TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_history_user_time ON scan_history(user_id, created_at);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, event TEXT NOT NULL,
    ip TEXT, detail TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);
  `,

  // 3 - 2FA replay protection and session visibility
  `
  ALTER TABLE users ADD COLUMN totp_last_counter INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN ip TEXT;
  ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
  `,

  // 4 - password resets; indexes that keep feed refreshes and token upkeep fast
  `
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
  );
  CREATE INDEX idx_resets_user ON password_resets(user_id);
  CREATE INDEX idx_feed_hosts_source ON feed_hosts(source, added_at);
  CREATE INDEX idx_feed_urls_source ON feed_urls(source, added_at);
  CREATE INDEX idx_scam_tokens_host ON scam_tokens(host);
  `,

  // 5 - email verification; explicit age confirmation and terms acceptance
  `
  ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
  ALTER TABLE users ADD COLUMN age_confirmed_at INTEGER;
  ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
  ALTER TABLE users ADD COLUMN terms_version TEXT;
  -- Accounts that predate verification keep working; Google sign-ins arrive verified.
  UPDATE users SET email_verified_at = created_at;
  CREATE TABLE email_verifications (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
  );
  CREATE INDEX idx_verifications_user ON email_verifications(user_id);
  `
];

function migrate() {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${v + 1} failed: ${err.message}`);
    }
  }
}
migrate();

function now() { return Date.now(); }

/** Drop expired rows. Cheap enough to run hourly. */
function sweep() {
  const t = now();
  const day = 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(t - 10 * 60 * 1000);
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(t - day);
  db.prepare('DELETE FROM research_cache WHERE checked_at < ?').run(t - 3 * day);
  db.prepare('DELETE FROM live_minutes WHERE minute < ?').run(Math.floor((t - 21 * day) / 60000));
  db.prepare('DELETE FROM usage_counters WHERE week < ?').run(t - 35 * day);
  db.prepare('DELETE FROM scan_history WHERE created_at < ?').run(t - 90 * day);
  db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(t - 180 * day);
}

module.exports = { db, now, sweep };
