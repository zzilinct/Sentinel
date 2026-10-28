'use strict';
/**
 * Defense's read of the Run keys, off the main thread (see checkPersistence in defense.js). Starting reg.exe is a
 * process start, and on the main thread it held up the live scanning overlay, the tray and the window while it ran.
 *
 * workerData: { keys: ['HKCU\\...\\Run', ...] }. Posts back { outputs: [stdout or '' per key] }.
 */
const { parentPort, workerData } = require('worker_threads');
const { execFileSync } = require('child_process');

const outputs = workerData.keys.map((key) => {
  try { return execFileSync('reg', ['query', key], { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
});
parentPort.postMessage({ outputs });
