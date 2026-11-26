'use strict';
/**
 * CI only (desktop-core-qa.ps1, core-use): stands in for the real honest sites, so the live-scanning check does not wait on
 * the outside network. The runner's hosts file points their names here, a certificate the runner trusts covers them,
 * and every address answers with a small page. Edge then shows the real address, the page is a real document in a
 * real window, and Sentinel reads and judges exactly what it would on the real site.
 *
 *   node scripts/honest-sites.js <pfx file> <pfx passphrase> [port]
 */
const https = require('https');
const fs = require('fs');

const [pfx, passphrase, port = '443'] = process.argv.slice(2);
https.createServer({ pfx: fs.readFileSync(pfx), passphrase }, (req, res) => {
  const host = String(req.headers.host || '').replace(/[^a-z0-9.-]/gi, '');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>${host}</title><body style="font:20px sans-serif;margin:40px"><h1>${host}</h1><p>A stand-in page for a CI check.</p>`);
}).listen(Number(port), '127.0.0.1', () => console.log(`honest sites on ${port}`));
