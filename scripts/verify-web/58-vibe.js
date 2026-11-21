'use strict';
/**
 * vibe  A colour changes everything, in one clean move, as a person uses it.
 *
 *   The sheet   the home page in every colour, dark and light, side by side in one picture (vibe-sheet-home.png): the
 *               words, the grounds, the stars, the hero's metal and the buttons all in the colour, the warning colours
 *               the same everywhere. Each frame is read back: its words are the colour's own, not gold's cream.
 *   The app     the app's overview in every colour, dark and light (vibe-app-<colour>-<scheme>.png).
 *   The press   the coins in Settings, pressed for real with the mouse resting on them: how long from the press until
 *               the new colour is on screen (the reveal's first frame) and until it covers most of the window, and
 *               how the pressed coin moves under the resting pointer: where it is drawn, every frame for a second and
 *               a half; it should rise or settle once, never dip and come back, turn, or move after the change has
 *               ended. The numbers are printed, so the same check run on an older build gives the before.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, sleep, result, serveFiles, launch, evalIn, openPage, goto, shot, startServer, until } = require('./_shared');
const L = require('../../web/assets/js/look.js');

const IDS = L.ACCENTS.map((a) => a.id);
const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };

// The sheet: one frame per colour and scheme, each the real home page, painted by look.js from the page that holds them.
const SHEET = `<!doctype html><meta charset="utf-8"><title>Every colour</title>
<style>
  body { margin: 0; padding: 18px; background: #0a0a0c; font: 600 13px/1.2 system-ui, sans-serif; color: #ddd; }
  .grid { display: grid; grid-template-columns: repeat(${IDS.length}, 384px); gap: 14px 12px; }
  figure { margin: 0; } figcaption { margin: 0 0 6px; }
  .cut { width: 384px; height: 240px; overflow: hidden; border-radius: 10px; }
  iframe { width: 1280px; height: 800px; border: 0; transform: scale(.3); transform-origin: 0 0; }
</style>
<script>try { sessionStorage.setItem('sentinel:intro', '1'); } catch (e) {}</script>
<script src="/assets/js/look.js"></script>
<div class="grid">${['dark', 'light'].map((s) => IDS.map((id) => `<figure><figcaption>${id} ${s}</figcaption><div class="cut"><iframe data-accent="${id}" data-scheme="${s}" src="/index.html"></iframe></div></figure>`).join('')).join('')}</div>`;

// Each frame painted in its look, then read back: its words, its stars' tint, its hero line (the second weight of words),
// its status colours. Read after the frame has settled: read at once, a frame still loading gave its first colours.
const PAINT = `Promise.all([...document.querySelectorAll('iframe')].map((f) => new Promise((done) => {
  const go = () => {
    const d = f.contentDocument, w = f.contentWindow;
    SentinelLook.paint(d.documentElement, { mode: f.dataset.scheme, accent: f.dataset.accent });
    // Read in the frame's own next frame, and again a few times if its words have not caught up with its colours yet
    // (a frame still settling once read the colours it first loaded with, while its picture was already right).
    const rgb = (hex) => 'rgb(' + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
    let tries = 0;
    const read = () => w.requestAnimationFrame(() => {
      const cs = w.getComputedStyle(d.documentElement), v = (k) => cs.getPropertyValue(k).trim();
      const h1 = d.querySelector('.hero h1');
      const out = { accent: f.dataset.accent, scheme: f.dataset.scheme, text: v('--text'), star: v('--star-1'), red: v('--red'), green: v('--green'),
        body: w.getComputedStyle(d.body).color, h1: h1 ? w.getComputedStyle(h1).color : '', sky: Boolean(d.querySelector('canvas.cosmos')), tries };
      if (out.body === rgb(out.text) || ++tries > 8) done(out); else setTimeout(read, 500);
    });
    setTimeout(read, 1500);
  };
  if (f.contentDocument && f.contentDocument.readyState === 'complete') go(); else f.addEventListener('load', go, { once: true });
})))`;

// Every press timed from the pointer going down: the view transition's first frame (ready), the reveal reaching 200 px
// across (the colour plainly on screen) and reaching half the window's diagonal (most of it); and the pressed coin's
// disc, every frame: its top edge and its turn (a hover that is lost in the change and comes back shows as a dip).
const TIMER = `(() => {
  window.__press = [];
  let cur = null;
  addEventListener('pointerdown', (e) => { if (!e.target.closest || !e.target.closest('.look__coin')) return; cur = { t0: performance.now(), frames: 0, path: [] }; window.__press.push(cur);
    const rec = cur, disc = e.target.closest('.look__coin').querySelector('i');
    const track = () => { const m = new DOMMatrix(getComputedStyle(disc).transform); rec.path.push([Math.round((performance.now() - rec.t0)), Math.round(disc.getBoundingClientRect().top * 100) / 100, Math.round(Math.atan2(m.b, m.a) * 1800 / Math.PI) / 10]); if (performance.now() - rec.t0 < 1500) requestAnimationFrame(track); };
    requestAnimationFrame(track); }, true);
  if (!document.startViewTransition) return;
  const st = document.startViewTransition.bind(document);
  document.startViewTransition = (fn) => {
    const rec = cur, vt = st(fn);
    if (!rec) return vt;
    rec.start = performance.now() - rec.t0;
    vt.ready.then(() => {
      rec.ready = performance.now() - rec.t0;
      const half = Math.hypot(innerWidth, innerHeight) / 2;
      const tick = () => {
        const now = performance.now() - rec.t0;
        const m = /circle\\(([\\d.]+)px/.exec(getComputedStyle(document.documentElement, '::view-transition-new(root)').clipPath || '');
        const r = m ? Number(m[1]) : NaN;
        if (rec.seen == null && r >= 200) rec.seen = now;
        if (rec.most == null && r >= half) rec.most = now;
        rec.frames++;
        if (rec.most == null && now < 3000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, () => {});
    vt.finished.then(() => { rec.done = performance.now() - rec.t0; }, () => {});
    return vt;
  };
})()`;

async function checkVibe() {
  if (!fs.existsSync(path.join(STATIC, 'index.html'))) throw new Error(`no static build in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC }, { '/__sheet.html': SHEET });
  const sentinel = await startServer('vibe');
  const { browser, close } = await launch();
  try {
    /* ------------------------------------------------------------- the sheet */
    {
      const { sessionId: s } = await openPage(browser);
      const w = 36 + IDS.length * 384 + (IDS.length - 1) * 12;
      await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: 36 + 2 * 270 + 14, deviceScaleFactor: 1, mobile: false }, s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
      await goto(browser, s, `${files.base}/__sheet.html`, "document.querySelectorAll('iframe').length === " + IDS.length * 2);
      const got = await evalIn(browser, s, PAINT, { timeout: 60000 });
      await sleep(4000);   // the masks' pictures and the stars, settled
      await shot(browser, s, 'vibe-sheet-home');
      const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      const bad = got.filter((f) => {
        const r = L.ramp(f.accent, f.scheme);
        const words = r['--text'];
        const status = f.red === L.STATUS[f.scheme].red && f.green === L.STATUS[f.scheme].green;
        if (f.accent === 'gold') return !status || f.text === '' || f.star.toLowerCase() !== '#ffe2b0';
        return !status || f.text !== words || f.body !== rgb(words) || f.h1 !== rgb(r['--text-2']) || f.star !== r['--star-1'] || (f.scheme === 'dark' && !f.sky);
      });
      result('vibe: every colour draws the whole home page in its own words, grounds and stars, dark and light, and the warning colours never move', got.length === IDS.length * 2 && !bad.length, { bad, got: got.map((f) => `${f.accent} ${f.scheme}: ${f.text} ${f.star}`) });
    }

    /* --------------------------------------------------------------- the app */
    const { sessionId: s } = await openPage(browser);
    const ev = (expr, opts) => evalIn(browser, s, expr, opts);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }, s);
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: TIMER }, s);
    await goto(browser, s, `${sentinel.base}/login`);
    const email = `vibe-${Date.now()}@example.com`;
    const api = (p, body) => ev(`fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await api('/auth/signup', { email, password: 'Vibe-Check-Lamp-2026', firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password: 'Vibe-Check-Lamp-2026' });
    const store = (mode, accent) => ev(`(() => { localStorage.setItem('sentinel:theme', '${mode}'); ${accent === 'gold' ? "localStorage.removeItem('sentinel:accent');" : `localStorage.setItem('sentinel:accent', '${accent}');`} localStorage.removeItem('sentinel:look-at'); return true; })()`);
    for (const scheme of ['dark', 'light']) for (const id of IDS) {
      await store(scheme, id);
      await goto(browser, s, `${sentinel.base}/app?at=${Date.now()}`, "document.querySelector('.side')");
      await sleep(1600);
      await shot(browser, s, `vibe-app-${id}-${scheme}`);
    }

    /* ------------------------------------------------------------- the press */
    await store('dark', 'gold');
    await goto(browser, s, `${sentinel.base}/app/settings?at=${Date.now()}#accent`, "document.querySelector('#accent .look__coin')");
    await ev("document.getElementById('accent').scrollIntoView({ block: 'center', behavior: 'instant' }), true");
    await sleep(1800);
    const at = (id) => ev(`(() => { const r = document.querySelector('.look__coin input[value="${id}"]').parentNode.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 18]; })()`);
    const order = ['rose', 'teal', 'sapphire', 'amethyst', 'platinum', 'gold', 'rose', 'teal'];
    for (const id of order) {
      const [x, y] = await at(id);
      // The pointer comes to rest on the coin first, as a hand does, then presses.
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s);
      await sleep(500);
      for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, s);
      await until(browser, s, `document.documentElement.dataset.accent === '${id}' && !document.documentElement.classList.contains('look-vt')`, 5000);
      await sleep(400);
    }
    const press = await ev('window.__press');
    const m = { ready: median(press.map((p) => p.ready)), seen: median(press.map((p) => p.seen)), most: median(press.map((p) => p.most)), done: median(press.map((p) => p.done)) };
    // How the disc moved: a dip is the top edge going one way by more than half a pixel and then back by as much (the
    // spring's own small overshoot is under that); a turn is any rotation; anything still moving after the change is
    // over (850 ms) is a late jump.
    const wobble = (p) => {
      let dips = 0, dir = 0, from = p.path.length ? p.path[0][1] : 0, late = 0, turn = 0;
      for (const [t, top, deg] of p.path) {
        turn = Math.max(turn, Math.abs(deg));
        const d = top - from;
        if (Math.abs(d) >= 0.5) { const nd = Math.sign(d); if (dir && nd !== dir) dips++; dir = nd; from = top; }
        if (t > 850 && Math.abs(top - p.path[p.path.length - 1][1]) >= 0.5) late++;
      }
      return { dips, late, turn };
    };
    const moves = press.map(wobble);
    const unsteady = moves.reduce((n, w) => n + w.dips + w.late + (w.turn >= 1 ? 1 : 0), 0);
    console.log(`      press to repaint, median of ${press.length} (ms): first frame ${m.ready.toFixed(0)}, plainly on screen ${m.seen.toFixed(0)}, most of the window ${m.most.toFixed(0)}, settled ${m.done.toFixed(0)}; the pressed coin: ${moves.map((w) => `${w.dips} dips, ${w.late} late, turned ${w.turn} deg`).join('; ')}`);
    fs.writeFileSync(path.join(require('./_shared').OUT, 'vibe-press.json'), JSON.stringify({ median: m, moves, press }, null, 2));
    result('vibe: a coin pressed puts the new colour plainly on screen within 250 ms and over most of the window within 450 ms (median)', press.length === order.length && m.seen <= 250 && m.most <= 450, m);
    result('vibe: the pressed coin under a resting pointer moves once and stays: no dip and return, no turn, nothing after the change', press.length === order.length && unsteady === 0, moves);
  } finally { await close(); files.server.close(); await sentinel.stop(); }
}

module.exports = checkVibe;
