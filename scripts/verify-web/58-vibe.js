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
const { STATIC, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, shot, startServer, until } = require('./_shared');
const L = require('../../web/assets/js/look.js');

const IDS = L.ACCENTS.map((a) => a.id);
const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };

// The sheets: one frame per colour and scheme, each the real home page at a desktop's size or a phone's, painted by
// look.js from the page that holds them.
const SIZES = { desktop: { w: 1280, h: 800, k: 0.3 }, phone: { w: 390, h: 844, k: 0.45 } };
const cell = (z) => [Math.round(z.w * z.k), Math.round(z.h * z.k)];
const sheet = (z) => `<!doctype html><meta charset="utf-8"><title>Every colour</title>
<style>
  body { margin: 0; padding: 18px; background: #0a0a0c; font: 600 13px/1.2 system-ui, sans-serif; color: #ddd; }
  .grid { display: grid; grid-template-columns: repeat(${IDS.length}, ${cell(z)[0]}px); gap: 14px 12px; }
  figure { margin: 0; } figcaption { margin: 0 0 6px; }
  .cut { width: ${cell(z)[0]}px; height: ${cell(z)[1]}px; overflow: hidden; border-radius: 10px; }
  iframe { width: ${z.w}px; height: ${z.h}px; border: 0; transform: scale(${z.k}); transform-origin: 0 0; }
</style>
<script>try { sessionStorage.setItem('sentinel:intro', '1'); } catch (e) {}</script>
<script src="/assets/js/look.js"></script>
<div class="grid">${['dark', 'light'].map((s) => IDS.map((id) => `<figure><figcaption>${id} ${s}</figcaption><div class="cut"><iframe data-accent="${id}" data-scheme="${s}" src="/index.html"></iframe></div></figure>`).join('')).join('')}</div>`;
// The app's own sheets are its frames, laid side by side from the pictures this check took.
const board = (z, pics) => `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; padding: 18px; background: #0a0a0c; font: 600 13px/1.2 system-ui, sans-serif; color: #ddd; }
  .grid { display: grid; grid-template-columns: repeat(${IDS.length}, ${cell(z)[0]}px); gap: 14px 12px; }
  figure { margin: 0; } figcaption { margin: 0 0 6px; } img { display: block; width: ${cell(z)[0]}px; height: ${cell(z)[1]}px; border-radius: 10px; }
</style><div class="grid">${pics.map(([name, src]) => `<figure><figcaption>${name}</figcaption><img src="${src}"></figure>`).join('')}</div>`;

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
      const h1 = d.querySelector('.hero h1'), nav = d.querySelector('.nav__inner');
      // The hero's binary under the pointer (home.js), as it rests with less motion: the mean of its lit pixels.
      let ink = '';
      const c = d.querySelector('canvas.hero__unmask');
      if (c && c.width && c.height) {
        try {
          // The digits are most of what is drawn, each in the one ink at most .62 opaque: the commonest tinted colour at
          // that cover is theirs (the marks' white light and the warnings' solid pills are left out by it).
          const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, count = {};
          for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 40 && px[i + 3] < 170 && Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 8) { const k = [0, 1, 2].map((j) => (256 | Math.min(255, Math.round(px[i + j] * 255 / px[i + 3]))).toString(16).slice(1)).join(''); count[k] = (count[k] || 0) + 1; }
          const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
          if (top && top[1] > 50) ink = '#' + top[0];
        } catch (e) { ink = 'unread'; }
      }
      const out = { accent: f.dataset.accent, scheme: f.dataset.scheme, text: v('--text'), star: v('--star-1'), red: v('--red'), green: v('--green'),
        body: w.getComputedStyle(d.body).color, h1: h1 ? w.getComputedStyle(h1).color : '', sky: Boolean(d.querySelector('canvas.cosmos')), tries,
        nav: nav ? w.getComputedStyle(nav).backgroundColor : '', glass: (() => { const p = d.createElement('i'); p.style.background = 'var(--glass)'; d.body.append(p); const g = w.getComputedStyle(p).backgroundColor; p.remove(); return g; })(), ink, bar: (d.querySelector('meta[name="theme-color"]') || {}).content || '', bg: v('--bg') };
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
  const files = await serveFiles({ '/': STATIC }, { '/__sheet.html': sheet(SIZES.desktop), '/__sheet-phone.html': sheet(SIZES.phone) });
  const sentinel = await startServer('vibe');
  const { browser, close } = await launch();
  try {
    /* ------------------------------------------------------------ the sheets */
    const apart = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
    const HUE = Object.fromEntries(L.ACCENTS.map((a) => [a.id, a.h]));
    // The hero's binary is the colour's own: its hue within 30 degrees of the colour's (gold near gold's own,
    // platinum nearly grey), never gold's on another colour.
    const inkOk = (f) => {
      if (!/^#[0-9a-f]{6}$/.test(f.ink)) return false;
      const [, c, h] = L.toOklch(f.ink);
      if (f.accent === 'platinum') return c < 0.05;
      return c > 0.03 && apart(h, f.accent === 'gold' ? 85 : HUE[f.accent]) <= 30;
    };
    const boardSize = (z) => { const [cw, ch] = cell(z); return { width: 36 + IDS.length * cw + (IDS.length - 1) * 12, height: 36 + 2 * (ch + 30) + 14, deviceScaleFactor: 1, mobile: false }; };
    for (const [size, z] of Object.entries(SIZES)) {
      const { sessionId: s } = await openPage(browser);
      await browser.send('Emulation.setDeviceMetricsOverride', boardSize(z), s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
      await goto(browser, s, `${files.base}/${size === 'phone' ? '__sheet-phone' : '__sheet'}.html`, "document.querySelectorAll('iframe').length === " + IDS.length * 2);
      const got = await evalIn(browser, s, PAINT, { timeout: 60000 });
      await sleep(4000);   // the masks' pictures and the stars, settled
      await shot(browser, s, size === 'phone' ? 'vibe-sheet-home-phone' : 'vibe-sheet-home');
      const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      const bad = got.filter((f) => {
        const r = L.ramp(f.accent, f.scheme);
        const words = r['--text'];
        const status = f.red === L.STATUS[f.scheme].red && f.green === L.STATUS[f.scheme].green;
        if (f.accent === 'gold') return !status || f.text === '' || f.star.toLowerCase() !== '#ffe2b0';
        return !status || f.text !== words || f.body !== rgb(words) || f.h1 !== rgb(r['--text-2']) || f.star !== r['--star-1'] || (f.scheme === 'dark' && !f.sky);
      });
      result(`vibe: every colour draws the whole home page in its own words, grounds and stars, dark and light, and the warning colours never move (${size})`, got.length === IDS.length * 2 && !bad.length, { bad, got: got.map((f) => `${f.accent} ${f.scheme}: ${f.text} ${f.star}`) });
      // The top bar is the look's glass (no brown pill over a blue page), and the browser's own bar is the page's ground.
      const off = got.filter((f) => !f.nav || f.nav !== f.glass || f.bar.toLowerCase() !== f.bg.toLowerCase());
      result(`vibe: the top bar is the colour's glass and the browser's bar its ground, in every colour (${size})`, !off.length, got.map((f) => `${f.accent} ${f.scheme}: nav ${f.nav} glass ${f.glass} bar ${f.bar} bg ${f.bg}`));
      if (size === 'desktop') result("vibe: the hero's binary reveal is drawn in the chosen colour, never gold on another colour", got.every(inkOk), got.map((f) => `${f.accent} ${f.scheme}: ${f.ink}`));
    }

    /* --------------------------------------------------------------- the app */
    const { sessionId: s } = await openPage(browser);
    const ev = (expr, opts) => evalIn(browser, s, expr, opts);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }, s);
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: TIMER }, s);
    await goto(browser, s, `${sentinel.base}/login`);
    const email = `vibe-${Date.now()}@example.com`;
    const api = (p, body) => ev(`fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await api('/auth/signup', { email, password: 'Vibe-Check-Lamp-2026', firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password: 'Vibe-Check-Lamp-2026' });
    const store = (mode, accent) => ev(`(() => { localStorage.setItem('sentinel:theme', '${mode}'); ${accent === 'gold' ? "localStorage.removeItem('sentinel:accent');" : `localStorage.setItem('sentinel:accent', '${accent}');`} localStorage.removeItem('sentinel:look-at'); return true; })()`);
    // Read from each frame: where the overview's greeting sits (offsets, so an entrance's transform does not count),
    // whether the side bar scrolls inside itself, the island's ground, and how far the search box's hint overruns it.
    const READ = `(() => {
      const top = (el) => { let y = 0; for (; el; el = el.offsetParent) y += el.offsetTop; return y; };
      const h1 = document.querySelector('.page-title h1'), side = document.querySelector('.side'), foot = document.querySelector('.side__foot');
      const isl = document.querySelector('.lux-island'), q = document.querySelector('.scanbox input');
      const c = document.createElement('canvas').getContext('2d');
      let pad = 0;
      if (q) { const cs = getComputedStyle(q); c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + getComputedStyle(document.documentElement).getPropertyValue('--sans'); pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); }
      const nav = document.querySelector('.side__nav');
      return { h1: h1 ? top(h1) : -1, inner: side && getComputedStyle(side).position === 'sticky' ? Math.max(side.scrollHeight - side.clientHeight, nav.scrollHeight - nav.clientHeight) : 0,
        foot: foot && foot.offsetParent ? Math.round(foot.getBoundingClientRect().bottom) : 0, h: innerHeight,
        island: isl ? getComputedStyle(isl).backgroundColor : '', night: getComputedStyle(document.documentElement).getPropertyValue('--night-rgb').trim(),
        hint: q ? Math.ceil(c.measureText(q.placeholder).width) - (q.clientWidth - pad) : 0 };
    })()`;
    const frames = [];
    for (const [size, z] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: z.w, height: z.h, deviceScaleFactor: 1, mobile: size === 'phone' }, s);
      for (const scheme of ['dark', 'light']) for (const id of IDS) {
        await store(scheme, id);
        await goto(browser, s, `${sentinel.base}/app?at=${Date.now()}`, "document.querySelector('.page-title h1')");
        const first = await ev(READ);
        await sleep(900);
        // A toast, so the island is seen in the colour too.
        await ev("(window.UI && UI.toast('Your colour is saved.', 'success'), 1)");
        await sleep(700);
        const last = await ev(READ);
        const name = `vibe-app-${id}-${scheme}${size === 'phone' ? '-phone' : ''}`;
        await shot(browser, s, name);
        frames.push({ size, id, scheme, name, first, last });
      }
    }
    const desk = frames.filter((f) => f.size === 'desktop'), phone = frames.filter((f) => f.size === 'phone');
    result("vibe: the overview's greeting stays where it was first drawn, at one height in every colour (the mask's room is held)", desk.every((f) => f.first.h1 === f.last.h1 && f.last.h1 > 0) && new Set(desk.map((f) => f.last.h1)).size === 1, desk.map((f) => `${f.id} ${f.scheme}: ${f.first.h1} then ${f.last.h1}`));
    result("vibe: at 1280 by 800 the side bar holds every page, the plan's figures and the account without scrolling inside itself", desk.every((f) => f.last.inner <= 1 && f.last.foot > 0 && f.last.foot <= f.last.h), desk.map((f) => `${f.id} ${f.scheme}: overflow ${f.last.inner}, foot ${f.last.foot}/${f.last.h}`));
    const night = (f) => (f.id === 'gold' ? 'rgb(11, 9, 6)' : `rgb(${f.last.night.split(/\s+/).join(', ')})`);
    result("vibe: the toast island is the colour's own night, not gold's black and cream", frames.every((f) => f.last.island === night(f)), frames.map((f) => `${f.name}: ${f.last.island}`));
    result("vibe: the phone's search box shows its whole hint", phone.every((f) => f.last.hint <= 0), phone.map((f) => `${f.name}: ${f.last.hint}`));
    // The app's sheets: every colour, dark and light, at a desktop's size and a phone's, from the frames above.
    for (const [size, z] of Object.entries(SIZES)) {
      const pics = frames.filter((f) => f.size === size).map((f) => [`${f.id} ${f.scheme}`, `${f.name}.png`]);
      const page = path.join(OUT, `vibe-board-${size}.html`);
      fs.writeFileSync(page, board(z, pics));
      const { sessionId: b } = await openPage(browser);
      await browser.send('Emulation.setDeviceMetricsOverride', boardSize(z), b);
      await goto(browser, b, require('url').pathToFileURL(page).href, '[...document.images].every((i) => i.complete)');
      await shot(browser, b, size === 'phone' ? 'vibe-sheet-app-phone' : 'vibe-sheet-app');
      fs.unlinkSync(page);
    }

    // A device that chose sapphire under an older Sentinel kept an older set of its colours: the marketing pages work
    // the set out again and draw all of it, instead of a page half in the old look until the app is opened.
    await ev(`(localStorage.setItem('sentinel:theme', 'dark'), localStorage.setItem('sentinel:accent', 'sapphire'), localStorage.setItem('sentinel:look-vars', JSON.stringify({ v: 2, accent: 'sapphire', dark: { '--gold-400': '#5d8fe0' }, light: { '--gold-400': '#2f5fb0' } })), 1)`);
    await goto(browser, s, `${sentinel.base}/pricing?at=${Date.now()}`, "document.querySelector('.nav__inner')");
    const old = await until(browser, s, "(() => { const v = JSON.parse(localStorage.getItem('sentinel:look-vars') || '{}'); const n = document.documentElement.style.getPropertyValue('--night-rgb'); return v.v === SentinelLook.WEB_V && n ? { v: v.v, night: n, text: document.documentElement.style.getPropertyValue('--text') } : null; })()", 10000);
    result('vibe: a colour kept by an older Sentinel is worked out again on the marketing pages, not drawn half in the old look', Boolean(old) && old.text === L.ramp('sapphire', 'dark')['--text'], old);

    // Settings in a phone's browser, without the Windows app: what needs the app is named, with no dead switches.
    await store('dark', 'sapphire');
    await goto(browser, s, `${sentinel.base}/app/settings?at=${Date.now()}`, "document.querySelector('[data-set-row]')");
    await sleep(1200);
    const set = await ev("({ dead: [...document.querySelectorAll('.set-row .switch')].filter((x) => x.offsetParent && x.disabled).length, rows: document.querySelectorAll('.set-row--app').length, tall: document.documentElement.scrollHeight })");
    await shot(browser, s, 'vibe-app-settings-phone');
    result("vibe: Settings in a phone's browser names what needs the Windows app, without a wall of dead switches", set.dead === 0 && set.rows > 0, set);

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, s);
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
