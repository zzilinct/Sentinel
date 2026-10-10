'use strict';
/**
 * qr        qr.js reads real QR pictures made by another encoder (scripts/verify-web-qr.py), loaded and called the
 *           way the app does it (app.js qrFromFile).
 */
const fs = require('fs');
const path = require('path');
const { ROOT, QR, result, serveFiles, launch, evalIn, openPage, goto } = require('./_shared');

/* ------------------------------------------------------------------ 2. QR */

async function checkQr() {
  const manifest = path.join(QR, 'manifest.json');
  if (!fs.existsSync(manifest)) throw new Error(`no QR pictures in ${QR}: run python scripts/verify-web-qr.py ${path.relative(ROOT, QR)}`);
  const samples = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  // The app's own reading code, taken from app.js so this checks what ships: qrFrom (two sizes) and qrFromFile.
  const app = fs.readFileSync(path.join(ROOT, 'web', 'assets', 'js', 'app.js'), 'utf8');
  const start = app.indexOf('  function qrFrom(');
  const end = app.indexOf('\n  /** What a QR code does');
  if (start < 0 || end < start) throw new Error('could not find qrFrom and qrFromFile in web/assets/js/app.js');
  const page = `<!doctype html><meta charset="utf-8"><title>QR</title><script src="/assets/js/qr.js"></script><script>\n${app.slice(start, end)}\nwindow.qrFromFile = qrFromFile;</script>`;
  const files = await serveFiles({ '/samples/': QR, '/': path.join(ROOT, 'web') }, { '/qr.html': page });
  const { browser, close } = await launch();
  try {
    const { sessionId } = await openPage(browser);
    await goto(browser, sessionId, `${files.base}/qr.html`, 'window.SentinelQR && window.qrFromFile');
    for (const s of samples) {
      const t0 = Date.now();
      const got = await evalIn(browser, sessionId, `fetch('/samples/${s.file}').then((r) => r.blob()).then((b) => qrFromFile(b))`).catch((err) => `error: ${err.message}`);
      result(`qr: ${s.file} (${s.what})`, got === s.text, got === s.text ? `read "${got}" in ${Date.now() - t0} ms` : `expected "${s.text}", got ${JSON.stringify(got)}`);
    }
  } finally {
    await close();
    files.server.close();
  }
}

module.exports = checkQr;
