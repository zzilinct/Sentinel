'use strict';
/**
 * Email accuracy check.
 *
 *   node scripts/evaluate-emails.js
 *
 * Scans every email in evaluate-emails.json twice: as the full message, and as
 * the inbox preview the desktop app sends (sender name only, subject, a line of
 * text without links). Reports false alarms on real mail and missed scams.
 * Research is off, so nothing is fetched. Uses a throwaway database.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbFile = path.join(os.tmpdir(), `sentinel-email-eval-${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = dbFile;
process.env.FEED_REFRESH_HOURS = '0';

const CORPUS = require('./evaluate-emails.json');

// An inbox row shows only the display name, never the address.
const displayName = (from) => {
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(from);
  return m ? m[1] : from;
};
const previewBody = (body) => body.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);

const failing = (v) => v.checklist.items.filter((c) => c.status === 'fail' || c.status === 'warn')
  .map((c) => `      ${c.id} ${c.status} ${c.points}: ${c.detail}`).join('\n');

async function main() {
  require('../server/seed').run({ quiet: true });
  const engine = require('../server/lib/scan/engine');
  const base = { research: false, mode: 'live', detail: 'compact' };

  const modes = {
    full: (m) => engine.scanEmail({ from: m.from, replyTo: m.replyTo, subject: m.subject, body: m.body, attachments: m.attachments }, base),
    preview: (m) => engine.scanEmail({ from: displayName(m.from), subject: m.subject, body: previewBody(m.body) }, { ...base, preview: true })
  };

  for (const [mode, scan] of Object.entries(modes)) {
    const alarms = [];
    for (const m of CORPUS.legit) {
      const v = await scan(m);
      if (v.overall && v.overall.badge) alarms.push({ m, v });
    }
    const misses = [];
    for (const m of CORPUS.scam) {
      const v = await scan(m);
      if (!(v.overall && v.overall.badge)) misses.push({ m, v });
    }

    console.log(`\n=== ${mode} ===`);
    console.log(`Legit left alone: ${CORPUS.legit.length - alarms.length}/${CORPUS.legit.length}`);
    for (const { m, v } of alarms) console.log(`  FALSE ALARM ${m.name} [${v.overall.badge}]\n${failing(v)}`);
    console.log(`Scams flagged: ${CORPUS.scam.length - misses.length}/${CORPUS.scam.length}`);
    for (const { m, v } of misses) {
      const s = v.threats.scam;
      console.log(`  MISS ${m.name} (scam score ${s ? s.score : '-'}, ${v.overall.level})${failing(v) ? '\n' + failing(v) : ''}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); })
  .finally(() => {
    try { require('../server/db').close(); } catch { /* the db module may not expose close */ }
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
    process.exit(0);
  });
