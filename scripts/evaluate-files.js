'use strict';
/**
 * False alarms on real software: every file under the given folders goes through the same scan and verdict the
 * desktop app gives a new download (desktop/src/downloads.js), and every file it would mark is listed with why.
 *
 *   node scripts/evaluate-files.js [--max 4000] <folder> [<folder> ...]
 *
 * Meant for a GitHub Windows machine (Windows itself, Program Files, the tools installed there): legitimate files
 * only, so each mark is a false alarm. Nothing is run, moved or sent anywhere.
 */
const fs = require('fs');
const path = require('path');

// The desktop app scans with its own copy of the scanner: refreshed from the server's, so the current one is measured.
const shared = path.join(__dirname, '..', 'desktop', 'shared');
fs.mkdirSync(shared, { recursive: true });
for (const file of ['filescan.js', 'lists.js', 'brands.js']) {
  const to = path.join(shared, file);
  fs.copyFileSync(path.join(__dirname, '..', 'server', 'lib', 'scan', file), to);
}
const { scanFile, MAX_FILE_BYTES } = require('../desktop/shared/filescan');
const { summarize } = require('../desktop/src/downloads');

const args = process.argv.slice(2);
const maxAt = args.indexOf('--max');
const MAX = maxAt >= 0 ? Number(args.splice(maxAt, 2)[1]) : 4000;
const folders = args.length ? args : [process.cwd()];
const KINDS = /\.(exe|dll|sys|msi|scr|com|ps1|bat|cmd|vbs|js|jar|lnk|zip|7z|rar|docx?|xlsx?|pptx?|docm|xlsm|pdf|html?|svg|iso|img)$/i;

function* walk(dir, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 8 && !e.isSymbolicLink()) yield* walk(full, depth + 1); } else if (e.isFile() && KINDS.test(e.name)) yield full;
  }
}

let scanned = 0;
const marked = [];
const byType = {};
const started = Date.now();
// Each folder gets its share, so Windows' own thousands of libraries do not crowd out the programs people install.
const share = Math.ceil(MAX / folders.length);
for (const folder of folders) {
  let here = 0;
  for (const file of walk(folder)) {
    if (here >= share) break;
    let buf;
    try {
      const st = fs.statSync(file);
      if (!st.size || st.size > MAX_FILE_BYTES) continue;
      buf = fs.readFileSync(file);
    } catch { continue; }
    scanned++;
    here++;
    const ext = path.extname(file).toLowerCase();
    byType[ext] = (byType[ext] || 0) + 1;
    let report;
    try { report = scanFile(buf, path.basename(file), { lookupHash: () => null }); } catch (err) { marked.push({ file, badge: 'error', reason: err.message }); continue; }
    const v = summarize(report, null);
    if (v.badge) {
      const why = report.checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => `${c.id} ${c.points}: ${c.detail}`).join(' | ');
      marked.push({ file, badge: v.badge, why });
    }
  }
}

console.log(`Real files scanned: ${scanned} in ${Math.round((Date.now() - started) / 1000)} s (${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')})`);
const count = (b) => marked.filter((m) => m.badge === b).length;
console.log(`Left alone: ${scanned - marked.length}/${scanned}   red ${count('red')}, orange ${count('orange')}, yellow ${count('yellow')}${count('error') ? `, errors ${count('error')}` : ''}`);
for (const m of marked.slice(0, 80)) console.log(`  ${m.badge.padEnd(6)} ${m.file}\n         ${m.why || m.reason}`);
