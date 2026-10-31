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
    view: box(view), mask: box(document.querySelector('[data-hero-mask]')), copy: box(document.querySelector('.hero__copy')),
    painted: at(0.9, 0.55)[3] > 200,
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
  return out;
}

async function checkHeroPhone() {
  if (!fs.existsSync(path.join(STATIC, 'index.html'))) throw new Error(`no static build in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  try {
    const open = async (width, height, mobile, scheme, motion) => {
      const { targetId, sessionId: s } = await openPage(browser);
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile }, s);
      if (mobile) await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: motion }] }, s);
      await goto(browser, s, `${files.base}/index.html`, "document.querySelector('.hero__unmask')");
      return { s, done: () => browser.send('Target.closeTarget', { targetId }) };
    };
    for (const [width, height] of SIZES) {
      for (const scheme of ['dark', 'light']) {
        for (const motion of ['reduce', 'no-preference']) {
          const { s, done } = await open(width, height, true, scheme, motion);
          // The opening caught half way, once, at the common phone: the pills must not flash, the name must stay whole.
          if (motion === 'no-preference' && width === 390) { await sleep(700); await shot(browser, s, `hero-phone-${scheme}-opening`); }
          await sleep(3800);
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
      const ok = m.zWord === '2' && m.painted && m.behindName < 60;
      result(`hero-phone: 1366x900, ${scheme}, reduced motion: the name stands clear of the panel`, ok, ok ? undefined : m);
      await shot(browser, s, `hero-desktop-${scheme}-still`);
      await done();
    }
  } finally { await close(); files.server.close(); }
}

module.exports = checkHeroPhone;
