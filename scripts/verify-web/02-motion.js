'use strict';
/**
 * motion    The scroll motion (motion.js): Lenis smooths the wheel on a computer, never on a touch screen or under
 *           reduced motion, and every scroll the page makes (a tab's jump, an anchor, back to top) lands exactly.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, sleep, result, serveFiles, launch, evalIn, openPage, goto } = require('./_shared');

/* ------------------------------------------------------- 1b. scroll motion */

// A headless browser reports no mouse; this says there is one, as a desktop browser would (as review-shots does).
const MOUSE = `(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /hover: hover|pointer: fine/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); })();`;

async function checkMotion() {
  if (!fs.existsSync(path.join(STATIC, 'assets', 'js', 'vendor', 'gsap.min.js'))) throw new Error(`no static build with the scroll motion in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  const errors = [];
  browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
  browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
  const open = async ({ mouse, touch, reduce }) => {
    const { sessionId } = await openPage(browser);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] }, sessionId);
    if (touch) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    }
    if (mouse) await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: MOUSE }, sessionId);
    await goto(browser, sessionId, `${files.base}/index.html`, 'window.SentinelMotion');
    await sleep(1200);
    return { s: sessionId, ev: (expr) => evalIn(browser, sessionId, expr) };
  };
  const state = "({ lenis: document.documentElement.classList.contains('lenis'), scroller: Boolean(window.SentinelScroll), coarse: matchMedia('(pointer: coarse)').matches, lasers: document.querySelectorAll('.laser').length })";
  try {
    /* A computer: Lenis glides the wheel, rests when done, and every scroll the page makes lands where it should. */
    const d = await open({ mouse: true });
    const on = await d.ev(state);
    result('motion: on a computer, Lenis smooths the scroll', on.lenis && on.scroller, on);
    // The first 3D mask is built in a quiet moment after load (mask3d.js): its shaders and studio light took 1 to 2
    // seconds of one frame in this runner's software WebGL, and a wheel turned then landed in that one frame. The
    // glide is looked at once the first mask is up.
    for (let i = 0; i < 100 && !(await d.ev("!document.querySelector('[data-mask3d]') || Boolean(document.querySelector('.mask3d--ready'))")); i++) await sleep(200);
    await sleep(500);
    // Where the page is, frame by frame, recorded in the page: a sample taken 90 ms later by this script's own clock
    // came back after the glide had landed whenever the runner was busy (the call and the frames run late, not the glide).
    await d.ev("(() => { const f = window.__glide = []; const t0 = performance.now(); addEventListener('wheel', () => { window.__wheelAt = Math.round(performance.now() - t0); }, { once: true, capture: true }); const rec = () => { f.push([Math.round(performance.now() - t0), Math.round(scrollY), window.SentinelScroll.ticking]); if (performance.now() - t0 < 20000) requestAnimationFrame(rec); }; requestAnimationFrame(rec); return true; })()");
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 683, y: 450, deltaX: 0, deltaY: 600 }, d.s);
    // From the page's own state, not a fixed wait: the page can take the wheel seconds late on a busy runner.
    for (let i = 0; i < 75 && !(await d.ev('scrollY > 0')); i++) await sleep(200);
    for (let i = 0; i < 40 && await d.ev('window.SentinelScroll.ticking'); i++) await sleep(200);
    const end = await d.ev('({ y: scrollY, ticking: window.SentinelScroll.ticking, frames: window.__glide, wheelAt: window.__wheelAt })');
    // A glide: Lenis ticking, and the page part way, on frames that span at least 90 ms of the page's own time.
    const between = end.frames.filter(([, y, ticking]) => ticking && y > 0 && y < 598);
    const span = between.length ? between[between.length - 1][0] - between[0][0] : 0;
    result('motion: a turn of the wheel glides (part way for 90 ms and more, Lenis ticking), lands, and Lenis stops ticking', between.length >= 2 && span >= 90 && Math.abs(end.y - 600) <= 2 && !end.ticking, { wheelAt: end.wheelAt, partWay: between.length, spanMs: span, frames: end.frames.slice(Math.max(0, end.frames.findIndex(([, y]) => y > 0) - 3)).slice(0, 30).map(([t, y]) => `${t}:${y}`).join(' '), y: end.y, ticking: end.ticking });

    const lands = async (name, setup, measure, want) => {
      await d.ev(setup);
      await sleep(2200);
      const got = await d.ev(measure);
      result(`motion: ${name}`, Math.abs(got - want(got)) <= 2, { got, want: want(got) });
    };
    await lands('a tab\'s jump (under its wipe) lands its chapter just under the header', "scrollTo(0, 0); document.querySelector('.nav__links a[href*=\"#how\"]').click(); true",
      "document.getElementById('how').getBoundingClientRect().top - document.querySelector('[data-nav]').offsetHeight - 8", () => 0);
    await lands('an anchor link (the scroll cue) glides to its place', "scrollTo(0, 0); document.querySelector('.scroll-cue').click(); true",
      "document.getElementById('stage-demo').getBoundingClientRect().top - parseFloat(getComputedStyle(document.getElementById('stage-demo')).scrollMarginTop)", () => 0);
    await lands('back to top glides to the top', "scrollTo(0, 4000); setTimeout(() => document.querySelector('.to-top').click(), 300); true", 'scrollY', () => 0);
    // A chapter's head, scrolled to: the laser has played and gone, the heading has risen, the paragraph is full.
    await d.ev("document.querySelector('#masks .section__head').scrollIntoView({ block: 'start' }); true");
    await sleep(2500);
    const head = await d.ev(`(() => { const h = document.querySelector('#masks .section__head');
      return { risen: h.querySelector('h2').classList.contains('is-in'), laser: getComputedStyle(h.querySelector('.laser')).opacity,
        words: Math.min(...[...h.querySelectorAll('.wd')].map((w) => Number(getComputedStyle(w).opacity))) }; })()`);
    result('motion: a chapter scrolled to has its laser played and gone, its heading risen and its paragraph in full', head.risen && head.laser === '0' && head.words > 0.95, head);
    await d.ev("document.querySelector('.stats').scrollIntoView({ block: 'center' }); true");
    await sleep(2600);
    const stats = await d.ev("[...document.querySelectorAll('[data-count]')].map((el) => [el.textContent, Number(el.dataset.count).toLocaleString(), el.closest('.stat').querySelector('.stat__bar').getBoundingClientRect().width])");
    result('motion: the figures count up to their real numbers, with their bars grown', stats.length && stats.every(([t, n, w]) => t === n && w > 60), stats);

    /* A phone: its own scroll, untouched. Reduced motion: the browser's own scroll and no laser. */
    const t = await open({ touch: true });
    const tOn = await t.ev(state);
    // coarse says whether this browser's touch emulation also reports a coarse pointer, as a real phone does.
    result('motion: on a touch screen, Lenis stays off', !tOn.lenis && !tOn.scroller, tOn);
    const r = await open({ mouse: true, reduce: true });
    const rOn = await r.ev(state);
    const rStats = await r.ev("[...document.querySelectorAll('[data-count]')].every((el) => el.textContent === Number(el.dataset.count).toLocaleString())");
    result('motion: with reduced motion, Lenis and the lasers stay off and the figures stand at their numbers', !rOn.lenis && !rOn.scroller && !rOn.lasers && rStats, { ...rOn, figures: rStats });
    result('motion: no console errors', !errors.length, errors);
  } finally {
    await close();
    files.server.close();
  }
}

module.exports = checkMotion;
