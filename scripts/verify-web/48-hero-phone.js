'use strict';
/**
 * hero-phone  The home page's first screen on a phone: at every width, in dark and in light, with a finger and with
 *             reduced motion, the whole name SENTINEL is on the screen and nothing crosses it, the mask stands inside
 *             its niche, the niche is really drawn, and the two warnings are inside it. Then the large screen's still
 *             view, where the name must stand in front of what Sentinel sees. Everything is photographed.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, sleep, result, serveFiles, launch, evalIn, openPage, goto, shot } = require('./_shared');

// The memory the canvases of the old hero took at 390x844 (a stage 370 by 234 at 1.5x, twice, and the brush's two).
const CANVAS_BYTES = 1730000;
// Every 2D canvas a page uses, to count what stays in memory.
const COUNT = `window.__canvases = new Set(); { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (t === '2d') window.__canvases.add(this); return get.call(this, t, ...a); }; }`;
const SIZES = [[320, 568], [360, 640], [390, 844], [412, 915], [430, 932], [768, 1024]];

// What a person sees of the name, of the mask and of the niche, and what was drawn in the niche.
const MEASURE = `(() => {
  const box = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const word = document.querySelector('[data-hero-word]');
  const range = document.createRange();
  range.selectNodeContents(word);
  const view = document.querySelector('.hero__unmask');
  const pic = view.getContext('2d');
  const at = (x, y) => [...pic.getImageData(Math.round(view.width * x), Math.round(view.height * y), 1, 1).data];
  const name = box(range);
  return { W: innerWidth, sideways: document.documentElement.scrollWidth - innerWidth, text: word.textContent, word: name,
    held: [...window.__canvases].filter((c) => c !== view && !c.isConnected && c.width * c.height > 0 && ((c.width === view.width && c.height === view.height) || (c.width === Math.round(view.clientWidth * 0.5) && c.height === Math.round(view.clientHeight * 0.5)))).length,
    viewBytes: view.width * view.height * 4, cta: box(document.querySelector('.hero__cta .btn')), ctaOpacity: getComputedStyle(document.querySelector('.hero .hero__cta')).opacity, H: innerHeight, banner: Boolean(document.querySelector('.prelaunch')),
    view: box(view), mask: box(document.querySelector('[data-hero-mask]')), copy: box(document.querySelector('.hero__copy')),
    painted: Math.max(...pic.getImageData(Math.round(view.width * 0.7), Math.round(view.height * 0.6), 60, 60).data.filter((_, i) => i % 4 === 3)) > 200,
    behindName: at(0.75, ((name.top + name.bottom) / 2 - box(view).top) / view.clientHeight)[3], shown: getComputedStyle(view).visibility === 'visible', clip: getComputedStyle(view).clipPath,
    zWord: getComputedStyle(word).zIndex };
})()`;

function phoneProblems(m) {
  const out = [];
  if (m.sideways > 0) out.push(`scrolls sideways by ${m.sideways}`);
  if (m.text !== 'SENTINEL') out.push(`the name reads ${m.text}`);
  if (m.word.left < 10 || m.word.right > m.W - 10) out.push(`the name is not whole on the screen: ${Math.round(m.word.left)} to ${Math.round(m.word.right)} of ${m.W}`);
  if (m.word.bottom > m.view.top + 1) out.push(`the niche crosses the name by ${Math.round(m.word.bottom - m.view.top)} px`);
  if (m.mask.top < m.view.top || m.mask.bottom > m.view.bottom || m.mask.left < m.view.left || m.mask.right > m.view.right) out.push('the mask leaves its niche');
  if (m.mask.top < m.word.bottom) out.push('the mask crosses the name');
  if (m.view.bottom > m.copy.top) out.push('the niche runs into the words under it');
  if (!m.painted || !m.shown) out.push(`the niche is not drawn (painted ${m.painted}, shown ${m.shown})`);
  if (Math.abs((m.word.left + m.word.right) / 2 - m.W / 2) > 4) out.push('the name is off centre');
  if (!m.banner) out.push('no Preview banner: the first screen was not measured at its fullest');
  // 320x568 is the one size where the button does not fit; every other must hold it.
  if (m.W >= 360 && m.cta.bottom > m.H) out.push(`the button is below the fold: ${Math.round(m.cta.bottom)} of ${m.H}`);
  if (m.held) out.push(`${m.held} working canvases still hold memory`);
  if (m.W <= 430 && m.viewBytes > CANVAS_BYTES * (m.W / 390) ** 2) out.push(`the niche holds ${m.viewBytes} bytes`);
  if (m.W >= 360 && m.ctaOpacity !== '1') out.push(`the button is not shown yet (opacity ${m.ctaOpacity})`);
  return out;
}

async function checkHeroPhone() {
  if (!fs.existsSync(path.join(STATIC, 'index.html'))) throw new Error(`no static build in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  try {
    const open = async (width, height, mobile, scheme, motion) => {
      const { targetId, sessionId: s } = await openPage(browser);
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile }, s);
      await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT }, s);
      if (mobile) await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: motion }] }, s);
      await goto(browser, s, `${files.base}/index.html`, "document.querySelector('.hero__unmask')");
      return { s, done: () => browser.send('Target.closeTarget', { targetId }) };
    };
    for (const [width, height] of SIZES) {
      for (const scheme of ['dark', 'light']) {
        for (const motion of ['reduce', 'no-preference']) {
          const { s, done } = await open(width, height, true, scheme, motion);
          // The opening, stopped part way at the common phone (a picture cannot catch it on CI's slow machine), then let go.
          if (motion === 'no-preference' && width === 390) {
            const stopped = await evalIn(browser, s, `new Promise((done) => { const t0 = performance.now(); (function look() {
              const a = document.querySelector('.hero__unmask').getAnimations()[0];
              if (a) { a.pause(); a.currentTime = 640; requestAnimationFrame(() => done(getComputedStyle(a.effect.target).clipPath)); }
              else if (performance.now() - t0 > 20000) done('none'); else requestAnimationFrame(look); })(); })`, { awaitPromise: true });
            result(`hero-phone: 390x844, ${scheme}: it opens from behind the mask, once`, /^circle\(/.test(stopped), { stopped });
            await shot(browser, s, `hero-phone-${scheme}-opening`);
            await evalIn(browser, s, "document.querySelector('.hero__unmask').getAnimations()[0].play(); true");
          }
          // Once the page's entrance has reached the button (a slow machine takes its time), and it has finished.
          for (let i = 0; i < 60 && !(await evalIn(browser, s, "getComputedStyle(document.querySelector('.hero .hero__cta')).opacity === '1'")); i++) await sleep(250);
          await sleep(2600);
          const m = await evalIn(browser, s, MEASURE);
          const bad = phoneProblems(m);
          if (m.clip !== 'none') bad.push(`still clipped after opening: ${m.clip}`);
          result(`hero-phone: ${width}x${height}, ${scheme}, ${motion === 'reduce' ? 'reduced motion' : 'a finger'}: the whole name reads and nothing crosses it`, bad.length === 0, bad.length ? { bad, m } : undefined);
          await shot(browser, s, `hero-phone-${width}-${scheme}-${motion === 'reduce' ? 'still' : 'touch'}`);
          await done();
        }
      }
    }
    // A large screen's still view (no brush): what Sentinel sees stays, so the name must stand in front of it.
    for (const scheme of ['dark', 'light']) {
      const { s, done } = await open(1366, 900, false, scheme, 'reduce');
      await sleep(2500);
      const m = await evalIn(browser, s, MEASURE);
      // The panel dissolves into the page: nothing left at the stage's right or bottom edge to make a hard line.
      const edges = await evalIn(browser, s, `(() => { const v = document.querySelector('.hero__unmask'); const p = v.getContext('2d');
        return Math.max(...[[v.width - 2, v.height / 2], [v.width * 0.76, v.height - 2], [v.width * 0.76, 2]].map(([x, y]) => p.getImageData(Math.round(x), Math.round(y), 1, 1).data[3])); })()`);
      m.edges = edges;
      const ok = m.zWord === '2' && m.painted && m.behindName < 60 && edges < 8 && m.held === 0;
      result(`hero-phone: 1366x900, ${scheme}, reduced motion: the name stands clear of the panel`, ok, ok ? undefined : m);
      await shot(browser, s, `hero-desktop-${scheme}-still`);
      await done();
    }
  } finally { await close(); files.server.close(); }
}

module.exports = checkHeroPhone;
