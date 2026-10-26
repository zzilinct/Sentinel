'use strict';
/**
 * mask-rest  The home page's 3D masks (mask3d.js) rest when nothing happens and wake at once: once the page has
 *            settled they are drawn only a few times a second and still drift, the main thread is mostly free, a
 *            pointer move brings back every frame (photographed mid-motion), and a mask off screen or in a hidden
 *            tab is not drawn at all.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto } = require('./_shared');

// A headless browser reports no mouse; this says there is one, as a desktop browser would.
const MOUSE = `(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /hover: hover|pointer: fine/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); })();`;
const HERO = "document.querySelector('[data-hero-mask] [data-mask3d]')";
const STATE = 'window.SentinelMask3D.state()';
// A fingerprint of the hero's drawn picture, to tell whether it moved.
const PIXELS = `(() => { const c = ${HERO}.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 61) h = (h * 31 + d[i]) | 0; return h; })()`;

async function checkMaskRest() {
  if (!fs.existsSync(path.join(STATIC, 'assets', 'js', 'mask3d.js'))) throw new Error(`no static build with the masks in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const ev = (expr) => evalIn(browser, s, expr);
    await browser.send('Performance.enable', {}, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }, s);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: MOUSE }, s);
    await goto(browser, s, `${files.base}/index.html`, 'window.SentinelMask3D');
    const ready = await (async () => { for (let i = 0; i < 120; i++) { if (await ev(`${HERO}.classList.contains('mask3d--ready')`)) return true; await sleep(250); } return false; })();
    if (!ready) { result('mask-rest: the hero mask is drawn in 3D', false, 'no mask3d--ready on the hero after 30 s'); return; }

    const busy = async () => (await browser.send('Performance.getMetrics', {}, s)).metrics.find((m) => m.name === 'TaskDuration').value;
    const hero = async () => (await ev(`window.SentinelMask3D.state(${HERO})`)).masks[0];
    // Draws per second of the hero, and the main thread's busy share, over `ms`.
    const measure = async (ms, during) => {
      const d0 = (await hero()).draws;
      const b0 = await busy();
      const t0 = Date.now();
      if (during) await during(); else await sleep(ms);
      const secs = (Date.now() - t0) / 1000;
      return { perSec: Number((((await hero()).draws - d0) / secs).toFixed(1)), busy: Math.round(((await busy()) - b0) / secs * 100) };
    };
    const box = await ev(`(() => { const r = ${HERO}.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const clip = { x: Math.max(0, box.x - box.w * 0.2), y: Math.max(0, box.y - box.h * 0.2), width: Math.min(1366, box.w * 1.4), height: Math.min(900, box.h * 1.4), scale: 1 };
    const photo = async (name) => {
      const { data } = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 75, clip }, s);
      fs.writeFileSync(path.join(OUT, `mask-rest-${name}.jpg`), Buffer.from(data, 'base64'));
    };

    /* Settled: the entrance done, nothing pointed at. */
    await sleep(4000);
    const restState = await ev(STATE);
    const rest = await measure(5000);
    const p1 = await ev(PIXELS);
    await sleep(600);
    const p2 = await ev(PIXELS);
    for (let i = 0; i < 3; i++) { await photo(`rest-${i}`); await sleep(400); }
    result('mask-rest: once settled the hero rests, drawn a few times a second, and still drifts',
      restState.resting && rest.perSec >= 1 && rest.perSec <= 17 && p1 !== p2,
      { resting: restState.resting, heroDrawsPerSec: rest.perSec, mainThreadBusy: `${rest.busy}%`, pictureMoved: p1 !== p2, masks: restState.masks.map((m) => `${m.kind}${m.onScreen ? ' on screen' : ''}`) });

    /* A pointer near the hero: awake at once, every frame drawn as it turns to watch. */
    const fx = box.x + box.w * 0.9;
    const fy = box.y + box.h * 0.3;
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx, y: fy, button: 'none' }, s);
    const woke = await ev(STATE);
    const awake = await measure(0, async () => {
      for (let i = 0; i < 12; i++) {
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx - i * 40, y: fy + i * 14, button: 'none' }, s);
        await photo(`move-${String(i).padStart(2, '0')}`);
        await sleep(100);
      }
    });
    result('mask-rest: a pointer move wakes the masks at once, and the hero is drawn every frame as it turns (photographed)',
      !woke.resting && awake.perSec > rest.perSec * 1.3,
      { restingAfterMove: woke.resting, heroDrawsPerSec: awake.perSec, mainThreadBusy: `${awake.busy}%`, frames: 'mask-rest-move-00..11.jpg' });

    /* It goes back to rest once the pointer is still. */
    await sleep(4000);
    const settled = await ev(STATE);
    const again = await measure(3000);
    result('mask-rest: after the pointer stops it rests again', settled.resting && again.perSec <= 17, { resting: settled.resting, heroDrawsPerSec: again.perSec, mainThreadBusy: `${again.busy}%` });

    /* A hidden tab and a mask off screen are not drawn. */
    await ev("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); true");
    await sleep(500);
    const hidden = await measure(2000);
    await ev("delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); true");
    const back = await measure(1500);
    await ev(`window.scrollTo(0, ${HERO}.getBoundingClientRect().bottom + scrollY + 1500); true`);
    await sleep(1500);
    const off0 = await hero();
    await sleep(2000);
    const off1 = await hero();
    result('mask-rest: nothing is drawn in a hidden tab, drawing comes back with the tab, and a mask off screen is not drawn',
      hidden.perSec === 0 && back.perSec > 0 && !off0.onScreen && off1.draws === off0.draws,
      { hiddenDrawsPerSec: hidden.perSec, backDrawsPerSec: back.perSec, heroOnScreen: off0.onScreen, offScreenDraws: off1.draws - off0.draws });
  } finally { await close(); files.server.close(); }
}

module.exports = checkMaskRest;
