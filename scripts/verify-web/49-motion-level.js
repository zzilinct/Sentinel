'use strict';
/**
 * motion-level  The Motion setting (boot.js): Full, Calm or Off, and the scan effect, in the signed-in app as a person
 *               uses it. Pressed with the mouse and with the arrow keys; kept across a reload; Calm stops every loop
 *               that moves by itself while the working signs stay; Off leaves nothing running; the scan effect off
 *               (or Off) draws no digits; and when the computer asks for less motion, Off is chosen and locked, and
 *               says why. Photographs the control at computer and phone size, dark and light, and locked.
 */
const { sleep, result, launch, evalIn, openPage, goto, shot, startServer, watchErrors, until, clickSel } = require('./_shared');

// The loops that mean "working" (a spinner, a loading shimmer, a reading line, a caret, a file held over the drop box).
const WORKING = ['spin', 'shimmer', 'shot-read', 'caret', 'lux-hold', 'wait'];
const LOOPS = `document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity).map((a) => a.animationName || a.transitionProperty || 'script')`;
const STATE = `(() => { const r = document.documentElement.dataset; const c = document.querySelector('.motion-set input:checked');
  return { motion: r.motion, effect: r.scanEffect, checked: c && c.value, locked: [...document.querySelectorAll('.motion-set input[type=radio]')].every((i) => i.disabled),
    row: document.querySelectorAll('#motion').length === 1 && Boolean(document.querySelector('#motion.setting [role=radiogroup] input[value=calm]')),
    note: (document.querySelector('[data-motion-note]') || {}).textContent, stored: localStorage.getItem('sentinel:motion'),
    sw: (() => { const s = document.querySelector('[data-scan-effect-switch]'); return s && { on: s.checked, disabled: s.disabled }; })() }; })()`;
// A delicate scan's dig, started by hand over a panel: whether it put a canvas down at all.
const DIG = `new Promise((done) => { const host = document.querySelector('[data-motion-slot]'); const d = window.SentinelBinary.dig(host, { grace: 0 });
  setTimeout(() => { const drawn = Boolean(host.querySelector('.binary-veil')); d.stop(); done(drawn); }, 500); })`;

async function checkMotionLevel() {
  const server = await startServer('motionlevel', {});
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const media = (value) => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] }, s);
    await media('no-preference');
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await goto(browser, s, `${base}/login`);
    const email = `motion-${Date.now()}@example.com`;
    await api('/auth/signup', { email, password: 'Motion-Check-Lamp-2026', firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password: 'Motion-Check-Lamp-2026' });
    const open = async () => {
      await goto(browser, s, `${base}/app/protection`, "document.querySelector('[data-motion-slot] .motion-set')");
      await sleep(900);
    };
    const state = () => evalIn(browser, s, STATE);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await open();

    const first = await state();
    result('motion-level: one #motion row; nothing chosen is Full, the scan effect on, and nothing stored', first.row && first.motion === 'full' && first.checked === 'full' && first.effect === 'on' && first.sw.on && !first.stored && !first.locked, first);
    const fullLoops = await evalIn(browser, s, LOOPS);
    const ambient = (list) => list.filter((n) => !WORKING.includes(n));
    result('motion-level: under Full something drifts by itself (so the Calm count below can see it)', ambient(fullLoops).length > 0, fullLoops);
    result('motion-level: Full digs during a delicate scan', await evalIn(browser, s, DIG) === true);

    /* Calm, by mouse: the loops that move by themselves stop at once, the working signs stay. The page scrolls smoothly
       under Full, so the control is brought into view first and pressed where it then is. */
    await evalIn(browser, s, "document.querySelector('[data-motion-slot]').scrollIntoView({ block: 'center', behavior: 'instant' })");
    await sleep(300);
    await clickSel(browser, s, '.motion-set .seg__btn:nth-child(2)');
    await sleep(500);
    const calm = await state();
    const calmLoops = await evalIn(browser, s, LOOPS);
    result('motion-level: Calm is chosen by a press, applied at once and kept', calm.motion === 'calm' && calm.checked === 'calm' && calm.stored === 'calm' && /Nothing drifts/.test(calm.note), calm);
    result('motion-level: Calm leaves no loop that moves by itself running', ambient(calmLoops).length === 0, { full: fullLoops, calm: calmLoops });
    result('motion-level: Calm still digs, lighter', await evalIn(browser, s, DIG) === true);
    await open();
    const again = await state();
    result('motion-level: Calm is still Calm after a reload, set before the page drew', again.motion === 'calm' && again.checked === 'calm', again);

    /* Off, by the arrow keys: the radio group moves like any other. */
    // From the top of the page, with Tab alone, as a keyboard user gets there (the panel is below the fold, not yet
    // entered): a key with no text is a raw key down, as Puppeteer sends it.
    const key = async (k, code) => { for (const type of ['rawKeyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code }, s); };
    let tabs = 0;
    for (; tabs < 120 && !(await evalIn(browser, s, "Boolean(document.activeElement && document.activeElement.closest('.motion-set [role=radiogroup]'))")); tabs++) await key('Tab', 9);
    result('motion-level: Tab alone reaches the setting from the top of the page', tabs < 120, { tabs, at: await evalIn(browser, s, '(document.activeElement || {}).outerHTML') });
    await key('ArrowDown', 40);
    await sleep(500);
    const off = await state();
    const offRunning = await evalIn(browser, s, "document.getAnimations().filter((a) => a.playState === 'running' && a.effect.getComputedTiming().endTime > 0.05).map((a) => a.animationName || a.transitionProperty || 'script')");
    result('motion-level: the arrow keys move to Off', off.motion === 'off' && off.checked === 'off', off);
    result('motion-level: Off leaves nothing running', offRunning.length === 0, offRunning);
    result('motion-level: Off digs nothing, and the scan effect switch says why it is off', await evalIn(browser, s, DIG) === false && off.sw.disabled && !off.sw.on, off.sw);

    /* The scan effect on its own: Full motion, no digits. */
    await clickSel(browser, s, '.motion-set .seg__btn:nth-child(1)');
    await sleep(300);
    await clickSel(browser, s, '[data-scan-effect-switch]');
    await sleep(300);
    const noFx = await state();
    result('motion-level: the scan effect switched off digs nothing under Full, and is kept', noFx.motion === 'full' && noFx.effect === 'off' && await evalIn(browser, s, DIG) === false && await evalIn(browser, s, "localStorage.getItem('sentinel:scan-effect')") === 'off', noFx);
    await clickSel(browser, s, '[data-scan-effect-switch]');
    await sleep(300);

    /* Pictures: computer and phone, dark and light. */
    for (const [size, metrics] of [['desktop', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', metrics, s);
      for (const theme of ['dark', 'light']) {
        await evalIn(browser, s, `localStorage.setItem('sentinel:theme', '${theme}')`);
        await open();
        await evalIn(browser, s, "document.querySelector('[data-motion-slot]').scrollIntoView({ block: 'center' })");
        await sleep(400);
        await shot(browser, s, `motion-${size}-${theme}`);
      }
      const wide = await evalIn(browser, s, 'document.documentElement.scrollWidth > innerWidth');
      result(`motion-level: the control fits the ${size} screen`, !wide);
    }

    /* The computer asks for less motion: Off, locked, in words, at once and without a reload. */
    await evalIn(browser, s, "localStorage.setItem('sentinel:motion', 'calm')");
    await open();
    await media('reduce');
    await sleep(400);
    const locked = await state();
    result('motion-level: when the computer asks for less motion, Off is chosen and locked, and it says so', locked.motion === 'off' && locked.checked === 'off' && locked.locked && locked.note === 'Your computer asks for less motion, so Sentinel follows.', locked);
    await evalIn(browser, s, "document.querySelector('[data-motion-slot]').scrollIntoView({ block: 'center' })");
    await sleep(300);
    await shot(browser, s, 'motion-phone-light-locked');
    await media('no-preference');
    await sleep(300);
    const back = await state();
    result('motion-level: and when it no longer asks, the choice comes back', back.motion === 'calm' && !back.locked, back);

    /* The public site, changed while open (another tab, or the system): no reload. */
    await evalIn(browser, s, "localStorage.removeItem('sentinel:motion')");
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await goto(browser, s, `${base}/`, 'window.SentinelMotion');
    await sleep(1500);
    const siteFull = await evalIn(browser, s, LOOPS);
    await evalIn(browser, s, "window.SentinelMotionLevel.set('calm')");
    await sleep(400);
    const siteCalm = await evalIn(browser, s, LOOPS);
    await evalIn(browser, s, "window.SentinelMotionLevel.set('off')");
    await sleep(400);
    // Measured after the page has drawn two frames: on this runner a frame can wait a second or two for the 3D masks.
    await evalIn(browser, s, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    // What is still moving (anything longer than a twentieth of a millisecond: a style landing at once, such as a 3D mask
    // arriving, makes a zero-length transition that moves nothing), with its own timing, so a failure says why.
    const siteOff = await evalIn(browser, s, "document.getAnimations().filter((a) => a.playState === 'running' && a.effect.getComputedTiming().endTime > 0.05).map((a) => { const t = a.effect.getComputedTiming(); const el = a.effect.target; return [a.animationName || a.transitionProperty || 'script', el && (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className), Math.round(t.duration), Math.round(t.delay), Math.round(a.currentTime)].join(' '); })");
    result('motion-level: on the home page, Calm stills every loop that moves by itself at once, and Off everything, without a reload', ambient(siteFull).length > 0 && ambient(siteCalm).length === 0 && siteOff.length === 0, { full: siteFull, calm: siteCalm, off: siteOff });
    await evalIn(browser, s, "localStorage.removeItem('sentinel:motion')");
    result('motion-level: no errors on the page', errors.length === 0, errors);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkMotionLevel;
