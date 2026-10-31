'use strict';
/**
 * Download protection (Pro and Max).
 *
 * Watches the Downloads folder. When a new file finishes downloading, Sentinel
 * scans it on this computer with the same static analyzer the server uses, and
 * asks the Sentinel service whether its hash is a known threat. Files never
 * leave the machine - only the SHA-256 is sent.
 *
 * Nothing is moved or deleted automatically: the user decides, from the app,
 * whether to quarantine a flagged file.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { scanPath, END_BYTES } = require('../shared/filescan');
const source = require('./source');

const PARTIAL = /\.(crdownload|part|partial|download|tmp|opdownload)$/i;
const SIGNABLE = /\.(exe|msi|msix|msixbundle|appx|appxbundle)$/i;
const SETTLE_MS = 2500;

let opts = null;
let watcher = null;
let state = { active: false, reason: 'Starting' };
const timers = new Map();
const recent = [];           // newest first, max 50
const seenHashes = new Map();

function status() { return { ...state, folder: opts ? opts.folder : null }; }

function init(options) {
  opts = options;
  restart();
}

/** The app's own caller: it survives a refused token by falling back to this computer's account. */
const api = (pathname, body) => opts.api(pathname, body);

let generation = 0;
async function restart() {
  stop(null, true);
  const mine = ++generation;   // overlapping restarts: only the newest may open a watcher
  if (!opts.enabled()) return setState(false, 'Download protection: off');
  if (!opts.getToken()) return setState(false, 'Sign in to turn on download protection');
  try {
    const me = await api('/api/v1/auth/me');
    if (!me.plan.features.liveScanning) return setState(false, 'Download protection is part of Pro, Max and Ultimate');
  } catch (err) {
    if (err.status === 401) return setState(false, 'Sign in to turn on download protection');
    // "Will retry" has to be true: a scanner that is still starting answers a minute later.
    retryTimer = setTimeout(() => restart(), 30000);
    return setState(false, 'Sentinel is offline. Trying again shortly.');
  }
  if (mine !== generation) return;
  try {
    watcher = fs.watch(opts.folder, { persistent: true }, (event, filename) => filename && schedule(filename));
    watcher.on('error', () => setState(false, 'Cannot watch the Downloads folder'));
    setState(true, null);
  } catch {
    setState(false, 'Cannot watch the Downloads folder');
  }
}

let retryTimer = null;
function stop(reason, silent) {
  clearTimeout(retryTimer);
  if (watcher) { watcher.close(); watcher = null; }
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  if (!silent) setState(false, reason ? `Download protection: ${reason.toLowerCase()}` : 'Download protection: off');
}

function setState(active, reason) {
  state = { active, reason };
  if (opts && opts.onChange) opts.onChange();
}

/** Wait until the file stops growing before scanning it. */
function schedule(filename) {
  if (PARTIAL.test(filename) || filename.startsWith('.') || filename.startsWith('~$')) return;
  const full = path.join(opts.folder, filename);
  clearTimeout(timers.get(full));
  timers.set(full, setTimeout(() => settle(full, -1), SETTLE_MS));
}

function settle(full, lastSize) {
  timers.delete(full);
  let stat;
  try { stat = fs.statSync(full); } catch { return; }
  if (!stat.isFile()) return;
  if (stat.size !== lastSize) {
    timers.set(full, setTimeout(() => settle(full, stat.size), SETTLE_MS));
    return;
  }
  // One file at a time: unpacking hundreds of files into Downloads must not start hundreds of scans at once.
  queue = queue.then(() => scan(full, stat)).catch(() => { /* file vanished or unreadable */ });
}
let queue = Promise.resolve();

/**
 * The file's analysis, on a worker thread. Falls back to this thread only if a worker cannot start (and says so in
 * the log): the check itself matters more than where it runs.
 */
let workerBroken = false;
function analyze(file, name, known) {
  if (!workerBroken) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(path.join(__dirname, 'filescan-worker.js'), { workerData: { file, name, known }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
      } catch (err) {
        workerBroken = true;
        log(`download scan worker could not start (${err.message}); scanning on the main thread`);
        resolve(analyze(file, name, known));
        return;
      }
      const timer = setTimeout(() => { worker.terminate(); reject(Object.assign(new Error('the scan took too long'), { timedOut: true })); }, 60000);
      worker.once('message', (m) => { clearTimeout(timer); worker.terminate(); if (m.error) reject(new Error(m.error)); else resolve(m.report); });
      worker.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }
  return Promise.resolve().then(() => scanPath(file, name, { lookupHash: () => known }));
}

function log(text) { if (opts && opts.log) opts.log(text); }

async function scan(full, stat) {
  const name = path.basename(full);
  if (stat.size === 0) return;
  const started = Date.now();

  // Hashed as a stream: the main thread never holds a whole download.
  const sha256 = await hashStream(full);
  if (seenHashes.get(sha256) === full) return;
  seenHashes.set(sha256, full);
  if (seenHashes.size > 2000) seenHashes.clear();

  const { known, offline } = await lookUp(sha256);
  let report = null;
  let failure = null;
  try { report = await analyze(full, name, known); } catch (err) { failure = err; log(`download scan of ${name} failed: ${err.message}`); }
  const threats = summarize(report, known, { failure, offline });
  // Sentinel read only the ends of this file. Windows reads all of it to check a signature, and a valid one outranks a
  // guess from those ends, as it does in Defense. It stays partly checked: Sentinel did not read the middle.
  if (threats.looked === 'part' && threats.badge !== 'red' && SIGNABLE.test(name) && opts.signedBy) {
    const publisher = await opts.signedBy(full).catch(() => null);
    if (publisher) Object.assign(threats, { badge: null, label: 'Partly checked', reason: `Signed by ${publisher}, and unchanged since. ${READ_ENDS}` });
  }
  const origin = await checkSource(full, name, report).catch(() => null);
  const rank = { yellow: 1, orange: 2, red: 3 };
  if (origin && (rank[origin.badge] || 0) > (rank[threats.badge] || 0)) Object.assign(threats, origin);
  log(`download scanned: ${name} (${Math.round(stat.size / 1024)} KB) - ${threats.label}${threats.reason ? ` (${threats.reason})` : ''}, ${Date.now() - started} ms`);
  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    name,
    path: full,
    size: stat.size,
    read: Math.min(1, END_BYTES * 2 / stat.size),   // of the file, when it was partly read
    sha256,
    scannedAt: Date.now(),
    ...threats
  };
  recent.unshift(item);
  if (recent.length > 50) recent.pop();
  if (opts.onChecked) opts.onChecked(item);
  if (item.badge) opts.onThreat(item);
}

/**
 * Where the file came from (its Zone.Identifier stream, read on this computer): a program named for Zoom or Discord
 * that came from another site is a likely fake, and a file from a site Sentinel flags is flagged with it. The source's
 * address is never logged; only the fast check on this computer sees it, without opening it.
 */
async function checkSource(full, name, report) {
  if (!source.RISKY.test(name)) return null;
  const zone = source.readZone(full);
  if (!zone) return null;
  const zipHasProgram = Boolean(report && report.checks.some((c) => c.id === 'F11' && c.status === 'fail'));
  const claim = source.judge(name, zone, { zipHasProgram });
  let flag = null;
  let said = 'source checked';
  if (claim && claim.genuine) said = `from ${claim.product}'s own site`;
  else if (claim) {
    // A genuine installer someone else hosts (a company's software portal) still carries its maker's signature.
    const publisher = /\.zip$/i.test(name) || !opts.signedBy ? null : await opts.signedBy(full).catch(() => null);
    if (publisher && claim.signer.test(publisher)) said = `signed by ${publisher}`;
    else { flag = { badge: 'orange', label: 'Possible fake installer', reason: claim.reason }; said = `not from ${claim.product}'s own site`; }
  }
  const from = source.web(zone.hostUrl);
  if (from && !(claim && claim.genuine)) {
    const url = from.origin + from.pathname;
    try {
      const { byUrl } = await api('/api/v1/live/batch', { urls: [url], private: true, mode: 'fast', purpose: 'download' });
      const v = byUrl && byUrl[url];
      const badge = v && v.overall ? v.overall.badge : null;
      if (badge !== 'red' && badge !== 'orange') said += `, its site is not flagged (${badge || 'clear'})`;
      else {
        said += `, and its site is flagged ${badge}`;
        const why = (v.reasons && v.reasons[0] && v.reasons[0].text) || v.overall.label;
        if (flag) flag.badge = badge;
        else flag = { badge, label: 'From a dangerous site', reason: `This came from ${from.hostname}, which Sentinel flags: ${why}. Do not open it.` };
      }
    } catch (err) { said += `, its site could not be checked (${(err && (err.status || err.code)) || 'offline'})`; }   // the name check stands
  }
  log(`download source: ${name} ${said}`);
  return flag;
}

/** The list of known threats, asked by hash. offline: it could not be reached; the analysis on this computer still runs. */
async function lookUp(sha256) {
  try {
    const r = await api('/api/v1/live/file-hash', { sha256 });
    return { known: r.known ? { threat: r.threat, name: r.name || 'Known malicious file', source: 'sentinel' } : null, offline: false };
  } catch { return { known: null, offline: true }; }
}

function hashStream(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

const READ_ENDS = 'Sentinel read the start and end of this file, not the middle.';
const NOT_LISTED = 'Sentinel read all of it, but could not reach its list of known threats.';

/**
 * Same scoring rules as the server: evidence -> red, 55+ orange, 30+ yellow; no record -> 15% lower.
 * looked says how much stands behind the answer, whatever the answer: 'all' (every byte read and the list of known
 * threats asked), 'part' or 'none'. Finding nothing is "No threats found" only with 'all'. A hash that is not on the
 * list is not looking: on its own it leaves 'none'.
 */
function summarize(report, known, { failure = null, offline = false } = {}) {
  const totals = { virus: 0, malware: 0 };
  const evidence = { virus: null, malware: null };
  let reason = '';
  if (report) {
    for (const c of report.checks) if (c.status !== 'skip' && totals[c.threat] !== undefined) totals[c.threat] += c.points;
    Object.assign(evidence, report.evidence);
    const top = report.checks.filter((c) => c.status === 'fail' || c.status === 'warn').sort((a, b) => b.points - a.points)[0];
    reason = top ? top.detail : '';
  }
  if (known) { evidence[known.threat] = known.name; reason = reason || known.name; }

  const out = {};
  let worst = null;
  const rank = { yellow: 1, orange: 2, red: 3 };
  for (const t of ['virus', 'malware']) {
    let score = totals[t] * (evidence.virus || evidence.malware ? 1 : 0.85);
    score = Math.max(0, Math.min(100, Math.round(score)));
    const badge = evidence[t] ? 'red' : score >= 55 ? 'orange' : score >= 30 ? 'yellow' : null;
    out[t] = { score, badge };
    if (badge && (!worst || rank[badge] > rank[out[worst].badge])) worst = t;
  }
  const labels = { virus: { yellow: 'Possible virus', orange: 'Likely virus', red: 'Virus detected' }, malware: { yellow: 'Possible malware', orange: 'Likely malware', red: 'Malware detected' } };
  const looked = !report ? 'none' : report.part || offline ? 'part' : 'all';
  let label = 'No threats found';
  if (worst) label = labels[worst][out[worst].badge];
  else if (looked === 'none') {
    label = 'Not checked';
    reason = failure && failure.timedOut ? 'The check took too long and was stopped.' : 'Sentinel could not open this file. It may have been moved, or another program may be using it.';
  } else if (looked === 'part') {
    label = 'Partly checked';
    reason = report.part ? READ_ENDS : NOT_LISTED;
  } else if (report.size === 0) {
    label = 'Empty file';
    reason = 'There is nothing in this file to check.';
  }
  return { virus: out.virus, malware: out.malware, badge: worst ? out[worst].badge : null, label, reason, looked };
}

/** Move a file, also across drives: a rename cannot leave its drive (EXDEV), so the file is copied and then removed. */
function moveFile(from, to) {
  try { fs.renameSync(from, to); } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(from, to);
    try { fs.unlinkSync(from); } catch (e) { try { fs.unlinkSync(to); } catch { /* keep going */ } throw e; }
  }
}

async function quarantine(id) {
  const item = recent.find((r) => r.id === id);
  if (!item) throw new Error('That file is no longer in the recent list');
  if (!item.badge) throw new Error('Only flagged files can be quarantined');
  // Only the file that was checked: a clean one downloaded to the same name since is never moved.
  const now = await hashStream(item.path).catch(() => null);
  if (!now || now !== item.sha256) throw new Error('That file has changed or gone since Sentinel checked it, so it was left alone.');
  fs.mkdirSync(opts.quarantineDir, { recursive: true });
  const target = path.join(opts.quarantineDir, `${Date.now()}-${path.basename(item.path)}.quarantined`);
  moveFile(item.path, target);
  item.quarantined = target;
  return { ok: true, movedTo: target };
}

module.exports = { init, restart, stop, status, recent: () => recent.map(({ path: p, ...rest }) => ({ ...rest, folder: path.dirname(p) })), quarantine, summarize, analyze, lookUp, hashStream, _test: { scan, checkSource, configure: (o) => { opts = o; } } };
