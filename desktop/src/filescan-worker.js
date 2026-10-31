'use strict';
/**
 * Download protection's file analysis, off the main thread (see downloads.js). Reading a download and looking through
 * it took long enough on the main thread to hold up everything else Sentinel does there: the live scanning overlay,
 * the tray, the window.
 *
 * workerData: { file, name, known }. Posts back { report } or { error }.
 */
const { parentPort, workerData } = require('worker_threads');
const { scanPath } = require('../shared/filescan');

try {
  const { file, name, known } = workerData;
  parentPort.postMessage({ report: scanPath(file, name, { lookupHash: () => known || null }) });
} catch (err) {
  parentPort.postMessage({ error: err && err.message ? err.message : String(err) });
}
