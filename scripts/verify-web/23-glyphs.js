'use strict';
/**
 * glyphs    The glyph field behind "How it works" (glyphs.js), at a computer's and a phone's size, dark and light:
 *           it draws and moves while the chapter is on screen, the pointer brightens it, scrolling moves its bands
 *           on, it stops once the chapter is off screen, it stays under its brightness cap and clear of the kicker, so
 *           every line of text in front of it keeps its contrast (worked out on the real colours), and under reduced motion it is one still
 *           field. Frames are photographed mid-motion to look at.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, sleep, result, serveFiles, launch, evalIn, openPage, goto, shot } = require('./_shared');

const MOUSE = `(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /hover: hover|pointer: fine/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); })();`;

/** Runs in the page: the canvas's brightest alpha, and a fingerprint of its pixels. */
const PIXELS = `(() => {
  const c = document.querySelector('#how > .glyph-field');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let max = 0, sum = 0, lit = 0;
  for (let i = 3; i < d.length; i += 4) { const a = d[i]; if (a > max) max = a; if (a) lit++; sum = (sum * 31 + a + d[i - 3]) % 1000000007; }
  return { max, lit, sum, w: c.width, h: c.height, cssW: c.clientWidth };
})()`;

/** Runs in the page: every line of text in the chapter against the page colour lit by the brightest glyph. */
const CONTRAST = `(() => {
  const S = window.SentinelGlyphs.state();
  const rgb = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const hex = (s) => { const v = s.trim().replace('#', ''); return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: 1 }; };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
  const ratio = (x, y) => { const [h, l] = [lum(x), lum(y)].sort((p, q) => q - p); return (h + 0.05) / (l + 0.05); };
  const cs = getComputedStyle(document.documentElement);
  const bg = hex(cs.getPropertyValue('--bg'));
  const light = S.theme === 'light';
  const inks = (light ? ['--text-2', '--gold-400'] : ['--gold-200', '--gold-500']).map((n) => hex(cs.getPropertyValue(n)));
  const out = [];
  const walker = document.createTreeWalker(document.getElementById('how'), NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!walker.currentNode.nodeValue.trim() || seen.has(el)) continue;
    seen.add(el);
    // A box with its own solid background (the samples) hides the field.
    let covered = false;
    for (let e = el; e && e.id !== 'how'; e = e.parentElement) if (rgb(getComputedStyle(e).backgroundColor).a > 0.9) covered = true;
    const st = getComputedStyle(el);
    const fg = rgb(st.color);
    if (covered || fg.a < 0.5) continue;
    const size = parseFloat(st.fontSize), large = size >= 24 || (size >= 18.66 && Number(st.fontWeight) >= 700);
    // The field behind this line at its brightest: the cap, times how much of the field shows there.
    const top = document.getElementById('how').getBoundingClientRect().top, box = el.getBoundingClientRect();
    let shows = 0;
    for (let i = 0; i <= 8; i++) shows = Math.max(shows, window.SentinelGlyphs.veil(box.top - top + (box.height * i) / 8, S.h, S.clear));
    const worst = Math.min(...inks.map((ink) => ratio(fg, mix(bg, ink, S.max * shows))));
    out.push({ text: walker.currentNode.nodeValue.trim().slice(0, 30), shows: Math.round(shows * 100) / 100, ratio: Math.round(worst * 100) / 100,
      plain: Math.round(ratio(fg, bg) * 100) / 100, need: large ? 3 : 4.5 });
  }
  return out;
})()`;

async function checkGlyphs() {
  if (!fs.existsSync(path.join(STATIC, 'assets', 'js', 'glyphs.js'))) throw new Error(`no static build with the glyph field in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  const errors = [];
  browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
  const open = async ({ phone, theme, reduce }) => {
    const { sessionId } = await openPage(browser);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }, { name: 'prefers-color-scheme', value: theme }] }, sessionId);
    if (phone) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    } else {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: MOUSE }, sessionId);
    }
    await goto(browser, sessionId, `${files.base}/index.html`, "window.SentinelGlyphs && document.querySelector('#how > .glyph-field')");
    const ev = (expr) => evalIn(browser, sessionId, expr);
    // To the chapter, its head at the top of the screen, as a tab's jump lands it.
    await ev("document.getElementById('how').scrollIntoView({ block: 'start' }); true");
    await sleep(1800);
    return { s: sessionId, ev };
  };
  const state = 'window.SentinelGlyphs.state()';
  try {
    for (const phone of [false, true]) {
      for (const theme of ['dark', 'light']) {
        const tag = `${phone ? 'phone' : 'desktop'} ${theme}`;
        const p = await open({ phone, theme });
        await shot(browser, p.s, `glyphs-${phone ? 'phone' : 'desktop'}-${theme}-a`);
        // Fifteen more frames, each moving the bands on, counted from here. Waited for (up to 8 s) rather than
        // expected in a fixed second and a half: the first page in a fresh CI Chrome has drawn 10 and 14 frames in that
        // window (runs 40739408677, 40749085498) where the same page usually draws over 50, still moving, and how fast
        // a shared runner paints is not what this proves.
        const a = await p.ev(state);
        const pa = await p.ev(PIXELS);
        const t0 = Date.now();
        let b = a;
        for (; Date.now() - t0 < 8000 && (b.frames - a.frames < 15 || Date.now() - t0 < 1500);) { await sleep(250); b = await p.ev(state); }
        const ms = Date.now() - t0;
        const pb = await p.ev(PIXELS);
        await shot(browser, p.s, `glyphs-${phone ? 'phone' : 'desktop'}-${theme}-b`);
        result(`glyphs ${tag}: the field draws and moves while the chapter is on screen`, b.running && b.frames - a.frames >= 15 && b.phase > a.phase && pa.sum !== pb.sum && pb.lit > 1000 && b.theme === theme,
          { before: a, after: b, ms, fps: Math.round(((b.frames - a.frames) * 10000) / ms) / 10, pixels: [pa, pb] });
        // Crisp: drawn at the screen's own pixel ratio, or as near it as the pixel budget allows.
        result(`glyphs ${tag}: drawn at the screen's pixel ratio (or near it on a very tall phone section)`, Math.abs(pb.w / pb.cssW - b.dpr) < 0.02 && b.dpr >= (phone ? 1.9 : 1), { dpr: b.dpr, w: pb.w, cssW: pb.cssW });
        const cap = Math.round(b.max * 255) + 2;
        const lines = await p.ev(CONTRAST);
        // A line the field takes under the bar fails; one already under it on the bare page (the light theme's gold
        // kicker, 4.39:1) is the site's own colour, not the field's, and must have nothing behind it.
        const low = lines.filter((l) => l.ratio < l.need && (l.plain >= l.need || l.shows > 0));
        result(`glyphs ${tag}: never brighter than its cap, and every line in front of it keeps its contrast`, pa.max <= cap && pb.max <= cap && lines.length >= 10 && !low.length,
          { brightest: [pa.max, pb.max], cap, checked: lines.length, low, alreadyLow: lines.filter((l) => l.plain < l.need), sample: lines.slice(0, 4) });

        if (!phone) {
          // The pointer brightens the glyphs near it.
          await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 400, button: 'none' }, p.s);
          await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 420, button: 'none' }, p.s);
          await sleep(900);
          const g = await p.ev(state);
          await shot(browser, p.s, `glyphs-desktop-${theme}-pointer`);
          await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 5, button: 'none' }, p.s);
          result(`glyphs ${tag}: the pointer brightens the glyphs near it`, g.glow > 0.6, { glow: g.glow });
        }

        // Scrolling moves the bands on a little.
        const s0 = await p.ev(state);
        await p.ev('scrollBy(0, 300); true');
        await sleep(900);
        const s1 = await p.ev(state);
        result(`glyphs ${tag}: scrolling moves the bands on`, s1.scroll - s0.scroll > 0.08 && s1.scroll - s0.scroll < 0.2, { before: s0.scroll, after: s1.scroll });

        // Off screen, it stops.
        await p.ev('scrollTo(0, 0); true');
        await sleep(1200);
        const o1 = await p.ev(state);
        await sleep(1200);
        const o2 = await p.ev(state);
        result(`glyphs ${tag}: it stops once the chapter is off screen`, !o2.running && o2.frames === o1.frames, { first: o1.frames, then: o2.frames, running: o2.running });
      }
    }

    // Reduced motion: one still field, drawn and left.
    for (const theme of ['dark', 'light']) {
      const r = await open({ phone: false, theme, reduce: true });
      const a = await r.ev(state);
      const pa = await r.ev(PIXELS);
      await sleep(1500);
      const b = await r.ev(state);
      const pb = await r.ev(PIXELS);
      await shot(browser, r.s, `glyphs-reduced-${theme}`);
      result(`glyphs reduced motion ${theme}: one still field`, !b.running && b.frames === a.frames && pa.sum === pb.sum && pb.lit > 1000, { frames: [a.frames, b.frames], lit: pb.lit });
    }
    result('glyphs: no errors in the page', !errors.length, errors);
  } finally {
    await close();
    files.server.close();
  }
}

module.exports = checkGlyphs;
