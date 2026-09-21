'use strict';
/**
 * Supervises the Sentinel server that ships inside the desktop app.
 *
 * The server is the same zero-dependency Node code the website runs on. Here
 * it listens on loopback only, keeps its database in the user's app-data
 * folder, and holds its session secret in the OS keychain. Nothing about it
 * depends on the machine it was built on.
 *
 * If the process dies it is restarted with backoff; if it keeps dying the
 * app gives up and shows the log rather than looping forever.
 */
const { app, utilityProcess } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Fixed by default so the browser companion can be granted this origin; the
// rest are fallbacks for the rare machine where the first is taken.
const PORTS = [47821, 47822, 47823, 47824, 47825];
const START_TIMEOUT_MS = 90000;   // a busy machine at login can be slow; an honest failure is reported sooner by the child itself
const START_TIMEOUT_MAX_MS = 20 * 60 * 1000;

/**
 * How long this start may take. A database that has to be migrated or tidied is
 * read end to end before the server listens: a 400 MB file on a slow disk took
 * minutes in the lab, the fixed 90 seconds cut it off half way, and every retry
 * was cut off the same way. So the limit grows with the size of what is on disk.
 */
function startTimeout() {
  let bytes = 0;
  for (const name of ['sentinel.db', 'sentinel.db-wal']) {
    try { bytes += fs.statSync(path.join(app.getPath('userData'), name)).size; } catch { /* not there yet */ }
  }
  const extra = Math.max(0, bytes / 1048576 - 20) * 3000;   // 3 s for every MB beyond the first 20
  return Math.min(START_TIMEOUT_MAX_MS, Math.round(START_TIMEOUT_MS + extra));
}
const MAX_RESTARTS = 3;        // within RESTART_WINDOW_MS before giving up
const RESTART_WINDOW_MS = 2 * 60 * 1000;
const LOG_MAX_BYTES = 2 * 1024 * 1024;

let child = null;
let port = null;
let stopping = false;
let restartTimes = [];
let log = null;
let hooks = { onDown: () => {} };

/** Where the bundled server, web files and brand.json live. */
function bundleDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'sentinel') : path.join(__dirname, '..', '..');
}

function logPath() {
  return path.join(app.getPath('userData'), 'logs', 'server.log');
}

function openLog() {
  const file = logPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, '.previous.log'));
  } catch { /* no log yet */ }
  if (log) log.end();
  log = fs.createWriteStream(file, { flags: 'a' });
  log.write(`\n[${new Date().toISOString()}] starting embedded server (app ${app.getVersion()})\n`);
}

/**
 * The session secret signs every login cookie. It lives in the OS keychain
 * through safeStorage; on systems without one it falls back to a file that
 * only this user can read.
 */
function sessionSecret(store) {
  const fallback = path.join(app.getPath('userData'), 'server-secret');
  let secret = store.getSecret('serverSecret');
  if (!secret) { try { secret = fs.readFileSync(fallback, 'utf8').trim(); } catch { /* none */ } }
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    try {
      store.setSecret('serverSecret', secret);
    } catch {
      fs.writeFileSync(fallback, secret, { mode: 0o600 });
    }
  }
  return secret;
}

/** A server from an earlier attempt must be gone before the next one touches the port and the database. */
function previousGone() {
  const old = child;
  if (!old) return Promise.resolve();
  return new Promise((resolve) => {
    const giveUp = setTimeout(resolve, 10000);
    old.once('exit', () => { clearTimeout(giveUp); resolve(); });
    try { old.kill(); } catch { clearTimeout(giveUp); resolve(); }
  });
}

async function spawn(store) {
  await previousGone();
  return spawnNow(store);
}

function spawnNow(store) {
  return new Promise((resolve, reject) => {
    const preferred = port ? [port, ...PORTS.filter((p) => p !== port)] : PORTS;
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      SENTINEL_BUNDLE: bundleDir(),
      SENTINEL_PORTS: preferred.join(','),
      DB_PATH: path.join(app.getPath('userData'), 'sentinel.db'),
      SESSION_SECRET: sessionSecret(store),
      // Pre-launch builds let every plan be exercised; billing arrives with the hosted service.
      BILLING_MODE: process.env.BILLING_MODE || 'demo',
      // Never fetch a suspicious page from the person's own computer.
      RESEARCH_ENABLED: '0',
      // Delicate live scanning may still ask the public registry how old a domain is, and whether it resolves.
      RESEARCH_LITE: '1',
      SENTINEL_DEVICE_ACCOUNTS: '1'
    };
    delete env.ELECTRON_RUN_AS_NODE;

    child = utilityProcess.fork(path.join(__dirname, 'server-host.js'), [], {
      env,
      stdio: 'pipe',
      serviceName: 'Sentinel server'
    });
    const me = child;
    child.stdout.on('data', (chunk) => log && log.write(chunk));
    child.stderr.on('data', (chunk) => log && log.write(chunk));

    let settled = false;
    let ready = false;   // it reached 'listening': only then is an exit something to restart from
    const limit = startTimeout();
    if (limit > START_TIMEOUT_MS) log.write(`the database is large; allowing ${Math.round(limit / 1000)} s for this start\n`);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Do not leave a half-started scanner behind to fight the next attempt for the
      // port and the database: end it, and only report once it is really gone.
      const failed = new Error(`The server did not start within ${Math.round(limit / 1000)} seconds`);
      const dying = child;
      if (!dying) { reject(failed); return; }
      const giveUp = setTimeout(() => reject(failed), 15000);
      dying.once('exit', () => { clearTimeout(giveUp); reject(failed); });
      try { dying.kill(); } catch { clearTimeout(giveUp); reject(failed); }
    }, limit);

    child.on('message', (msg) => {
      if (!msg || settled) return;
      if (msg.type === 'listening') {
        settled = true;
        ready = true;
        clearTimeout(timer);
        port = msg.port;
        log.write(`listening on http://127.0.0.1:${port}\n`);
        resolve(`http://127.0.0.1:${port}`);
      } else if (msg.type === 'error') {
        settled = true;
        clearTimeout(timer);
        log.write(`failed to start: ${msg.message}\n${msg.stack || ''}\n`);
        reject(new Error(msg.message));
      }
    });

    child.on('exit', (code) => {
      if (log) log.write(`[${new Date().toISOString()}] server exited with code ${code}\n`);
      if (child === me) child = null;   // a later server may already have taken its place
      if (stopping) return;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`The server exited with code ${code} before it was ready`));
        return;
      }
      // A start that failed or timed out has already been reported to the caller, which retries.
      // Restarting here as well would put two servers on one database.
      if (!ready) return;
      scheduleRestart(store, code);
    });
  });
}

function scheduleRestart(store, code) {
  const now = Date.now();
  restartTimes = restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
  if (restartTimes.length >= MAX_RESTARTS) {
    log.write('giving up: too many restarts\n');
    hooks.onDown(`Sentinel's scanner stopped ${MAX_RESTARTS + 1} times in a row (last exit code ${code}).`);
    return;
  }
  restartTimes.push(now);
  const delay = 1000 * 2 ** (restartTimes.length - 1);
  log.write(`restarting in ${delay}ms\n`);
  setTimeout(() => {
    if (stopping) return;
    spawn(store).then((origin) => hooks.onRestart && hooks.onRestart(origin)).catch((err) => hooks.onDown(err.message));
  }, delay);
}

/**
 * Start the server and resolve with its origin. `onDown` is called if it
 * later dies for good; `onRestart` after it comes back on its own.
 */
async function start(store, options = {}) {
  hooks = { onDown: options.onDown || (() => {}), onRestart: options.onRestart || null };
  stopping = false;
  restartTimes = [];
  openLog();
  return spawn(store);
}

function stop() {
  stopping = true;
  if (child) { try { child.kill(); } catch { /* already gone */ } }
  child = null;
  if (log) { log.end(); log = null; }
}

module.exports = { start, stop, logPath, get port() { return port; } };
