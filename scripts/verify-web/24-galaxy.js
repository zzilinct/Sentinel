'use strict';
/**
 * galaxy    The home page's galaxy of scam scenes (galaxy.js), on a computer and a phone, dark and light: it draws
 *           frame after frame, its cards travel clockwise, a card under the pointer stops and shows Sentinel's verdict,
 *           a click enlarges it with its caption, the list works from the keyboard, it rests off screen and in a hidden
 *           tab, and under reduced motion it is one still spiral. Photographs the motion as it runs.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, sleep, result, serveFiles, launch, evalIn, openPage, goto, shot, pressEnter } = require('./_shared');

// A headless browser reports no mouse; this says there is one, as a desktop browser would.
const MOUSE = `(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /hover: hover|pointer: fine/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); })();`;
const STATE = 'window.SentinelGalaxy.state()';
const INTO_VIEW = "document.querySelector('[data-galaxy]').scrollIntoView({ block: 'center', behavior: 'instant' }); true";

// The change of each card's angle round the centre between two looks, for the cards seen in both.
function turns(a, b) {
  const out = [];
  for (const c of a.cards) {
    const d = b.cards.find((x) => x.k === c.k);
    if (!d || c.alpha < 0.5 || d.alpha < 0.5 || c.r < 60 || c.scene !== d.scene || d.r < c.r - 50) continue;   // one that wrapped round is a new journey
    let t = d.angle - c.angle;
    while (t > Math.PI) t -= 2 * Math.PI;
    while (t <= -Math.PI) t += 2 * Math.PI;
    out.push(t);
  }
  return out;
}

// The best card to point at: whole, clear of the stage's edges and the mark, and large.
function pick(st) {
  const { width: W, height: H } = st.stage;
  const m = W < 600 ? 4 : 40;
  return st.cards.filter((c) => c.alpha > 0.9 && c.w > 40 && c.r > (W < 600 ? 70 : 110) && c.x - c.w / 2 > m && c.x + c.w / 2 < W - m && c.y - c.h / 2 > H * 0.16 && c.y + c.h / 2 < H * 0.84)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
}

async function checkGalaxy() {
  if (!fs.existsSync(path.join(STATIC, 'assets', 'js', 'galaxy.js'))) throw new Error(`no static build with the galaxy in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  const errors = [];
  browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
  browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
  const imgs = () => files.log.filter((u) => /assets\/img\/(galaxy|masks)\//.test(u));

  const open = async ({ phone, theme, reduce }) => {
    const { targetId, sessionId: s } = await openPage(browser);
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] }, s);
    if (phone) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, s);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
    } else {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
      await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: MOUSE }, s);
    }
    await goto(browser, s, `${files.base}/index.html`, 'window.SentinelGalaxy');
    const ev = (expr) => evalIn(browser, s, expr);
    return { s, ev, st: () => ev(STATE), close: () => browser.send('Target.closeTarget', { targetId }).catch(() => {}) };
  };
  const mouse = (s, type, x, y) => browser.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }, s);
  const settle = async (p) => {
    await p.ev(INTO_VIEW);
    for (let i = 0; i < 60; i++) { const st = await p.st(); if (st.drawn > 0 && st.loaded >= Math.min(st.n, 10)) break; await sleep(250); }
  };

  try {
    // The pictures wait until the chapter is near.
    const early = await open({ theme: 'dark' });
    await sleep(1500);
    const before = imgs().filter((u) => /galaxy\//.test(u)).length;
    result('galaxy: its pictures are not fetched until the chapter is near', before === 0, { fetched: before });
    await early.close();

    for (const theme of ['dark', 'light']) {
      for (const phone of [false, true]) {
        const at = `${phone ? 'phone' : 'computer'} ${theme}`;
        const name = `galaxy-${phone ? 'phone' : 'desktop'}-${theme}`;
        const p = await open({ phone, theme });
        await settle(p);
        await sleep(4200);   // the arrival wave and the burst have played

        /* It runs, and turns clockwise. */
        const a = await p.st();
        await sleep(1500);
        const b = await p.st();
        await shot(browser, p.s, `${name}-motion`);

        /* The spiral reads: many small cards, their centres on the arms' curves. */
        const inStage = (c) => c.alpha > 0.5 && c.w > 0 && c.x > 0 && c.y > 0 && c.x < b.stage.width && c.y < b.stage.height;
        const vis = b.cards.filter(inStage);
        const onArm = vis.filter((c) => c.armDist !== null && c.armDist <= (phone ? 10 : 12));
        const widths = vis.map((c) => c.w).sort((x, y) => x - y);
        const medW = widths[Math.floor(widths.length / 2)] || 0;
        const share = vis.length ? onArm.length / vis.length : 0;
        result(`galaxy (${at}): the spiral reads (many small cards, centred on the arms' curves)`,
          vis.length >= (phone ? 14 : 35) && share >= 0.85 && medW <= b.stage.width * (phone ? 0.27 : 0.15),
          { visible: vis.length, onArm: onArm.length, share: +share.toFixed(2), medianCardWidth: Math.round(medW), stageWidth: b.stage.width,
            armDist: vis.map((c) => c.armDist).sort((x, y) => x - y).slice(-5) });

        /* Nothing sits on the cards: the chapter rail, the heading and its words; the hint is below the stage. */
        const layout = await p.ev(`(() => {
          const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
          const rail = document.querySelector('.rail');
          const railBox = rail && rail.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ? box(rail.getBoundingClientRect()) : null;
          const texts = [];
          for (const el of document.querySelectorAll('#masquerade .section__head h2, #masquerade .section__head p')) {
            const range = document.createRange();
            range.selectNodeContents(el);
            for (const r of range.getClientRects()) if (r.width > 1) texts.push(box(r));
          }
          const head = document.querySelector('#masquerade .section__head').getBoundingClientRect();
          const stage = document.querySelector('[data-galaxy]').getBoundingClientRect();
          const hint = document.querySelector('.galaxy__hint').getBoundingClientRect();
          return { rail: railBox, railExists: Boolean(rail), texts, headBottom: head.bottom, stageTop: stage.top, stageBottom: stage.bottom, hintTop: hint.top };
        })()`);
        const cardBoxes = b.cards.filter((c) => c.alpha > 0.3 && c.w > 0).map((c) => ({ k: c.k, l: b.stage.left + c.x - c.w / 2, t: b.stage.top + c.y - c.h / 2, r: b.stage.left + c.x + c.w / 2, bt: b.stage.top + c.y + c.h / 2 }))
          .map((c) => ({ k: c.k, l: Math.max(c.l, b.stage.left), r: c.r, t: Math.max(c.t, b.stage.top), b: Math.min(c.bt, b.stage.top + b.stage.height) }));   // the canvas clips what passes its edges
        const hit = (x, y) => x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b;
        const onRail = layout.rail ? cardBoxes.filter((c) => hit(c, layout.rail)).map((c) => c.k) : [];
        const onText = cardBoxes.filter((c) => layout.texts.some((t) => hit(c, t))).map((c) => c.k);
        result(`galaxy (${at}): no card under the chapter rail or the heading's words; the stage starts below the heading, the hint below the stage`,
          !onRail.length && !onText.length && layout.stageTop >= layout.headBottom - 1 && layout.hintTop >= layout.stageBottom - 1,
          { railShown: Boolean(layout.rail), railExists: layout.railExists, onRail, onText, headBottom: Math.round(layout.headBottom), stageTop: Math.round(layout.stageTop),
            stageBottom: Math.round(layout.stageBottom), hintTop: Math.round(layout.hintTop) });
        const d = turns(a, b);
        const cw = d.filter((t) => t > 0).length;
        const median = d.slice().sort((x, y) => x - y)[Math.floor(d.length / 2)] || 0;
        result(`galaxy (${at}): it draws frame after frame, with ${phone ? 'the phone profile (3 arms, 36 cards or fewer)' : '6 arms'}`,
          b.running && b.frames - a.frames >= 15 && (phone ? b.mobile && b.arms === 3 && b.n <= 36 : !b.mobile && b.arms === 6 && b.n >= 20),
          { frames: b.frames - a.frames, mobile: b.mobile, arms: b.arms, n: b.n, active: b.active, loaded: b.loaded, stage: b.stage });
        result(`galaxy (${at}): the cards travel clockwise`, d.length >= 4 && cw / d.length >= 0.75 && median > 0,
          { cards: d.length, clockwise: cw, medianDeg: +(median * 180 / Math.PI).toFixed(2) });

        /* Pointing (a computer) or tapping (a phone) at a card stops it and shows its verdict; a click enlarges it. */
        let c = pick(b) || pick(await p.st());
        if (!c) { result(`galaxy (${at}): a card to point at`, false, b.cards.slice(0, 6)); await p.close(); continue; }
        let x = b.stage.left + c.x;
        let y = b.stage.top + c.y;
        if (!phone) {
          // On a busy runner a card can travel off the point aimed at before the pointer lands (runs 38810392580 and
          // 40222297518): then it is aimed at again where it is now, up to three times.
          for (let i = 0; i < 3; i++) {
            await mouse(p.s, 'mouseMoved', x, y);
            await sleep(900);
            if ((await p.st()).held !== null) break;
            await mouse(p.s, 'mouseMoved', 5, 5);
            await sleep(400);
            const now = await p.st();
            const n = pick(now);
            if (n) { c = n; x = now.stage.left + c.x; y = now.stage.top + c.y; }
          }
          const h1 = await p.st();
          await sleep(700);
          const h2 = await p.st();
          const k1 = h1.cards.find((k) => k.k === h1.held);
          const k2 = h2.cards.find((k) => k.k === h2.held);
          const moved = k1 && k2 ? Math.hypot(k2.x - k1.x, k2.y - k1.y) : -1;
          await shot(browser, p.s, `${name}-hover`);
          result(`galaxy (${at}): the card under the pointer stops and shows Sentinel's verdict`,
            h2.held !== null && h1.held === h2.held && moved >= 0 && moved < 3 && h2.tag && h2.tag === (k2 && k2.tag),
            { aimedAt: c.k, under: await p.ev(`(() => { const e = document.elementFromPoint(${x}, ${y}); return e ? e.tagName + '.' + e.className : ''; })()`), held: h2.held, movedPx: +moved.toFixed(2), tag: h2.tag, want: k2 && k2.tag });
          await mouse(p.s, 'mousePressed', x, y);
          await mouse(p.s, 'mouseReleased', x, y);
        } else {
          await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }, p.s);
          await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, p.s);
        }
        await sleep(900);
        const e = await p.st();
        const big = e.cards.find((k) => k.k === e.boosted);
        await shot(browser, p.s, `${name}-click`);
        result(`galaxy (${at}): ${phone ? 'a tap' : 'a click'} enlarges the card with its caption${phone ? ' and verdict' : ''}`,
          e.boosted !== null && big && big.w >= Math.max(c.w * 1.8, e.stage.width * 0.3) && e.caption.length > 20 && (!phone || e.tag),
          { boosted: e.boosted, was: Math.round(c.w), now: big && Math.round(big.w), caption: e.caption, tag: e.tag });
        if (!phone) { await mouse(p.s, 'mouseMoved', 5, 5); await sleep(600); }

        /* The keyboard: the list's buttons are the cards. */
        if (!phone) {
          const want = await p.ev("(() => { const b = document.querySelectorAll('.galaxy__list button')[5]; b.focus(); return { tag: b.dataset.tag, caption: b.dataset.caption, n: document.querySelectorAll('.galaxy__list button').length, label: b.closest('ol').getAttribute('aria-label') }; })()");
          await sleep(500);
          const f1 = await p.st();
          await pressEnter(browser, p.s);
          await sleep(900);
          const f2 = await p.st();
          await shot(browser, p.s, `${name}-keyboard`);
          result(`galaxy (${at}): tabbing to a scene in the list holds its card with its verdict, and Enter enlarges it`,
            want.n >= 40 && want.label && f1.held !== null && f1.tag === want.tag && f2.boosted !== null && f2.caption === want.caption,
            { scenes: want.n, label: want.label, held: f1.held, tag: f1.tag, want: want.tag, boosted: f2.boosted, caption: f2.caption });
          await p.ev('document.activeElement.blur(); true');
        }

        /* It rests off screen and in a hidden tab. */
        await p.ev("scrollTo({ top: 0, behavior: 'instant' }); true");
        await sleep(900);
        const o1 = await p.st();
        await sleep(1200);
        const o2 = await p.st();
        await p.ev(INTO_VIEW);
        await sleep(900);
        const back = await p.st();
        await p.ev("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); true");
        await sleep(500);
        const v1 = await p.st();
        await sleep(1200);
        const v2 = await p.st();
        await p.ev("delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); true");
        result(`galaxy (${at}): it draws nothing off screen or in a hidden tab, and wakes when back`,
          !o2.running && o2.frames === o1.frames && back.frames > o2.frames && !v2.running && v2.frames === v1.frames,
          { offscreen: [o1.frames, o2.frames, o2.running], back: back.frames, hidden: [v1.frames, v2.frames, v2.running] });
        await p.close();
      }
    }

    /* Reduced motion: one still spiral, still answering the pointer. */
    const r = await open({ theme: 'dark', reduce: true });
    await settle(r);
    await sleep(1200);
    const r1 = await r.st();
    await sleep(1500);
    const r2 = await r.st();
    await shot(browser, r.s, 'galaxy-reduced');
    const same = r1.cards.every((c, i) => Math.abs(c.x - r2.cards[i].x) < 0.01 && Math.abs(c.y - r2.cards[i].y) < 0.01);
    const visible = r2.cards.filter((c) => c.alpha > 0.5 && c.w > 20).length;
    const rc = pick(r2);
    let tag = '';
    if (rc) {
      await mouse(r.s, 'mouseMoved', r2.stage.left + rc.x, r2.stage.top + rc.y);
      await sleep(500);
      tag = (await r.st()).tag;
    }
    result('galaxy (reduced motion): a still, arranged spiral (no frames run, nothing moves) that still shows a verdict under the pointer',
      r2.reduced && r2.frames === 0 && r2.drawn > 0 && same && visible >= 10 && Boolean(tag),
      { frames: r2.frames, drawn: r2.drawn, still: same, visible, tag });

    const bytes = imgs().length;
    result('galaxy: no console errors', !errors.length, errors.concat(`pictures fetched: ${bytes}`));
  } finally {
    await close();
    files.server.close();
  }
}

module.exports = checkGalaxy;
