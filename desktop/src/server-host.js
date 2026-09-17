'use strict';
/**
 * Entry point for the embedded Sentinel server.
 *
 * Runs inside an Electron utility process: a plain Node environment with no
 * window and no Electron APIs. A scan that misbehaves can only take this
 * process down, never the app, and the supervisor in server.js restarts it.
 *
 * Everything arrives through the environment:
 *   SENTINEL_BUNDLE   directory holding server/, web/ and brand.json
 *   SENTINEL_PORTS    loopback ports to try, in order
 *   DB_PATH, SESSION_SECRET, BILLING_MODE, ...   ordinary server settings
 */
const net = require('net');
const path = require('path');

const post = (message) => { if (process.parentPort) process.parentPort.postMessage(message); };

/** True when nothing is listening on this loopback port. */
function isFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function main() {
  const bundle = process.env.SENTINEL_BUNDLE;
  if (!bundle) throw new Error('SENTINEL_BUNDLE is not set');

  const candidates = String(process.env.SENTINEL_PORTS || '47821').split(',').map(Number).filter(Boolean);
  let port = null;
  for (const p of candidates) {
    if (await isFree(p)) { port = p; break; }
  }
  if (!port) throw new Error(`No free port among ${candidates.join(', ')}`);

  // The server reads its configuration at require time, so settle it first.
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;

  const { start } = require(path.join(bundle, 'server', 'index.js'));
  const server = start();
  server.once('listening', () => post({ type: 'listening', port }));
  server.once('error', (err) => {
    post({ type: 'error', message: err.message });
    process.exit(1);
  });
}

main().catch((err) => {
  post({ type: 'error', message: err.message, stack: err.stack });
  process.exit(1);
});
