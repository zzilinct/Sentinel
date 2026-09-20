'use strict';
/**
 * One server per database.
 *
 * Two heavy writers on one SQLite file, one of them killed mid-write, is how an
 * accounts file gets damaged. So a server claims the file before it opens it
 * (opening can mean minutes of migration, and that has to be covered too), and a
 * second server refuses to start.
 *
 * The claim is a small file next to the database. A server that is killed never
 * removes it, so a claim has to be judged, not just found:
 *
 *   - from before the last boot                 -> nobody holds it
 *   - its process is gone                       -> nobody holds it
 *   - its process number now belongs to another
 *     program (Windows hands numbers out again) -> nobody holds it
 *
 * The last case is the one a bare process number gets wrong: after a restart the
 * old number can belong to a system process, and Sentinel would refuse to start
 * its scanner for ever. So the claim records when its process started, and the
 * operating system is asked whether that is still the process behind the number.
 *
 * Tools that open the database beside a running server (scripts/admin.js, the
 * probe) do not claim it: only server/index.js does.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../config');

const IN_MEMORY = config.dbPath === ':memory:';
const LOCK_PATH = `${config.dbPath}.lock`;
const BOOT_SLACK_MS = 2 * 60 * 1000;   // os.uptime() and the clock drift a little against each other
const START_SLACK_MS = 30 * 1000;      // process.uptime() starts a moment after the process was created

const bootTime = () => Date.now() - os.uptime() * 1000;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

/** When the process behind this number started, in ms, or null when the system cannot say. */
function startedAt(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-Process -Id ${Number(pid)} -ErrorAction Stop; [DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds()`],
      { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const ms = Number(String(out).trim());
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    }
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(Number(pid))], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
    const ms = Date.parse(String(out).trim());
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function read() {
  try {
    const text = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return { pid: Number(text) };          // written by 1.4.0 to 1.4.3
    const claim = JSON.parse(text);
    return claim && Number.isInteger(claim.pid) ? claim : null;
  } catch {
    return null;
  }
}

/** Is the server that wrote this claim still running? `probe` is replaceable so tests need no second process. */
function held(claim, probe = { alive, startedAt, bootTime }) {
  if (!claim || !claim.pid || claim.pid === process.pid) return false;
  if (claim.boot && Math.abs(claim.boot - probe.bootTime()) > BOOT_SLACK_MS) return false;
  if (!probe.alive(claim.pid)) return false;
  const started = probe.startedAt(claim.pid);
  // Cannot be checked: believe the claim. Refusing to start is recoverable, two writers are not.
  if (started === null) return true;
  if (claim.started) return Math.abs(started - claim.started) <= START_SLACK_MS;
  // An old claim has only a number. Its process must at least be older than the claim file.
  try { return started <= fs.statSync(LOCK_PATH).mtimeMs + START_SLACK_MS; } catch { return true; }
}

let mine = null;

/** Claim the database for this process, or throw DB_LOCKED. Safe to call twice. */
function claim() {
  if (IN_MEMORY) return { unclean: false };
  if (mine) return mine;
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  const previous = read();
  if (held(previous)) {
    throw Object.assign(new Error(`Another Sentinel (process ${previous.pid}) is already using ${path.basename(config.dbPath)}. Close it first, or point DB_PATH somewhere else.`), { code: 'DB_LOCKED' });
  }
  const me = { pid: process.pid, started: Math.round(Date.now() - process.uptime() * 1000), boot: Math.round(bootTime()) };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(me));
  process.once('exit', () => {
    try { const now = read(); if (now && now.pid === process.pid) fs.unlinkSync(LOCK_PATH); } catch { /* gone */ }
  });
  // A claim left behind means the last server was killed, not closed.
  mine = { unclean: Boolean(previous) };
  return mine;
}

module.exports = { claim, held, read, LOCK_PATH };
