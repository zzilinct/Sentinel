'use strict';
/**
 * Download protection's file analysis, off the main thread (see downloads.js). Reading a download of up to 25 MB and
 * looking through every byte of it took long enough on the main thread to hold up everything else Sentinel does
 * there: the live scanning overlay, the tray, the window.
 *
 * workerData: { file, name, known }. Posts back { report } or { error }.
 */
const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
const { scanFile } = require('../shared/filescan');

try {
  const { file, name, known } = workerData;
  const buf = fs.readFileSync(file);
  parentPort.postMessage({ report: scanFile(buf, name, { lookupHash: () => known || null }) });
} catch (err) {
  parentPort.postMessage({ error: err && err.message ? err.message : String(err) });
}
