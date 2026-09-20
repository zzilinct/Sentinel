'use strict';
/**
 * Renders the live-scanning overlay offscreen and saves pictures of it, so its
 * look can be checked without putting anything on anybody's screen.
 *
 *   electron desktop/scripts/overlay-preview.js <output folder>
 *
 * The overlay page is the real one. It is laid over a plain stand-in for a
 * search results page, and sent the same messages the app sends it.
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.resolve(process.argv[2] || 'overlay-preview');
const W = 1180;
const H = 760;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in results page: ten result titles, left aligned, like every search engine.
const results = Array.from({ length: 8 }, (_, i) => ({ x: 170, y: 150 + i * 74, w: [420, 380, 460, 340, 400, 430, 360, 410][i], h: 24 }));
const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font:15px system-ui,Segoe UI,sans-serif;color:#202124">
  <div style="padding:26px 170px;border-bottom:1px solid #e8eaed"><div style="width:560px;height:42px;border:1px solid #dfe1e5;border-radius:22px"></div></div>
  ${results.map((r, i) => `<div style="position:absolute;left:${r.x}px;top:${r.y - 22}px;width:620px">
    <div style="font-size:12px;color:#4d5156">https://result-${i + 1}.example</div>
    <div style="font-size:20px;color:#1a0dab;width:${r.w}px;white-space:nowrap;overflow:hidden">Result number ${i + 1} about the thing you searched</div>
    <div style="font-size:13px;color:#4d5156">A line of description text under the result title, as usual.</div></div>`).join('')}
</body>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true } });
  await base.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  const over = new BrowserWindow({
    show: false, width: W, height: H, useContentSize: true, transparent: true, frame: false,
    webPreferences: { offscreen: true, preload: path.join(__dirname, '..', 'src', 'overlay-preload.js'), contextIsolation: true, sandbox: true }
  });
  await over.loadFile(path.join(__dirname, '..', 'src', 'pages', 'overlay.html'));
  const send = (channel, payload) => over.webContents.send(channel, payload);

  // Picture = the stand-in page with the overlay composited on top, the way the screen shows it.
  const shot = async (name) => {
    const [a, b] = await Promise.all([base.webContents.capturePage(), over.webContents.capturePage()]);
    const size = a.getSize();
    const under = a.toBitmap();
    const top = b.resize({ width: size.width, height: size.height }).toBitmap();
    for (let i = 0; i < under.length; i += 4) {
      const alpha = top[i + 3] / 255;
      for (let c = 0; c < 3; c++) under[i + c] = Math.round(top[i + c] + under[i + c] * (1 - alpha));   // premultiplied "over"
    }
    const { nativeImage } = require('electron');
    fs.writeFileSync(path.join(OUT, `${name}.png`), nativeImage.createFromBitmap(under, size).toPNG());
  };

  const marks = (resolved) => results.map((r, i) => {
    if (i >= resolved) return { ...r, pending: true };
    const verdict = [null, null, { badge: 'orange', kind: 'scam', label: 'Likely scam', reason: 'Another page on this site is listed by PhishTank' }, null,
      { badge: 'yellow', kind: 'scam', label: 'Suspicious', reason: 'A free netlify.app page that calls itself "helpcenter"' }, null, { badge: 'red', kind: 'malware', label: 'Malware detected', reason: 'URLhaus: malware download' }, null][i];
    return { ...r, ...(verdict || { badge: null, kind: 'scam', label: 'No scam signs', reason: '' }) };
  });

  send('overlay:watching', { private: false, browser: 'msedge', appeared: true });
  send('overlay:sweep', { kind: 'search' });
  send('overlay:marks', { marks: marks(0) });
  await sleep(450); await shot('1-line-early');
  await sleep(450); await shot('2-line-mid');
  send('overlay:marks', { marks: marks(8) });
  await sleep(700); await shot('3-marks-arriving');
  await sleep(2200); await shot('4-settled');
  send('overlay:verdict', { badge: 'red', kind: 'scam', label: 'Confirmed scam' });
  await sleep(600); await shot('5-dangerous-page');
  send('overlay:verdict', { badge: null });
  send('overlay:watching', { private: true, browser: 'msedge', appeared: false });
  await sleep(600); await shot('6-private-window');
  console.log(`saved 6 pictures to ${OUT}`);
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
