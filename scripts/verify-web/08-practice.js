'use strict';
/**
 * practice  The practice inbox (/practice) as a person uses it: a list of rows that pile up on scroll, a message that
 *           slides over it, the sender and link that show their real address, Report that asks what gave it away, the
 *           verdict, a second look at what was missed, and a result that names it. Keyboard alone on a computer, tap
 *           size on a phone, Back and Esc and a double press, light and dark, reduced motion, and nothing leaves the page.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto } = require('./_shared');

async function checkPractice() {
  if (!fs.existsSync(path.join(STATIC, 'practice.html'))) throw new Error(`no practice page in ${STATIC}: run npm run build:static`);
  const P = require('../../web/assets/js/practice.js');
  const byId = (id) => P.POOL.find((m) => m.id === id);
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  const errors = [];
  const requests = [];
  browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
  browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
  browser.on('Network.requestWillBeSent', (p) => requests.push(p.request.url));
  const key = async (s, k, code, vk) => {
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === 'keyDown' && k === 'Enter' ? { text: '\r' } : {}) }, s);
    await sleep(90);
  };
  const tab = (s) => key(s, 'Tab', 'Tab', 9);
  const enter = (s) => key(s, 'Enter', 'Enter', 13);
  const js = (s, code) => evalIn(browser, s, code);
  const tabTo = async (s, selector) => {
    for (let i = 0; i < 9; i++) {
      await tab(s);
      if (await js(s, `Boolean(document.activeElement && document.activeElement.matches(${JSON.stringify(selector)}))`)) return true;
    }
    return false;
  };
  // What a person sees: the screen. `full` takes the whole page, for the result.
  const snap = async (s, name, full) => {
    try {
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: Boolean(full) }, s);
      fs.writeFileSync(path.join(OUT, `practice-${name}.png`), Buffer.from(data, 'base64'));
    } catch { /* a picture is a nicety */ }
  };
  const open = async ({ phone, reduce, scheme = 'dark' }) => {
    const { sessionId: s } = await openPage(browser);
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Network.enable', {}, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }, { name: 'prefers-color-scheme', value: scheme }] }, s);
    if (phone) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, s);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
    } else {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false }, s);
    }
    await goto(browser, s, `${files.base}/practice.html`, "document.querySelector('[data-practice] [data-open]') && window.SentinelMotion");
    await sleep(1400);
    return s;
  };
  const nextId = (s) => js(s, "(() => { const b = document.querySelector('.prow:not(.is-done)'); return b ? b.dataset.open : null; })()");
  const ids = (s) => js(s, "[...document.querySelectorAll('[data-open]')].map((b) => b.dataset.open)");
  // The honest answer, naming the first sign that is bad.
  const truth = (m) => (P.isScam(m) ? P.judge(m, 'fine').main : 'fine');
  const clickAnswer = (s, choice) => js(s, `(() => {
    const c = ${JSON.stringify(choice)};
    if (c === 'fine') document.querySelector('[data-card]:last-child [data-fine]').click();
    else { document.querySelector('[data-card]:last-child [data-report]').click(); document.querySelector('[data-card]:last-child [data-why="' + c + '"]').click(); }
    return true; })()`);
  // Answers everything left by click. `choose` picks per message.
  const finishRun = async (s, choose) => {
    for (let i = 0; i < 20; i++) {
      if (await js(s, "Boolean(document.querySelector('[data-end]'))")) return true;
      const inSheet = await js(s, "document.querySelector('[data-sheet]').open ? (document.querySelector('[data-card]:last-child [data-next]') ? 'verdict' : 'message') : ''");
      if (inSheet === 'verdict') { await js(s, "document.querySelector('[data-card]:last-child [data-next]').click(), true"); await sleep(120); continue; }
      if (!inSheet) { const id = await nextId(s); await js(s, `document.querySelector('[data-open="${id}"]').click(), true`); await sleep(120); }
      const id = await js(s, "document.querySelector('[data-card]:last-child') && history.state && history.state.pm");
      await clickAnswer(s, choose(byId(id)));
      await sleep(120);
    }
    return false;
  };

  /** The four pictures of one form and theme: list, opened message with the address showing, Report open, verdict, end. */
  const pictures = async (label, opts) => {
    const s = await open(opts);
    await snap(s, `${label}-list`);
    const deck = await ids(s);
    const scam = deck.find((id) => byId(id).link && P.isScam(byId(id))) || deck.find((id) => P.isScam(byId(id)));
    await js(s, `document.querySelector('[data-open="${scam}"]').click(), true`);
    await sleep(900);
    await js(s, "document.querySelector('[data-card]:last-child [data-peek=sender]').click(), true");
    await sleep(700);
    await snap(s, `${label}-open`);
    await js(s, "document.querySelector('[data-card]:last-child [data-report]').click(), true");
    await sleep(600);
    await snap(s, `${label}-report`);
    await js(s, "document.querySelector('[data-card]:last-child [data-why=ask]').click(), true");
    await sleep(1100);
    await snap(s, `${label}-verdict`);
    const fits = await js(s, "({ wide: document.querySelector('[data-sheet]').scrollWidth, screen: document.querySelector('[data-sheet]').clientWidth })");
    // A text message too, whose sender cannot be looked up: the pill says why, in words.
    const text = deck.find((id) => byId(id).kind === 'text' && !byId(id).addr.startsWith('+'));
    if (text) {
      await js(s, `(() => { document.querySelector('[data-sheet]').close(); document.querySelector('[data-open="${text}"]').click(); return true; })()`);
      await sleep(900);
      await js(s, "document.querySelector('[data-card]:last-child [data-peek=sender]').click(), true");
      await sleep(700);
      await snap(s, `${label}-text`);
    }
    const finished = await finishRun(s, (m) => (m.id.startsWith('p') ? 'fine' : truth(m)));
    await sleep(1000);
    await snap(s, `${label}-end`, true);
    return { s, fits, finished };
  };

  try {
    /* A computer, by keyboard alone. Every scam reported and named except one, which is let through. */
    const d = await open({});
    const first = await ids(d);
    const resting = await js(d, "document.getAnimations().filter((a) => a.playState === 'running' && a.effect.target.closest && a.effect.target.closest('[data-practice]')).map((a) => a.effect.target.className || a.effect.target.tagName).slice(0, 5)");
    result('practice: at rest nothing in the inbox is animating', !resting.length, resting);
    const unread = await js(d, "document.querySelectorAll('.prow.is-unread').length");
    result('practice: ten unread rows, none with a real link in them', first.length === 10 && unread === 10 && (await js(d, "document.querySelectorAll('[data-practice] a').length")) === 0, { first, unread });

    const problems = [];
    const letThrough = first.find((id) => P.isScam(byId(id)));
    for (const id of first) {
      const m = byId(id);
      await js(d, `document.querySelector('[data-open="${id}"]').focus(), true`);
      await enter(d);
      await sleep(760);
      const opened = await js(d, "({ open: document.querySelector('[data-sheet]').open, focus: document.activeElement && document.activeElement.id, head: document.querySelector('#pcard-h').textContent, links: document.querySelectorAll('[data-sheet] a').length })");
      if (!opened.open || opened.focus !== 'pcard-h') problems.push(`${id}: opened ${JSON.stringify(opened)}`);
      if (opened.links) problems.push(`${id}: a real link in the message`);
      const isleWas = await js(d, "document.querySelector('[data-card]:last-child [data-isle]').textContent");
      if (isleWas.includes('@') || (m.link && isleWas.includes(m.link.to))) problems.push(`${id}: the address shows before it is asked for: ${isleWas}`);
      await js(d, "document.querySelector('[data-card]:last-child [data-peek=sender]').focus(), true");
      await enter(d);
      await sleep(80);
      const sender = await js(d, "document.querySelector('[data-card]:last-child [data-isle]').textContent");
      if (!sender.includes(m.kind === "text" && !m.addr.startsWith("+") ? "can be copied" : m.addr)) problems.push(`${id}: sender showed "${sender}"`);
      if (m.link) {
        await js(d, "document.querySelector('[data-card]:last-child .plink').focus(), true");
        await enter(d);
        await sleep(80);
        const link = await js(d, "document.querySelector('[data-card]:last-child [data-isle]').textContent");
        if (!link.includes(m.link.to)) problems.push(`${id}: link showed "${link}"`);
      }
      const choice = id === letThrough ? 'fine' : truth(m);
      await js(d, "document.querySelector('[data-card]:last-child #pcard-h').focus(), true");
      if (choice === 'fine') {
        if (!(await tabTo(d, '[data-fine]'))) problems.push(`${id}: Tab did not reach Looks fine`);
      } else {
        if (!(await tabTo(d, '[data-report]'))) problems.push(`${id}: Tab did not reach Report`);
        await enter(d);
        await sleep(100);
        if (!(await js(d, "Boolean(document.activeElement && document.activeElement.dataset.why)"))) problems.push(`${id}: Report did not move focus to the choices`);
        if (await js(d, `document.activeElement.dataset.why !== ${JSON.stringify(choice)}`) && !(await tabTo(d, `[data-why="${choice}"]`))) problems.push(`${id}: Tab did not reach ${choice}`);
      }
      await enter(d);
      await sleep(760);
      const v = await js(d, `(() => { const h = document.querySelector('[data-verdict]'); return h && { focused: document.activeElement === h, text: h.textContent, rows: document.querySelectorAll('.ptells > div').length, bad: document.querySelectorAll('.ptells .is-bad').length }; })()`);
      if (!v || !v.focused) problems.push(`${id}: focus after answering ${JSON.stringify(v)}`);
      else {
        if (v.rows !== P.TELLS.filter((k) => m[k]).length) problems.push(`${id}: ${v.rows} rows of reasons`);
        if (v.bad !== P.TELLS.filter((k) => m[k] && m[k].bad).length) problems.push(`${id}: ${v.bad} giveaways marked`);
        if (v.text !== P.words(m, choice, { sender: true, link: true }).h) problems.push(`${id}: verdict "${v.text}"`);
      }
      if (!(await tabTo(d, '[data-next]'))) problems.push(`${id}: Tab did not reach Next`);
      if (id === first[first.length - 1]) break;
      const rows = await js(d, "document.querySelectorAll('[data-open]').length");
      await js(d, "document.querySelector('[data-sheet]').close(), true");   // back to the list, as the next row is chosen by hand
      await sleep(120);
      if (rows !== 10) problems.push(`${id}: ${rows} rows before the last answer`);
    }
    const grew = await js(d, "document.querySelectorAll('[data-open]').length");
    const label = await js(d, "document.querySelector('[data-card]:last-child [data-next]').textContent");
    result('practice: on a computer, all ten sort by keyboard alone: focus lands on each message, the sender and link show their real address only when asked, Report moves to its choices, and the verdict marks what gave it away',
      !problems.length, problems);
    result('practice: a scam let through brings a second look with new messages, not the same ones', grew > 10 && label === 'Take a second look', { grew, label });
    const more = (await ids(d)).slice(10);
    result('practice: the second look is new messages from outside this deal, of both sorts', more.every((id) => !first.includes(id) && !first.some((f) => byId(f).pair === byId(id).pair)) && more.some((id) => P.isScam(byId(id))) && more.some((id) => !P.isScam(byId(id))), more);
    await enter(d);
    await sleep(200);
    const ok = await finishRun(d, truth);
    await sleep(500);
    const end = await js(d, "(() => { const h = document.querySelector('[data-end]'); return h && { text: h.textContent, focused: document.activeElement === h, all: document.querySelector('.pdone').textContent, sheet: document.querySelector('[data-sheet]').open, list: document.querySelector('[data-tray]').hidden }; })()");
    const scams = first.filter((id) => P.isScam(byId(id))).length;
    const missedSign = P.judge(byId(letThrough), 'fine').main;
    result('practice: the end counts the first pass truly, names what was missed, and gets the focus',
      ok && end && end.focused && !end.sheet && end.list && end.text.startsWith(`You reported ${scams - 1} of ${scams} scams and left ${10 - scams} of ${10 - scams} real`) && end.all.includes(P.ADVICE[missedSign]) && end.all.includes('Second look:'), end);
    await js(d, "document.querySelector('[data-deal]').click(), true");
    await sleep(900);
    const second = await ids(d);
    result('practice: a new inbox shares no message with the last, and the focus goes to its first row', second.length === 10 && !second.some((id) => first.includes(id)) && (await js(d, "document.activeElement && document.activeElement.matches('[data-open]')")), second);

    /* Back, forward, Esc, a press outside, and a double press. */
    const b = await open({});
    const row = (await ids(b))[0];
    await js(b, `document.querySelector('[data-open="${row}"]').click(), true`);
    await sleep(800);
    await js(b, 'history.back(), true');
    await sleep(400);
    const afterBack = await js(b, "document.querySelector('[data-sheet]').open");
    await js(b, 'history.forward(), true');
    await sleep(800);
    const afterForward = await js(b, "document.querySelector('[data-sheet]').open");
    await key(b, 'Escape', 'Escape', 27);
    await sleep(400);
    const afterEsc = await js(b, "({ open: document.querySelector('[data-sheet]').open, focus: document.activeElement && document.activeElement.dataset.open })");
    await js(b, `document.querySelector('[data-open="${row}"]').click(), true`);
    await sleep(700);
    await js(b, "(() => { const f = document.querySelector('[data-card]:last-child [data-fine]'); f.click(); f.click(); return true; })()");
    await sleep(200);
    const pressed = await js(b, "({ verdicts: document.querySelectorAll('.pverdict').length, left: document.querySelector('[data-count]').textContent })");
    result('practice: Back closes a message and leaves the page where it was, Forward reopens it, Esc closes it and returns to its row, and a double press gives one verdict',
      !afterBack && afterForward && !afterEsc.open && afterEsc.focus === row && pressed.verdicts === 1 && pressed.left === '9 to sort', { afterBack, afterForward, afterEsc, pressed });

    /* The pictures, and the phone. */
    const phone = await pictures('phone-dark', { phone: true });
    await pictures('phone-light', { phone: true, scheme: 'light' });
    await pictures('desktop-dark', {});
    await pictures('desktop-light', { scheme: 'light' });
    const words = await js(phone.s, "document.querySelector('.pdone').textContent");
    result('practice: the end says no unkind word', !/\b(fail|failed|wrong|bad|poor|stupid)\b/i.test(words), words.replace(/\s+/g, ' ').slice(0, 300));

    const ph = await open({ phone: true });
    const fit = await js(ph, "({ wide: document.documentElement.scrollWidth, screen: innerWidth, tap: Math.min(...[...document.querySelectorAll('[data-open]')].map((r) => r.getBoundingClientRect().height)), top: Math.round(document.querySelector('[data-open]').getBoundingClientRect().top) })");
    result('practice: on a phone the inbox fits, starts on the first screen, and every row is big enough to tap', fit.wide <= fit.screen && fit.tap >= 44 && fit.top < 640, fit);
    await js(ph, "(() => { const r = document.querySelector('[data-list]').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top + 420); return true; })()");
    await sleep(900);
    const pile = await js(ph, `(() => {
      const rows = [...document.querySelectorAll('[data-list] li')];
      const tops = rows.map((r) => Math.round(r.getBoundingClientRect().top));
      const a = rows[0].getBoundingClientRect();
      const over = document.elementFromPoint(a.left + a.width / 2, a.top + 40);
      return { tops: tops.slice(0, 5), covered: Boolean(over && over.closest('li') && over.closest('li') !== rows[0]), wide: document.documentElement.scrollWidth };
    })()`);
    await snap(ph, 'phone-dark-pile');
    result('practice: on scroll the rows gather under the header as a pile, each lying over the last', pile.tops[1] - pile.tops[0] <= 8 && pile.covered && pile.wide <= 390, pile);
    await js(ph, "document.querySelector('[data-open]').focus(), true");
    await sleep(900);
    const refocus = await js(ph, "(() => { const b = document.querySelector('[data-open]'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + 30); return Boolean(el && b.contains(el)); })()");
    result('practice: a row reached by keyboard comes out from under the pile', refocus, refocus);

    /* Reduced motion: the card and verdict are simply there. */
    const r = await open({ reduce: true });
    await js(r, "document.querySelector('[data-open]').click(), true");
    await sleep(60);
    const firstStill = await js(r, "(() => { const c = getComputedStyle(document.querySelector('.pcard-wrap')); return { d: c.animationDuration, lenis: document.documentElement.classList.contains('lenis') }; })()");
    await js(r, "document.querySelector('[data-fine]').click(), true");
    await sleep(60);
    const v = await js(r, "getComputedStyle(document.querySelector('.pverdict')).animationDuration");
    result('practice: with reduced motion, nothing slides in and the answer is there at once', parseFloat(firstStill.d) < 0.01 && parseFloat(v) < 0.01 && !firstStill.lenis, { firstStill, v });

    const offHost = requests.filter((u) => !u.startsWith(files.base) && !u.startsWith('data:'));
    result('practice: nothing leaves the page\'s host (the answers stay in the page)', !offHost.length, offHost.length ? offHost : `${requests.length} requests, all local`);
    result('practice: no console errors', !errors.length, errors);
  } finally {
    await close();
    files.server.close();
  }
}

module.exports = checkPractice;
