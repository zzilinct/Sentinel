'use strict';
/**
 * practice  The practice inbox (/practice) sorts all twelve with Tab and Enter alone, at phone and computer width,
 *           marks each message's clues where they are, follows reduced motion, and sends nothing anywhere.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto } = require('./_shared');

/* ----------------------------------------------- 7. the practice inbox (/practice) */

async function checkPractice() {
  if (!fs.existsSync(path.join(STATIC, 'practice.html'))) throw new Error(`no practice page in ${STATIC}: run npm run build:static`);
  const P = require('../../web/assets/js/practice.js');
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  const errors = [];
  const requests = [];
  browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
  browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
  browser.on('Network.requestWillBeSent', (p) => requests.push(p.request.url));
  const key = async (s, k, code, vk) => {
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === 'keyDown' && k === 'Enter' ? { text: '\r' } : {}) }, s);
    await sleep(120);
  };
  const tab = (s) => key(s, 'Tab', 'Tab', 9);
  const enter = (s) => key(s, 'Enter', 'Enter', 13);
  // The whole inbox, not just the screen: a marked message and its clues run below the fold on a phone.
  const snap = async (s, name) => {
    try {
      const r = await evalIn(browser, s, "(() => { const r = document.querySelector('[data-practice]').getBoundingClientRect(); return { x: Math.max(0, r.left + scrollX - 12), y: Math.max(0, r.top + scrollY - 12), width: r.width + 24, height: r.height + 24 }; })()");
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r, scale: 1 } }, s);
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    } catch { /* a picture is a nicety */ }
  };
  const open = async ({ phone, reduce }) => {
    const { sessionId: s } = await openPage(browser);
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Network.enable', {}, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] }, s);
    if (phone) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, s);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
    }
    await goto(browser, s, `${files.base}/practice.html`, "document.querySelector('[data-practice] [data-pick]') && window.SentinelMotion");
    await sleep(1200);
    return s;
  };
  // What the page shows for the message on screen, after it was answered.
  const marked = (s) => evalIn(browser, s, `(() => {
    const marks = [...document.querySelectorAll('.pmsg .pmark')];
    return {
      shown: document.querySelector('.pmsg').classList.contains('is-marked') && marks.every((m) => getComputedStyle(m.querySelector('.pmark__n')).display !== 'none' && getComputedStyle(m).boxShadow !== 'none'),
      texts: marks.map((m) => m.firstChild.textContent), numbers: marks.map((m) => Number(m.dataset.clue)),
      clues: document.querySelectorAll('.practice__clues li').length, focus: document.activeElement && document.activeElement.matches('[data-practice-verdict]') ? 'verdict' : String(document.activeElement && document.activeElement.outerHTML).slice(0, 80),
      verdict: document.querySelector('[data-practice-verdict]').textContent, links: document.querySelectorAll('.pmsg a').length };
  })()`);

  /**
   * Sorts all twelve with the keyboard alone (Tab and Enter, from the message's heading), checking each answer's marks
   * against the message's own clues and that focus goes where a screen reader needs it. `choose` picks per message.
   */
  const playThrough = async (s, label, choose, shots) => {
    const problems = [];
    await evalIn(browser, s, "document.getElementById('pmsg-h').focus(), true");
    for (const [i, m] of P.MESSAGES.entries()) {
      const pick = choose(m);
      const heading = await evalIn(browser, s, "document.activeElement && document.activeElement.id === 'pmsg-h' ? document.activeElement.textContent : ''");
      if (!heading.startsWith(`Message ${i + 1} of 12`)) problems.push(`${m.id}: focus was not on the message's heading (${heading})`);
      // In sight, and not under the fixed header: the reader starts each message at its top.
      const seen = await evalIn(browser, s, "(() => { const h = document.getElementById('pmsg-h').getBoundingClientRect(); return { top: Math.round(h.top), nav: Math.round(document.querySelector('[data-nav]').getBoundingClientRect().bottom), screen: innerHeight }; })()");
      if (seen.top < seen.nav || seen.top > seen.screen - 40) problems.push(`${m.id}: the message's heading is out of sight ${JSON.stringify(seen)}`);
      if (shots[m.id] === 'before') await snap(s, `practice-${label}-${m.id}`);
      for (let t = 0; t < (pick === 'scam' ? 1 : 2); t++) await tab(s);
      const onButton = await evalIn(browser, s, 'document.activeElement && document.activeElement.dataset.pick');
      if (onButton !== pick) problems.push(`${m.id}: Tab reached ${onButton}, not ${pick}`);
      await enter(s);
      await sleep(500);
      const got = await marked(s);
      const want = P.parse([m.from, m.address, m.subject, m.body].filter(Boolean).join('\n')).filter((p) => p.clue);
      const order = P.clueOrder(m);
      if (!got.shown) problems.push(`${m.id}: the marks did not show`);
      if (JSON.stringify(got.texts) !== JSON.stringify(want.map((p) => p.text))) problems.push(`${m.id}: marked ${JSON.stringify(got.texts)}`);
      if (JSON.stringify(got.numbers) !== JSON.stringify(want.map((p) => order.indexOf(p.clue) + 1))) problems.push(`${m.id}: numbered ${got.numbers}`);
      if (got.clues !== order.length) problems.push(`${m.id}: ${got.clues} clues explained, ${order.length} marked`);
      if (got.focus !== 'verdict') problems.push(`${m.id}: focus after answering was ${got.focus}`);
      if (got.links) problems.push(`${m.id}: ${got.links} links in the message`);
      if (!got.verdict.includes(m.scam ? 'a scam' : 'real')) problems.push(`${m.id}: verdict "${got.verdict}"`);
      if (shots[m.id] === 'after') await snap(s, `practice-${label}-${m.id}`);
      await tab(s);
      if (!(await evalIn(browser, s, "Boolean(document.activeElement && document.activeElement.matches('[data-practice-next]'))"))) problems.push(`${m.id}: Tab after the verdict did not reach Next`);
      await enter(s);
      await sleep(400);
    }
    const end = await evalIn(browser, s, `(() => { const h = document.querySelector('[data-practice-end]');
      return h && { text: h.textContent, focused: document.activeElement === h, missed: document.querySelectorAll('.practice__missed li').length }; })()`);
    await snap(s, `practice-${label}-score`);
    return { problems, end };
  };

  try {
    /* A computer: all right but one, to see a missed one on the score. */
    const d = await open({});
    const truth = (m) => (m.scam ? 'scam' : 'real');
    const desk = await playThrough(d, 'desktop', (m) => (m.id === 'invoice' ? 'real' : truth(m)), { parcel: 'before', signin: 'after', library: 'after' });
    result('practice: on a computer, all twelve sort with Tab and Enter alone, each answer marks its clues where they are in the message, numbered as explained, and focus goes to the answer, then the next message',
      !desk.problems.length && desk.end && desk.end.focused && desk.end.text.startsWith('You sorted 11 of 12') && desk.end.missed === 1, { problems: desk.problems, end: desk.end });

    /* A phone: every message called a scam. Fits the width, big enough to tap, and the score does not scold. */
    const ph = await open({ phone: true });
    const fit = await evalIn(browser, ph, `(() => ({ wide: document.documentElement.scrollWidth, screen: innerWidth,
      tap: Math.min(...[...document.querySelectorAll('[data-pick]')].map((b) => b.getBoundingClientRect().height)) }))()`);
    const phone = await playThrough(ph, 'phone', () => 'scam', { parcel: 'after', reported: 'after', code: 'after' });
    const scams = P.MESSAGES.filter((m) => m.scam).length;
    const words = await evalIn(browser, ph, "document.querySelector('.practice__end').textContent");
    result('practice: on a phone, the inbox fits the screen, the answers are big enough to tap, and the same play-through works',
      fit.wide <= fit.screen && fit.tap >= 44 && !phone.problems.length && phone.end && phone.end.text.startsWith(`You sorted ${scams} of 12`) && phone.end.missed === 12 - scams, { fit, problems: phone.problems, end: phone.end });
    result('practice: the score says no unkind word', !/\b(fail|failed|wrong|bad|poor|stupid)\b/i.test(words) && words.includes(P.closing(scams, 12)), words.replace(/\s+/g, ' ').slice(0, 300));
    await evalIn(browser, ph, "document.querySelector('[data-practice-again]').click(), true");
    await sleep(300);
    const again = await evalIn(browser, ph, "({ count: document.querySelector('[data-practice-count]').textContent, focus: document.activeElement && document.activeElement.id })");
    result('practice: Sort them again starts over at the first message', again.count === 'Message 1 of 12' && again.focus === 'pmsg-h', again);

    /* Reduced motion: the message and its marks are simply there, no slide. */
    const r = await open({ reduce: true });
    await evalIn(browser, r, "document.querySelector('[data-pick=\"scam\"]').click(), true");
    await sleep(100);
    const still = await evalIn(browser, r, "(() => { const c = getComputedStyle(document.querySelector('.pmsg__card')); const v = getComputedStyle(document.querySelector('.practice__verdict')); return { card: c.animationDuration, verdict: v.animationDuration, opacity: v.opacity, lenis: document.documentElement.classList.contains('lenis') }; })()");
    result('practice: with reduced motion, nothing slides in and the answer is there at once', parseFloat(still.card) < 0.01 && parseFloat(still.verdict) < 0.01 && still.opacity === '1' && !still.lenis, still);

    const offHost = requests.filter((u) => !u.startsWith(files.base) && !u.startsWith('data:'));
    result('practice: nothing leaves the page\'s host (the answers stay in the page)', !offHost.length, offHost.length ? offHost : `${requests.length} requests, all local`);
    result('practice: no console errors', !errors.length, errors);
  } finally {
    await close();
    files.server.close();
  }
}

module.exports = checkPractice;
