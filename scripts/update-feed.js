'use strict';
// The update feed for scripts/update-e2e.ps1, on a CI runner only: one folder served on 127.0.0.1, with byte ranges
// one per request (as GitHub's release downloads answer them), so electron-updater's differential download runs as it
// does for real. Each request is written to the log as "<file> <status> <bytes>": how much of the installer was
// really fetched. Usage: node update-feed.js <folder> <port> <log file>
const http = require('http');
const fs = require('fs');
const path = require('path');

const [dir, port = '47930', logFile] = process.argv.slice(2);
const say = (line) => { if (logFile) fs.appendFileSync(logFile, `${line}\n`); };

http.createServer((req, res) => {
  const name = path.basename(decodeURIComponent(new URL(req.url, 'http://feed').pathname));
  let size;
  try { size = fs.statSync(path.join(dir, name)).size; } catch { res.writeHead(404).end(); say(`${name} 404 0`); return; }
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); say(`${name} 416 0`); return; }
  res.writeHead(m ? 206 : 200, { 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(path.join(dir, name), { start, end }).pipe(res);
  say(`${name} ${m ? 206 : 200} ${end - start + 1}`);
}).listen(Number(port), '127.0.0.1');
