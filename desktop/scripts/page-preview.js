'use strict';
/**
 * Renders pages of a running Sentinel server offscreen and saves pictures of them, so a design change can be looked
 * at without opening a window on anybody's screen.
 *
 *   electron desktop/scripts/page-preview.js <origin> <output folder> <path> [<path> ...]
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

// Pages may be written "@/pricing": a shell on Windows rewrites a bare "/pricing" into a file path.
const [origin, out, ...rawPages] = process.argv.slice(2);
const pages = rawPages.map((p) => (p === 'home' ? '/' : `/${p.replace(/^[@/]+/, '')}`));   // "pricing", not "/pricing": a Windows shell rewrites a leading slash
const base = /^https?:/.test(origin) ? origin : `http://${origin}`;   // a bare host:port is accepted, because Electron swallows a URL argument
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 1360, height: 900, useContentSize: true, webPreferences: { offscreen: true } });
  for (const page of pages) {
    await win.loadURL(base + page);
    await sleep(1800);
    // Reveal-on-scroll content starts hidden; show everything, as someone who scrolled down would see it.
    await win.webContents.executeJavaScript("document.querySelectorAll('[data-reveal],[data-split]').forEach(function (el) { el.classList.add('is-in'); el.style.opacity = 1; el.style.transform = 'none'; }); void 0;");
    const height = Math.min(4200, await win.webContents.executeJavaScript('document.documentElement.scrollHeight'));
    win.setContentSize(1360, height);
    await sleep(700);
    const image = await win.webContents.capturePage();
    const name = (page.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home') + '.png';
    fs.writeFileSync(path.join(out, name), image.toPNG());
    win.setContentSize(1360, 900);
    console.log(`saved ${name} (${height}px tall)`);
  }
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
