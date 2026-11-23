'use strict';
// scripts/e2e-cdp.js, the desktop end-to-end runs' way into Sentinel's windows: a window that goes away mid-answer
// is said, never a silent exit (run 44948789986 attempt 1 read nothing and PowerShell threw).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');

test('a window that closes before it answers is an error the run can read', async () => {
  const server = http.createServer((req, res) => {
    const { port } = server.address();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify([{ type: 'page', url: 'http://127.0.0.1:1/app', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/1` }]));
  });
  // Accepts the connection, then closes it without answering, as a window that navigates away does.
  server.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.once('data', () => socket.end(Buffer.from([0x88, 0x00])));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const out = await new Promise((resolve) => execFile(process.execPath, [path.join(__dirname, '..', 'scripts', 'e2e-cdp.js'), String(server.address().port), '/app', '1'], { timeout: 20000 }, (err, stdout) => resolve(stdout)));
    assert.ok(out.trim(), 'it printed something');
    assert.match(JSON.parse(out).error, /went away/);
  } finally { server.close(); }
});

test('a debugging port that refuses says so', async () => {
  // A port nothing listens on: taken, then let go.
  const free = http.createServer();
  await new Promise((r) => free.listen(0, '127.0.0.1', r));
  const { port } = free.address();
  await new Promise((r) => free.close(r));
  const out = await new Promise((resolve) => execFile(process.execPath, [path.join(__dirname, '..', 'scripts', 'e2e-cdp.js'), String(port), '/app', '1'], { timeout: 20000 }, (err, stdout) => resolve(stdout)));
  assert.match(JSON.parse(out).error, /fetch failed \(ECONNREFUSED\)/);
});
