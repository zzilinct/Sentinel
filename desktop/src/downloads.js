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
const { scanFile, MAX_FILE_BYTES } = require('../shared/filescan');

const PARTIAL = /\.(crdownload|part|partial|download|tmp|opdownload)$/i;
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
    if (!me.plan.features.liveScanning) return setState(false, 'Download protection needs Pro or Max');
  } catch (err) {
    if (err.status === 401) return setState(false, 'Sign in to turn on download protection');
    // "Will retry" has to be true: a scanner that is still starting answers a minute later.
    retryTimer = setTimeout(() => restart(), 30000);
    return setState(false, 'Sentinel is offline - will retry');
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
  scan(full, stat).catch(() => { /* file vanished or unreadable */ });
}

async function scan(full, stat) {
  const name = path.basename(full);
  if (stat.size === 0) return;

  let buf;
  if (stat.size > MAX_FILE_BYTES) {
    // Large files: hash only.
    buf = null;
  } else {
    buf = fs.readFileSync(full);
  }
  const sha256 = buf ? crypto.createHash('sha256').update(buf).digest('hex') : await hashStream(full);
  if (seenHashes.get(sha256) === full) return;
  seenHashes.set(sha256, full);
  if (seenHashes.size > 2000) seenHashes.clear();

  let known = null;
  try {
    const r = await api('/api/v1/live/file-hash', { sha256 });
    if (r.known) known = { threat: r.threat, name: r.name || 'Known malicious file', source: 'sentinel' };
  } catch { /* offline: local analysis still runs */ }

  const report = buf ? scanFile(buf, name, { lookupHash: () => known }) : null;
  const threats = summarize(report, known);
  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    name,
    path: full,
    size: stat.size,
    sha256,
    scannedAt: Date.now(),
    ...threats
  };
  recent.unshift(item);
  if (recent.length > 50) recent.pop();
  if (item.badge) opts.onThreat(item);
}

function hashStream(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Same scoring rules as the server: evidence -> red, 55+ orange, 30+ yellow; no record -> 15% lower. */
function summarize(report, known) {
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
  return {
    virus: out.virus,
    malware: out.malware,
    badge: worst ? out[worst].badge : null,
    label: worst ? labels[worst][out[worst].badge] : 'No threats found',
    reason
  };
}

function quarantine(id) {
  const item = recent.find((r) => r.id === id);
  if (!item) throw new Error('That file is no longer in the recent list');
  if (!item.badge) throw new Error('Only flagged files can be quarantined');
  fs.mkdirSync(opts.quarantineDir, { recursive: true });
  const target = path.join(opts.quarantineDir, `${Date.now()}-${path.basename(item.path)}.quarantined`);
  fs.renameSync(item.path, target);
  item.quarantined = target;
  return { ok: true, movedTo: target };
}

module.exports = { init, restart, stop, status, recent: () => recent.map(({ path: p, ...rest }) => ({ ...rest, folder: path.dirname(p) })), quarantine, summarize };
