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

function spawn(store) {
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
      SENTINEL_DEVICE_ACCOUNTS: '1'
    };
    delete env.ELECTRON_RUN_AS_NODE;

    child = utilityProcess.fork(path.join(__dirname, 'server-host.js'), [], {
      env,
      stdio: 'pipe',
      serviceName: 'Sentinel server'
    });
    child.stdout.on('data', (chunk) => log && log.write(chunk));
    child.stderr.on('data', (chunk) => log && log.write(chunk));

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Do not leave a half-started scanner behind to fight the next attempt for the port.
      try { if (child) child.kill(); } catch { /* already gone */ }
      reject(new Error(`The server did not start within ${START_TIMEOUT_MS / 1000} seconds`));
    }, START_TIMEOUT_MS);

    child.on('message', (msg) => {
      if (!msg || settled) return;
      if (msg.type === 'listening') {
        settled = true;
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
      log.write(`[${new Date().toISOString()}] server exited with code ${code}\n`);
      child = null;
      if (stopping) return;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`The server exited with code ${code} before it was ready`));
        return;
      }
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
