'use strict';
/**
 * Defense: what happens after something bad lands on the computer.
 *
 * Download protection tells you a file is dangerous. Defense goes further,
 * for the places malware actually arrives and hides:
 *
 *   arrival     Downloads, Desktop, the user's Temp folder, and the Startup
 *               folder are watched. A new program-like file is scanned the
 *               moment it stops changing.
 *   persistence Run keys (HKCU and HKLM), the Startup folder and scheduled
 *               tasks are checked on a timer. A new entry that launches a
 *               file is scanned; an entry that launches a flagged file is
 *               removed.
 *   response    A flagged file is quarantined; any process running from it
 *               is ended first; every persistence entry pointing at it is
 *               deleted. Each step is written to a ledger so it can be shown,
 *               and quarantine is a move, never a delete: the file can be
 *               put back.
 *
 * Limits, said plainly: this runs as an ordinary user program. It has no
 * kernel driver, so it cannot see everything a rootkit hides, and it does not
 * replace the system's own antivirus, which keeps running alongside it.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { scanFile, MAX_FILE_BYTES } = require('../shared/filescan');
const { summarize } = require('./downloads');

const PROGRAM = /\.(exe|msi|msix|scr|com|pif|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|jar|dll|cpl|lnk|reg)$/i;
const PARTIAL = /\.(crdownload|part|partial|download|tmp|opdownload)$/i;
const SETTLE_MS = 2000;
const PERSIST_EVERY_MS = 45 * 1000;
const SWEEP_EVERY_MS = 8 * 1000;

let opts = null;
let watchers = [];
let persistTimer = null;
let sweepTimer = null;
let state = { active: false, reason: 'Starting', supported: process.platform === 'win32' };
const timers = new Map();
const seen = new Map();          // sha256 -> path
const blockedSeen = new Set();   // files the system antivirus would not let us open
let ledger = [];                 // newest first, persisted
let cleanCount = 0;              // files scanned and found clean since start

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout))));
}
function ps(script, timeout = 20000) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], timeout);
}

function status() { return { ...state, watched: folders().map((f) => f.label), cleanCount }; }
function setState(active, reason) { state = { ...state, active, reason }; if (opts && opts.onChange) opts.onChange(); }

function ledgerPath() { return path.join(opts.dataDir, 'defense.json'); }
function loadLedger() { try { ledger = JSON.parse(fs.readFileSync(ledgerPath(), 'utf8')); } catch { ledger = []; } }
function persist() {
  try { fs.mkdirSync(opts.dataDir, { recursive: true }); fs.writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2)); } catch { /* best effort */ }
  if (opts.onChange) opts.onChange();
}
function record(entry) {
  const id = crypto.randomBytes(6).toString('hex');
  ledger.unshift({ id, at: Date.now(), ...entry });
  ledger = ledger.slice(0, 200);
  persist();
  return id;
}
function amend(id, patch) {
  const entry = ledger.find((e) => e.id === id);
  if (entry) Object.assign(entry, patch);
  persist();
}

function folders() {
  const home = os.homedir();
  const list = [
    { label: 'Downloads', dir: opts.downloads },
    { label: 'Desktop', dir: path.join(home, 'Desktop') },
    { label: 'Temp', dir: os.tmpdir() },
    { label: 'Startup', dir: path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') }
  ];
  return list.filter((f) => f.dir && fs.existsSync(f.dir));
}

function init(options) {
  opts = options;
  loadLedger();
  restart();
}

async function restart() {
  stop(null, true);
  if (!state.supported) return setState(false, 'Defense is available on Windows');
  if (!opts.enabled()) return setState(false, 'Defense: off');
  for (const f of folders()) {
    try {
      const w = fs.watch(f.dir, { persistent: true }, (event, filename) => filename && schedule(path.join(f.dir, filename)));
      w.on('error', () => {});
      watchers.push(w);
    } catch { /* a folder we cannot watch */ }
  }
  persistTimer = setInterval(() => checkPersistence().catch(() => {}), PERSIST_EVERY_MS);
  sweepTimer = setInterval(sweep, SWEEP_EVERY_MS);
  checkPersistence().catch(() => {});
  setState(true, null);
}

/** Belt and braces: look for program files that appeared recently, in case a watch event was missed. */
const sweptAt = new Map();
function sweep() {
  const cutoff = Date.now() - 2 * SWEEP_EVERY_MS;
  for (const f of folders()) {
    let names = [];
    try { names = fs.readdirSync(f.dir); } catch { continue; }
    for (const name of names) {
      if (!PROGRAM.test(name) || PARTIAL.test(name)) continue;
      const full = path.join(f.dir, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile() || st.mtimeMs < cutoff || sweptAt.get(full) === st.mtimeMs) continue;
      sweptAt.set(full, st.mtimeMs);
      if (sweptAt.size > 2000) sweptAt.clear();
      inspect(full, 'arrived').catch((err) => record({ kind: 'error', path: full, name, detail: String(err && err.message || err) }));
    }
  }
}

function stop(reason, silent) {
  for (const w of watchers) { try { w.close(); } catch { /* closed */ } }
  watchers = [];
  clearInterval(persistTimer);
  clearInterval(sweepTimer);
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  if (!silent) setState(false, reason ? `Defense: ${reason.toLowerCase()}` : 'Defense: off');
}

/* ------------------------------------------------------------ arrival */

function schedule(full) {
  const name = path.basename(full);
  if (PARTIAL.test(name) || !PROGRAM.test(name) || name.startsWith('~$')) return;
  clearTimeout(timers.get(full));
  timers.set(full, setTimeout(() => settle(full, -1), SETTLE_MS));
}

function settle(full, lastSize) {
  timers.delete(full);
  let stat;
  try { stat = fs.statSync(full); } catch { return; }
  if (!stat.isFile()) return;
  if (stat.size !== lastSize) { timers.set(full, setTimeout(() => settle(full, stat.size), SETTLE_MS)); return; }
  inspect(full, 'arrived').catch((err) => record({ kind: 'error', path: full, name: path.basename(full), detail: String(err && err.message || err) }));
}

async function hashFile(full) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(full).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Scan a file on this computer and respond if it is dangerous. */
async function inspect(full, how) {
  let stat;
  try { stat = fs.statSync(full); } catch { return null; }
  if (!stat.isFile() || stat.size === 0) return null;
  // Sentinel's own files and quarantine are never targets.
  if (full.startsWith(opts.quarantineDir) || (opts.selfDir && full.startsWith(opts.selfDir))) return null;

  const name = path.basename(full);
  let buf = null;
  let sha256;
  try {
    buf = stat.size <= MAX_FILE_BYTES ? fs.readFileSync(full) : null;
    sha256 = buf ? crypto.createHash('sha256').update(buf).digest('hex') : await hashFile(full);
  } catch (err) {
    // Windows answers "this file contains a virus" (error 225, which Node
    // reports as UNKNOWN) when the system antivirus has already condemned a
    // file. It cannot be read, but what would relaunch it can still be removed.
    if (err && err.code === 'UNKNOWN') {
      if (blockedSeen.has(full)) return null;
      blockedSeen.add(full);
      const actions = await removePersistence(full).catch(() => []);
      actions.unshift({ did: 'already blocked by the system antivirus', detail: 'Windows would not let the file be opened' });
      const item = { path: full, name, size: stat.size, how, at: Date.now(), badge: 'red', label: 'Blocked by the system antivirus', threat: 'virus', reason: 'Windows refused to open this file because its antivirus flagged it' };
      record({ kind: 'threat', ...item, actions });
      if (opts.onThreat) opts.onThreat({ ...item, actions });
      return item;
    }
    if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) return null;   // still being written, or not ours to read
    throw err;
  }
  if (seen.get(sha256) === full) return null;
  seen.set(sha256, full);
  if (seen.size > 3000) seen.clear();

  let known = null;
  try {
    const r = await opts.api('/api/v1/live/file-hash', { sha256 });
    if (r.known) known = { threat: r.threat, name: r.name || 'Known malicious file', source: 'sentinel' };
  } catch { /* offline: local analysis still runs */ }

  const report = buf ? scanFile(buf, name, { lookupHash: () => known }) : null;
  const worst = summarize(report, known);
  const item = { path: full, name, size: stat.size, sha256, how, at: Date.now(), badge: worst.badge, label: worst.label, threat: worst.threat, reason: worst.reason };
  if (!worst.badge) { cleanCount++; return item; }

  const entryId = record({ kind: 'threat', ...item, actions: [{ did: 'detected', detail: 'responding' }] });
  let actions;
  try { actions = await respond(item); } catch (err) { actions = [{ did: 'response failed', detail: String(err && err.message || err) }]; }
  amend(entryId, { actions, quarantined: item.quarantined || null });
  if (opts.onThreat) opts.onThreat({ ...item, actions });
  return item;
}

/* ----------------------------------------------------------- response */

async function respond(item) {
  const actions = [];

  // Run keys first: reg.exe answers in milliseconds.
  actions.push(...await removeRunKeys(item.path));

  // Everything that needs PowerShell happens in ONE process, because starting
  // PowerShell is the slow part: end whatever runs from the file, delete
  // Startup shortcuts that point at it, unregister scheduled tasks that launch it.
  const startup = folders().find((f) => f.label === 'Startup');
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$target = ${psq(item.path)}
Get-Process | Where-Object { $_.Path -eq $target } | ForEach-Object { $id = $_.Id; Stop-Process -Id $id -Force; "KILLED $id" }
$dir = ${psq(startup ? startup.dir : '')}
if ($dir -and (Test-Path $dir)) {
  $ws = New-Object -ComObject WScript.Shell
  Get-ChildItem -Path $dir -Filter *.lnk | ForEach-Object { if ($ws.CreateShortcut($_.FullName).TargetPath -eq $target) { Remove-Item $_.FullName -Force; "LNK $($_.Name)" } }
}
Get-ScheduledTask | ForEach-Object {
  $t = $_
  foreach ($a in $t.Actions) {
    if ($a.Execute -and (($a.Execute + ' ' + $a.Arguments).ToLower().Contains($target.ToLower()))) {
      Unregister-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName -Confirm:$false
      if (Get-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName) { "TASKFAIL $($t.TaskPath)$($t.TaskName)" } else { "TASK $($t.TaskPath)$($t.TaskName)" }
      break
    }
  }
}
'DONE'`;
  const out = await ps(script, 120000);
  for (const line of out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    if (line.startsWith('KILLED ')) actions.push({ did: 'ended process', detail: `PID ${line.slice(7)}` });
    else if (line.startsWith('LNK ')) actions.push({ did: 'removed Startup shortcut', detail: line.slice(4) });
    else if (line.startsWith('TASKFAIL ')) actions.push({ did: 'could not remove scheduled task (needs administrator)', detail: line.slice(9) });
    else if (line.startsWith('TASK ')) actions.push({ did: 'removed scheduled task', detail: line.slice(5) });
  }
  if (!out.includes('DONE')) actions.push({ did: 'cleanup did not finish', detail: 'PowerShell did not answer in time; the file is still quarantined below' });

  // Quarantine the file (a move, reversible). A just-ended process can hold
  // its file for a moment, so try a few times.
  if (item.badge === 'red' || item.badge === 'orange') {
    let moved = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 6 && !moved; attempt++) {
      try {
        fs.mkdirSync(opts.quarantineDir, { recursive: true });
        const target = path.join(opts.quarantineDir, `${Date.now()}-${item.name}.quarantined`);
        fs.renameSync(item.path, target);
        fs.writeFileSync(`${target}.json`, JSON.stringify({ from: item.path, sha256: item.sha256, label: item.label, at: Date.now() }, null, 2));
        moved = target;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    if (moved) { item.quarantined = moved; actions.push({ did: 'quarantined', detail: moved }); }
    else actions.push({ did: 'could not quarantine', detail: lastErr ? lastErr.message : 'unknown' });
  } else {
    actions.push({ did: 'left in place', detail: 'Only a few warning signs; nothing was moved' });
  }
  return actions;
}

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Delete Run / RunOnce values that launch `target`. */
async function removeRunKeys(target) {
  const actions = [];
  const lower = target.toLowerCase();
  for (const hive of ['HKCU', 'HKLM']) {
    for (const key of ['Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce']) {
      const out = await run('reg', ['query', `${hive}\\${key}`]);
      for (const line of out.split(/\r?\n/)) {
        const m = /^\s+(\S.*?)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line);
        if (m && m[2].toLowerCase().includes(lower)) {
          const ok = /success/i.test(await run('reg', ['delete', `${hive}\\${key}`, '/v', m[1], '/f']));
          actions.push({ did: ok ? 'removed startup entry' : `could not remove startup entry${hive === 'HKLM' ? ' (needs administrator)' : ''}`, detail: `${hive}\\...\\${key.split('\\').pop()}\\${m[1]}` });
        }
      }
    }
  }
  return actions;
}

/** Everything that would relaunch `target`, for a file that cannot be quarantined (already blocked). */
async function removePersistence(target) {
  const actions = await respond({ path: target, name: path.basename(target), badge: null });
  return actions.filter((a) => a.did !== 'left in place');
}

/* -------------------------------------------------------- persistence */

const knownEntries = new Set();
/** Scan the program behind every new startup entry. */
async function checkPersistence() {
  if (!state.active) return;
  const launches = [];
  for (const hive of ['HKCU', 'HKLM']) {
    const out = await run('reg', ['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`]);
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s+(\S.*?)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line);
      if (m) launches.push({ where: `${hive} Run\\${m[1]}`, cmd: m[2] });
    }
  }
  const startup = folders().find((f) => f.label === 'Startup');
  if (startup) for (const name of fs.readdirSync(startup.dir)) launches.push({ where: `Startup\\${name}`, cmd: path.join(startup.dir, name) });

  for (const l of launches) {
    const key = `${l.where}|${l.cmd}`;
    if (knownEntries.has(key)) continue;
    knownEntries.add(key);
    const exe = firstPath(l.cmd);
    if (exe && PROGRAM.test(exe) && !/\\windows\\|\\program files/i.test(exe)) await inspect(exe, `startup entry ${l.where}`).catch(() => {});
  }
}

function firstPath(cmd) {
  const m = /^"([^"]+)"|^(\S+\.(?:exe|bat|cmd|vbs|js|ps1|scr|lnk))/i.exec(String(cmd).trim());
  const p = m ? (m[1] || m[2]) : null;
  return p ? p.replace(/%([^%]+)%/g, (x, n) => process.env[n] || x) : null;
}

/** Put a quarantined file back where it was. */
function restore(id) {
  const entry = ledger.find((e) => e.id === id && e.quarantined);
  if (!entry) throw new Error('Nothing to restore');
  fs.mkdirSync(path.dirname(entry.path), { recursive: true });
  fs.renameSync(entry.quarantined, entry.path);
  try { fs.unlinkSync(`${entry.quarantined}.json`); } catch { /* fine */ }
  entry.restored = Date.now();
  record({ kind: 'restored', path: entry.path, name: entry.name });
  return { ok: true };
}

module.exports = { init, restart, stop, status, inspect, restore, ledger: () => ledger.slice(0, 50) };
