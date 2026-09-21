'use strict';
/**
 * Refreshes the threat lists on a thread of its own.
 *
 * A refresh downloads and rewrites about a million rows. Done on the server's
 * main thread it holds up every request for as long as each step takes: on a
 * fresh install the first minutes of live scanning answered in seconds instead
 * of milliseconds, and the app felt slow to start. Here it has its own thread
 * and its own connection to the list cache; SQLite's write-ahead log lets the
 * main thread keep reading while this one writes.
 */
const { parentPort, workerData } = require('worker_threads');

(async () => {
  try {
    const feeds = require('./feeds');
    const results = await feeds.refreshAll({ log: Boolean(workerData && workerData.log), force: Boolean(workerData && workerData.force) });
    parentPort.postMessage({ ok: true, results });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message || err) });
  }
})();
