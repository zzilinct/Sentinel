'use strict';
/**
 * Operator commands. There are deliberately no admin HTTP endpoints - an admin
 * API is one more thing to break into. Run these on the server itself.
 *
 *   node scripts/admin.js set-plan <email> <free|pro|max>
 *   node scripts/admin.js unlock <email>
 *   node scripts/admin.js revoke-sessions <email>
 *   node scripts/admin.js refresh-feeds
 *   node scripts/admin.js block <domain> <scam|virus|malware> [category]
 *   node scripts/admin.js add-hash <sha256> <virus|malware> <name>
 *   node scripts/admin.js audit <email> [limit]
 */
const { db, now } = require('../server/lib/db');

const [, , cmd, ...args] = process.argv;

function userByEmail(email) {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!u) { console.error(`No user with email ${email}`); process.exit(1); }
  return u;
}

(async () => {
  switch (cmd) {
    case 'set-plan': {
      const [email, plan] = args;
      if (!['free', 'pro', 'max'].includes(plan)) throw new Error('Plan must be free, pro or max');
      const u = userByEmail(email);
      db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, u.id);
      console.log(`${u.email} is now on ${plan}`);
      break;
    }
    case 'unlock': {
      const u = userByEmail(args[0]);
      db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(u.id);
      console.log(`Unlocked ${u.email}`);
      break;
    }
    case 'revoke-sessions': {
      const u = userByEmail(args[0]);
      const n = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id).changes;
      console.log(`Revoked ${n} session(s) for ${u.email}`);
      break;
    }
    case 'refresh-feeds': {
      require('../server/seed').run();
      const results = await require('../server/lib/scan/feeds').refreshAll({ log: true });
      console.log(results.every((r) => r.ok) ? 'All feeds refreshed' : 'Some feeds failed (see above)');
      break;
    }
    case 'block': {
      const [domain, threat = 'scam', category = threat] = args;
      if (!['scam', 'virus', 'malware'].includes(threat)) throw new Error('Threat must be scam, virus or malware');
      db.prepare(`INSERT INTO blocklist (host, category, source, note, threat, added_at) VALUES (?, ?, 'sentinel', 'Added by operator', ?, ?)
                  ON CONFLICT(host) DO UPDATE SET threat = excluded.threat, category = excluded.category`).run(domain.toLowerCase(), category, threat, now());
      console.log(`Blocked ${domain} as ${threat}`);
      break;
    }
    case 'add-hash': {
      const [sha, threat, ...name] = args;
      if (!/^[a-f0-9]{64}$/i.test(sha || '')) throw new Error('Provide a SHA-256 hex digest');
      db.prepare('INSERT OR REPLACE INTO file_hashes (sha256, threat, name, source, added_at) VALUES (?, ?, ?, ?, ?)').run(sha.toLowerCase(), threat, name.join(' ') || null, 'operator', now());
      console.log('Hash added');
      break;
    }
    case 'audit': {
      const u = userByEmail(args[0]);
      const rows = db.prepare('SELECT event, ip, detail, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(u.id, Number(args[1] || 30));
      for (const r of rows) console.log(new Date(r.created_at).toISOString(), r.event.padEnd(18), r.ip || '', r.detail || '');
      break;
    }
    default:
      console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(2, 13).join('\n'));
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
