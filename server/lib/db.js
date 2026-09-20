'use strict';
/**
 * SQLite persistence on Node's built-in `node:sqlite`, with versioned migrations.
 *
 * Two files, on purpose:
 *
 *   sentinel.db        accounts, sessions, history, settings. Small, rarely
 *                      written, and the one thing that must never be lost.
 *   sentinel-feeds.db  the public threat lists and the index built from them.
 *                      More than a million rows rewritten every few hours. It is
 *                      a cache: if it is ever damaged it is deleted and downloaded
 *                      again, and no account is anywhere near it.
 *
 * They used to be one file. A copy of that file was found with rows missing
 * from its indexes and sessions whose users had vanished, after two server
 * processes shared it and one was killed mid-import. So: the accounts file is
 * checked on every start and repaired or restored from a verified backup, only
 * one server may hold it at a time, and memory-mapped I/O is off.
 */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const IN_MEMORY = config.dbPath === ':memory:';
const FEEDS_PATH = IN_MEMORY ? ':memory:' : `${config.dbPath.replace(/\.db$/i, '')}-feeds.db`;
const BACKUP_PATH = `${config.dbPath}.backup`;
const LEGACY_FEED_TABLES = ['feed_hosts', 'feed_urls', 'scam_tokens', 'token_df', 'feed_status'];
const note = (msg) => { if (!config.isTest) console.log(`  database  ${msg}`); };

function open(file) {
  const d = new DatabaseSync(file);
  try {
    d.exec('PRAGMA journal_mode = WAL;');
    d.exec('PRAGMA synchronous = FULL;');       // accounts: every commit reaches the disk
    d.exec('PRAGMA foreign_keys = ON;');
    d.exec('PRAGMA busy_timeout = 5000;');
    d.exec('PRAGMA temp_store = MEMORY;');
    d.exec('PRAGMA mmap_size = 0;');            // no memory-mapped I/O: one less way for two processes to hurt a file
  } catch (err) {
    // Not a database at all. Let go of the file so it can be moved aside.
    try { d.close(); } catch { /* never opened properly */ }
    throw err;
  }
  return d;
}

function healthy(d, schema = 'main') {
  try {
    const rows = d.prepare(`PRAGMA ${schema}.quick_check`).all();
    return rows.length === 1 && rows[0].quick_check === 'ok';
  } catch {
    return false;
  }
}

/** The old single-file layout kept the threat lists in the accounts file. They are a cache: drop them. */
function dropLegacyFeedTables(d) {
  let dropped = 0;
  for (const name of LEGACY_FEED_TABLES) {
    try {
      if (d.prepare("SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?").get(name)) {
        d.exec(`DROP TABLE main.${name}`);
        dropped++;
      }
    } catch { /* a damaged table is handled by the integrity check below */ }
  }
  return dropped;
}

/** Open the accounts file; repair it, restore it from the verified backup, or as a last resort start fresh. */
function openAccounts() {
  if (IN_MEMORY) return open(':memory:');
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  let d = null;
  try { d = open(config.dbPath); } catch { d = null; }

  if (d) {
    const existed = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    // Only once every migration that touches those tables has already run.
    const version = d.prepare('PRAGMA user_version').get().user_version;
    if (existed && version >= 6 && dropLegacyFeedTables(d)) {
      note('moved the threat lists out of the accounts file (they download again into their own file)');
    }
    if (!healthy(d)) {
      note('integrity check FAILED on the accounts file; rebuilding its indexes');
      try { d.exec('REINDEX'); } catch { /* checked again below */ }
      if (healthy(d)) note('indexes rebuilt; the accounts file passes its integrity check');
      else { try { d.close(); } catch { /* already unusable */ } d = null; }
    }
  }

  if (!d) {
    const aside = `${config.dbPath}.damaged-${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) {
      try { if (fs.existsSync(config.dbPath + suffix)) fs.renameSync(config.dbPath + suffix, aside + suffix); } catch { /* keep going */ }
    }
    if (fs.existsSync(BACKUP_PATH)) {
      try {
        fs.copyFileSync(BACKUP_PATH, config.dbPath);
        d = open(config.dbPath);
        if (healthy(d)) note(`the accounts file was damaged; restored the last verified backup (damaged copy kept at ${path.basename(aside)})`);
        else { d.close(); d = null; fs.unlinkSync(config.dbPath); }
      } catch { d = null; }
    }
    if (!d) {
      d = open(config.dbPath);
      note(`the accounts file was damaged and no backup could be used; started a new one (damaged copy kept at ${path.basename(aside)})`);
    }
  }

  // Hand back the space the threat lists used to take. This has to come after the
  // repair: VACUUM refuses to run on a file whose indexes are damaged.
  // In WAL mode a VACUUM lands in the log first; the file itself only shrinks once
  // the log is folded back in, and a server that is killed rather than closed
  // never gets to do that. So fold it in here whenever the file on disk is far
  // bigger than what it holds.
  try {
    const SLACK = 32 * 1024 * 1024;
    const pageSize = d.prepare('PRAGMA page_size').get().page_size;
    const onDisk = () => fs.statSync(config.dbPath).size;
    const before = onDisk();
    if (d.prepare('PRAGMA freelist_count').get().freelist_count * pageSize > SLACK) d.exec('VACUUM');
    if (before - d.prepare('PRAGMA page_count').get().page_count * pageSize > SLACK) {
      d.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
      const saved = before - onDisk();
      note(saved > SLACK
        ? `reclaimed ${Math.round(saved / 1048576)} MB of empty space in the accounts file`
        : 'the accounts file is larger than what it holds, and could not be shrunk this time');
    }
  } catch (err) {
    // Shrinking is a nicety, never a reason not to start. Say why it did not happen.
    note(`could not shrink the accounts file: ${String(err && err.message || err).slice(0, 120)}`);
  }

  // Rows that point at a user who no longer exists (left behind by past damage) cannot be honoured.
  try {
    const orphans = d.prepare('PRAGMA foreign_key_check').all();
    for (const o of orphans) d.prepare(`DELETE FROM "${String(o.table).replace(/"/g, '')}" WHERE rowid = ?`).run(o.rowid);
    if (orphans.length) note(`removed ${orphans.length} row(s) that belonged to accounts which no longer exist`);
  } catch { /* a brand-new file has nothing to check */ }
  return d;
}

const db = openAccounts();

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
  `,

  // 6 - threat kinds on scan history (JSON: {"scam":"phishing"}), for the icons
  `
  ALTER TABLE scan_history ADD COLUMN kinds TEXT;
  `,

  // 7 - rolling session expiry ("stay signed in" = 30 days of inactivity), and
  //     the threat lists move to their own file (see the top of this module)
  `
  ALTER TABLE sessions ADD COLUMN idle_ms INTEGER;
  ALTER TABLE sessions ADD COLUMN persistent INTEGER NOT NULL DEFAULT 1;
  DROP TABLE IF EXISTS main.feed_hosts;
  DROP TABLE IF EXISTS main.feed_urls;
  DROP TABLE IF EXISTS main.scam_tokens;
  DROP TABLE IF EXISTS main.token_df;
  DROP TABLE IF EXISTS main.feed_status;
  `
];

function migrate() {
  const current = db.prepare('PRAGMA main.user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA main.user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${v + 1} failed: ${err.message}`);
    }
  }
}
migrate();

/* ------------------------------------------------------ the threat-list cache */

const FEEDS_SCHEMA = `
  -- Hosts that exist only to scam / spread malware (domain-level feeds).
  CREATE TABLE IF NOT EXISTS feeds.feed_hosts (
    host TEXT NOT NULL, source TEXT NOT NULL, threat TEXT NOT NULL, category TEXT,
    skeleton TEXT, added_at INTEGER NOT NULL,
    PRIMARY KEY (host, source)
  );
  CREATE INDEX IF NOT EXISTS feeds.idx_feed_hosts_skeleton ON feed_hosts(skeleton);
  CREATE INDEX IF NOT EXISTS feeds.idx_feed_hosts_source ON feed_hosts(source, added_at);

  -- Exact malicious URLs (these often live on otherwise-legitimate hosts).
  CREATE TABLE IF NOT EXISTS feeds.feed_urls (
    url_key TEXT NOT NULL, host TEXT NOT NULL, source TEXT NOT NULL, threat TEXT NOT NULL,
    category TEXT, added_at INTEGER NOT NULL,
    PRIMARY KEY (url_key, source)
  );
  CREATE INDEX IF NOT EXISTS feeds.idx_feed_urls_host ON feed_urls(host);
  CREATE INDEX IF NOT EXISTS feeds.idx_feed_urls_source ON feed_urls(source, added_at);

  -- Distinctive name tokens of known scam domains, for "looks like a known scam" matching.
  CREATE TABLE IF NOT EXISTS feeds.scam_tokens (token TEXT NOT NULL, host TEXT NOT NULL, PRIMARY KEY (token, host));
  CREATE INDEX IF NOT EXISTS feeds.idx_scam_tokens_host ON scam_tokens(host);
  CREATE TABLE IF NOT EXISTS feeds.token_df (token TEXT PRIMARY KEY, df INTEGER NOT NULL);

  CREATE TABLE IF NOT EXISTS feeds.feed_status (
    source TEXT PRIMARY KEY, fetched_at INTEGER, entries INTEGER, ok INTEGER, error TEXT
  );
`;

function attachFeeds() {
  const attach = () => {
    db.exec(`ATTACH DATABASE '${FEEDS_PATH.replace(/'/g, "''")}' AS feeds`);
    if (!IN_MEMORY) {
      db.exec('PRAGMA feeds.journal_mode = WAL;');
      db.exec('PRAGMA feeds.synchronous = NORMAL;');   // a cache: speed over durability
    }
    db.exec(FEEDS_SCHEMA);
    db.prepare('SELECT COUNT(*) AS n FROM feeds.feed_status').get();
  };
  try {
    attach();
  } catch (err) {
    resetFeeds(`could not be opened (${err.message})`, attach);
  }
}

/** Throw the cache away and start it again. Nothing in it is irreplaceable. */
function resetFeeds(why, attach) {
  try { db.exec('DETACH DATABASE feeds'); } catch { /* was never attached */ }
  if (!IN_MEMORY) for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(FEEDS_PATH + suffix); } catch { /* not there */ } }
  (attach || attachFeeds)();
  note(`the threat-list cache ${why}; it was reset and will download again`);
}
attachFeeds();

/** After an unclean shutdown the cache is checked in full; the accounts file is checked on every start. */
function verifyFeeds() {
  if (IN_MEMORY || healthy(db, 'feeds')) return true;
  resetFeeds('failed its integrity check');
  return false;
}

/* ------------------------------------------------------------ single owner */

/**
 * Only one server may hold the database (see dblock.js, which server/index.js
 * calls before this file is even loaded, so that a long migration is covered).
 * A claim left behind by a killed server means the threat-list cache may have
 * been cut off mid-write, so it is checked.
 */
function acquireLock() {
  if (IN_MEMORY) return { unclean: false };
  const claimed = require('./dblock').claim();
  if (claimed.unclean && !claimed.checked) {
    claimed.checked = true;
    note('the last run did not shut down cleanly; checking the threat-list cache');
    verifyFeeds();
  }
  return { unclean: claimed.unclean };
}

/* ------------------------------------------------------------------ backup */

/** A verified copy of the accounts file. Small, so it is cheap to take often. */
function backupAccounts() {
  if (IN_MEMORY) return false;
  const tmp = `${BACKUP_PATH}.tmp`;
  try {
    if (!healthy(db)) return false;                      // never overwrite a good backup with a bad file
    try { fs.unlinkSync(tmp); } catch { /* none */ }
    db.exec(`VACUUM main INTO '${tmp.replace(/'/g, "''")}'`);
    fs.renameSync(tmp, BACKUP_PATH);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* none */ }
    return false;
  }
}

function now() { return Date.now(); }

/** Drop expired rows. Cheap enough to run hourly. */
function sweep() {
  const t = now();
  const day = 24 * 60 * 60 * 1000;
  // A session ends when nobody has used it for its idle window (30 days when
  // "stay signed in" was ticked); expires_at is pushed forward on every use.
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(t - 10 * 60 * 1000);
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(t - day);
  db.prepare('DELETE FROM research_cache WHERE checked_at < ?').run(t - 3 * day);
  db.prepare('DELETE FROM live_minutes WHERE minute < ?').run(Math.floor((t - 21 * day) / 60000));
  db.prepare('DELETE FROM usage_counters WHERE week < ?').run(t - 35 * day);
  db.prepare('DELETE FROM scan_history WHERE created_at < ?').run(t - 90 * day);
  db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(t - 180 * day);
}

module.exports = { db, now, sweep, acquireLock, backupAccounts, verifyFeeds, FEEDS_PATH, BACKUP_PATH };
