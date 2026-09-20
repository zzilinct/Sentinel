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
const { execFile, spawn } = require('child_process');
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

  // The on-device scan decides first: it needs nothing but the file. The
  // known-hash lookup is a second opinion with a short leash, because on a
  // fresh install the server is busy loading its threat lists.
  let known = null;
  let report = buf ? scanFile(buf, name, { lookupHash: () => null }) : null;
  let worst = summarize(report, null);
  if (!worst.badge) {
    try {
      const r = await Promise.race([
        opts.api('/api/v1/live/file-hash', { sha256 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 6000))
      ]);
      if (r && r.known) known = { threat: r.threat, name: r.name || 'Known malicious file', source: 'sentinel' };
    } catch { /* offline or busy: the local verdict stands */ }
    if (known) { report = buf ? scanFile(buf, name, { lookupHash: () => known }) : null; worst = summarize(report, known); }
  }
  const item = { path: full, name, size: stat.size, sha256, how, at: Date.now(), badge: worst.badge, label: worst.label, threat: worst.threat, reason: worst.reason };
  if (!worst.badge) { cleanCount++; return item; }

  // What the on-device scan finds in a file is a guess from its contents. A guess is
  // never enough against a program whose publisher Windows can vouch for: Discord's
  // updater contains "DownloadFile", because downloading files is its job. Only a
  // known malicious file (a hash on a list) outranks a valid signature.
  if (!known) {
    const publisher = await signer(full);
    if (publisher) {
      cleanCount++;
      record({ kind: 'clean', path: full, name, how: `signed by ${publisher}` });
      return { ...item, badge: null, label: `Signed by ${publisher}`, threat: null, reason: null, trusted: true };
    }
  }
  // "Possible" means a few warning signs and nothing more. It is written down, and
  // that is all: no notification, nothing ended, nothing removed.
  if (worst.badge === 'yellow') {
    record({ kind: 'noted', ...item, actions: [{ did: 'noted', detail: 'A few warning signs; nothing was touched' }] });
    return item;
  }

  const entryId = record({ kind: 'threat', ...item, actions: [{ did: 'detected', detail: 'responding' }] });
  item.entryId = entryId;
  let actions;
  try { actions = await respond(item); } catch (err) { actions = [{ did: 'response failed', detail: String(err && err.message || err) }]; }
  amend(entryId, { actions, quarantined: item.quarantined || null });
  if (opts.onThreat) opts.onThreat({ ...item, actions });
  return item;
}

/* ----------------------------------------------------------- response */

/**
 * Response order is "stop the harm first": end the process and quarantine the
 * file within a second or two, then clean up what would have relaunched it.
 * PowerShell is slow to start, so there is one PowerShell process for the
 * whole response, and its output is read as it arrives: the moment it reports
 * that the processes are gone, the file is moved, while the same script carries
 * on with shortcuts and scheduled tasks.
 */
async function respond(item) {
  const actions = [];
  const wantQuarantine = item.badge === 'red' || item.badge === 'orange';
  const startup = folders().find((f) => f.label === 'Startup');
  const base = path.basename(item.path).replace(/\.[^.]+$/, '');
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$target = ${psq(item.path)}
$moved = ${psq('__MOVED__')}
Get-Process | Where-Object { $_.Path -and (($_.Path -eq $target) -or ($moved -and $_.Path -eq $moved)) } | ForEach-Object { $id = $_.Id; Stop-Process -Id $id -Force; "KILLED $id" }
'STOPPED'
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

  let quarantined = false;
  const quarantine = async () => {
    if (quarantined || !wantQuarantine) return;
    quarantined = true;
    let moved = null;
    let lastErr = null;
    // A just-ended process can hold its file for a moment, so try a few times.
    for (let attempt = 0; attempt < 8 && !moved; attempt++) {
      try {
        fs.mkdirSync(opts.quarantineDir, { recursive: true });
        const target = path.join(opts.quarantineDir, `${Date.now()}-${item.name}.quarantined`);
        fs.renameSync(item.path, target);
        fs.writeFileSync(`${target}.json`, JSON.stringify({ from: item.path, sha256: item.sha256, label: item.label, at: Date.now() }, null, 2));
        moved = target;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (moved) { item.quarantined = moved; actions.push({ did: 'quarantined', detail: moved }); }
    else actions.push({ did: 'could not quarantine', detail: lastErr ? lastErr.message : 'unknown' });
    if (item.entryId) amend(item.entryId, { actions: [...actions], quarantined: item.quarantined || null });
  };

  // If nothing runs from the file, it can be moved right now, before PowerShell has even started.
  if (wantQuarantine) {
    try {
      fs.mkdirSync(opts.quarantineDir, { recursive: true });
      const target = path.join(opts.quarantineDir, `${Date.now()}-${item.name}.quarantined`);
      fs.renameSync(item.path, target);
      fs.writeFileSync(`${target}.json`, JSON.stringify({ from: item.path, sha256: item.sha256, label: item.label, at: Date.now() }, null, 2));
      item.quarantined = target;
      quarantined = true;
      actions.push({ did: 'quarantined', detail: target });
      if (item.entryId) amend(item.entryId, { actions: [...actions], quarantined: target });
    } catch { /* in use: PowerShell ends the process first */ }
  }

  // Run keys: reg.exe answers in milliseconds.
  actions.push(...await removeRunKeys(item.path));
  if (item.entryId) amend(item.entryId, { actions: [...actions] });

  // A running program can be renamed on Windows, so the early move may have
  // succeeded while it still runs: end it by either path.
  const finalScript = script.replace("'__MOVED__'", psq(item.quarantined || ''));

  let finished = false;
  await new Promise((resolve) => {
    let child;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(finalScript, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { resolve(); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 180000);
    let buf = '';
    const pending = [];
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('KILLED ')) actions.push({ did: 'ended process', detail: `PID ${line.slice(7)}` });
        else if (line === 'STOPPED') pending.push(quarantine());
        else if (line.startsWith('LNK ')) actions.push({ did: 'removed Startup shortcut', detail: line.slice(4) });
        else if (line.startsWith('TASKFAIL ')) actions.push({ did: 'could not remove scheduled task (needs administrator)', detail: line.slice(9) });
        else if (line.startsWith('TASK ')) actions.push({ did: 'removed scheduled task', detail: line.slice(5) });
        else if (line === 'DONE') finished = true;
      }
    });
    const end = () => { clearTimeout(timer); Promise.all(pending).then(resolve, resolve); };
    child.on('exit', end);
    child.on('error', end);
  });
  await quarantine();
  if (!finished) actions.push({ did: 'cleanup did not finish', detail: 'PowerShell did not answer in time' });
  if (!wantQuarantine) actions.push({ did: 'left in place', detail: 'Only a few warning signs; nothing was moved' });
  return actions;
}

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

const signatures = new Map();
let signer = (full) => signedBy(full);   // replaceable in tests, which have no signed malware-shaped file to hand
/** The publisher of a program with a valid Authenticode signature, or null. */
async function signedBy(full) {
  if (process.platform !== 'win32') return null;
  let key = full;
  try { const st = fs.statSync(full); key = `${full}|${st.size}|${st.mtimeMs}`; } catch { return null; }
  if (signatures.has(key)) return signatures.get(key);
  const out = await ps(`$s = Get-AuthenticodeSignature -LiteralPath ${psq(full)}; if ($s.Status -eq 'Valid') { $s.SignerCertificate.GetNameInfo('SimpleName', $false) }`, 30000);
  const publisher = String(out || '').split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean)[0] || null;
  if (signatures.size > 500) signatures.clear();
  signatures.set(key, publisher);
  return publisher;
}

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
          const action = { did: ok ? 'removed startup entry' : `could not remove startup entry${hive === 'HKLM' ? ' (needs administrator)' : ''}`, detail: `${hive}\\...\\${key.split('\\').pop()}\\${m[1]}` };
          // Everything needed to put it back exactly as it was.
          if (ok) action.undo = { hive, key, name: m[1], data: m[2].trim(), type: /REG_EXPAND_SZ/.test(line) ? 'REG_EXPAND_SZ' : 'REG_SZ' };
          actions.push(action);
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

/** Put a quarantined file back where it was, and the startup entries that were removed with it. */
async function restore(id) {
  const entry = ledger.find((e) => e.id === id && !e.restored && (e.quarantined || (e.actions || []).some((a) => a.undo)));
  if (!entry) throw new Error('Nothing to restore');
  if (entry.quarantined) {
    fs.mkdirSync(path.dirname(entry.path), { recursive: true });
    fs.renameSync(entry.quarantined, entry.path);
    try { fs.unlinkSync(`${entry.quarantined}.json`); } catch { /* fine */ }
  }
  for (const a of entry.actions || []) {
    if (a.undo) await run('reg', ['add', `${a.undo.hive}\\${a.undo.key}`, '/v', a.undo.name, '/t', a.undo.type, '/d', a.undo.data, '/f']);
  }
  // The person has vouched for this file: do not judge it again.
  if (entry.sha256) seen.set(entry.sha256, entry.path);
  entry.restored = Date.now();
  record({ kind: 'restored', path: entry.path, name: entry.name });
  return { ok: true };
}

module.exports = {
  init, restart, stop, status, inspect, restore, ledger: () => ledger.slice(0, 50),
  // For tests: set the options without starting any watcher, and stand in for the signature check.
  _test: { removeRunKeys, signedBy, configure: (options) => { opts = options; ledger = []; }, setSigner: (fn) => { signer = fn || ((full) => signedBy(full)); } }
};
