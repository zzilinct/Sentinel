'use strict';
/**
 * Refreshes the threat lists on a thread of its own, below normal priority.
 *
 * A refresh downloads and rewrites about a million rows. Done on the server's
 * main thread it holds up every request for as long as each step takes: on a
 * fresh install the first minutes of live scanning answered in seconds instead
 * of milliseconds, and the app felt slow to start. Here it has its own thread
 * and its own connection to the list cache; SQLite's write-ahead log lets the
 * main thread keep reading while this one writes.
 *
 * Below normal: the computer gives the import the time a game or a video call
 * does not want. On Linux that is this thread alone. Windows sets it for the
 * whole server process, so the server puts its own back when the refresh ends
 * (feeds.js refreshInBackground).
 */
const os = require('os');
const { parentPort, workerData } = require('worker_threads');

try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* the system refused: it runs as before */ }

(async () => {
  try {
    const feeds = require('./feeds');
    const results = await feeds.refreshAll({ log: Boolean(workerData && workerData.log), force: Boolean(workerData && workerData.force) });
    parentPort.postMessage({ ok: true, results, priority: os.getPriority() });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message || err) });
  }
})();
