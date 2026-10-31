'use strict';
/**
 * pricing  The plan comparison as production serves it, billing off: every figure on the page against the server's
 *          /api/v1/plans; nothing offered that cannot be had; the finder's answer and the gold lens, which must land
 *          exactly on the plan named, at computer and phone size; keys; reduced motion; nothing moving at rest; no
 *          sideways scroll; the signed-in Plan page. Photographs it at computer and phone size, dark and light.
 */
const fs = require('fs');
const path = require('path');
const { OUT, sleep, result, launch, evalIn, openPage, goto, shot, startServer, watchErrors } = require('./_shared');

const SIZES = { desktop: { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } };

// Where the lens sits against the column it should be on, in px; and what is moving on the sheet.
const LENS = `(() => {
  const l = document.querySelector('.ledger');
  const lens = l.querySelector('.ledger__lens').getBoundingClientRect();
  const col = l.querySelector('thead th[data-col="' + l.dataset.pick + '"]').getBoundingClientRect();
  return { pick: l.dataset.pick, off: Math.abs(lens.left - col.left) + Math.abs(lens.width - col.width) };
})()`;
const SHEET = `(() => {
  const cells = {};
  for (const tr of document.querySelectorAll('.ledger tbody tr')) {
    const th = tr.querySelector('th[role=rowheader]');
    if (!th) continue;
    cells[th.firstChild.textContent.trim()] = Object.fromEntries([...tr.querySelectorAll('td')].map((td) => [td.dataset.col, td.textContent.replace(/\\s+/g, ' ').trim()]));
  }
  return cells;
})()`;

async function checkPricing() {
  const server = await startServer('pricing', { BILLING_MODE: 'disabled' });
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const media = (scheme, motion = 'no-preference') => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: motion }] }, s);
    const size = (name) => browser.send('Emulation.setDeviceMetricsOverride', SIZES[name], s);
    const open = async (url) => { await goto(browser, s, `${base}${url}`, "document.querySelector('.ledger')"); await sleep(1500); };
    const press = (sel) => evalIn(browser, s, `document.querySelector(${JSON.stringify(sel)}).click()`);
    const picture = async (selector, name) => {
      const box = await evalIn(browser, s, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
      const pad = 24;
      const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad, scale: 1 };
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true }, s);
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    };

    /* ---------------------------------------------------------- what it says */

    await media('dark');
    await size('desktop');
    await open('/pricing');
    const plans = (await (await fetch(`${base}/api/v1/plans`)).json());
    result('pricing: the server here is the one production runs, billing off', plans.billingMode === 'disabled', plans.billingMode);
    const sheet = await evalIn(browser, s, SHEET);
    const count = (n) => (n === null ? 'Unlimited' : n === 0 ? 'No' : n.toLocaleString('en-US'));
    const span = (m) => (m === null ? 'Unlimited' : m === 0 ? 'No' : m < 60 ? `${m} minutes` : `${m / 60} hours`);
    const wrong = [];
    for (const p of plans.plans) {
      for (const [row, want] of [['Fast link scans', count(p.limits.linkScans)], ['Delicate link scans', count(p.limits.deepScans)], ['Virus and malware scans', count(p.limits.fileScans)], ['Fast live scanning', span(p.limits.fastMinutes)], ['Delicate live scanning', span(p.limits.liveMinutes)]]) {
        if (!sheet[row] || sheet[row][p.id] !== want) wrong.push({ row, plan: p.id, want, shows: sheet[row] && sheet[row][p.id] });
      }
    }
    result('pricing: every figure in the page is the one the server enforces', wrong.length === 0, wrong);
    const offers = await evalIn(browser, s, `({ take: [...document.querySelectorAll('.ledger__take td')].map((td) => td.textContent.trim()),
      links: [...document.querySelectorAll('main a.btn, main button.btn')].map((a) => a.textContent.trim()), planLinks: document.querySelectorAll('a[href*="plan="]').length,
      words: document.querySelector('main').innerText })`);
    result('pricing: billing off, one way in and three plans that say they are not on sale', offers.take.join('|') === 'Start free|Not on sale yet|Not on sale yet|Not on sale yet' && offers.planLinks === 0 && !/\b(Get|Buy|Upgrade to) (Pro|Max|Ultimate)/.test(offers.words), offers.take);

    /* ------------------------------------------- the finder and the lens, each size */

    for (const name of ['desktop', 'phone']) {
      await size(name);
      await open('/pricing');
      const rest = await evalIn(browser, s, LENS);
      const answer0 = await evalIn(browser, s, "document.querySelector('[data-f-answer]').textContent");
      result(`pricing: ${name}: it opens on Free, the plan a person can have, lens on its column`, rest.pick === 'free' && rest.off < 1 && /^Free covers that/.test(answer0), { rest, answer0 });
      await press('[data-f-live="yes"]');
      await sleep(900);
      const pro = await evalIn(browser, s, LENS);
      const said = await evalIn(browser, s, "document.querySelector('[data-f-answer]').textContent");
      result(`pricing: ${name}: asking to be watched moves the lens onto Pro, and says Pro is not on sale`, pro.pick === 'pro' && pro.off < 1 && /would cover that, but it is not on sale yet/.test(said), { pro, said });
      await press('[data-f-email="yes"]');
      await sleep(900);
      const max = await evalIn(browser, s, LENS);
      result(`pricing: ${name}: pasting emails moves it onto Max`, max.pick === 'max' && max.off < 1, max);
      const moving = await evalIn(browser, s, "document.querySelector('.ledger').getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length");
      result(`pricing: ${name}: once it lands nothing on the sheet moves`, moving === 0, moving);
      const wide = await evalIn(browser, s, `({ page: document.documentElement.scrollWidth - innerWidth,
        cut: [...document.querySelectorAll('.ledger td, .ledger th')].filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent.trim().slice(0, 30)) })`);
      result(`pricing: ${name}: no sideways scroll, and no word cut off`, wide.page <= 0 && wide.cut.length === 0, wide);
    }

    await size('desktop');
    await open('/pricing');
    await evalIn(browser, s, "document.querySelector('[data-f-live=\"no\"]').focus()");
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, s);
    await sleep(900);
    const keyed = await evalIn(browser, s, `({ lens: ${LENS}, focus: document.activeElement.textContent, checked: document.activeElement.getAttribute('aria-checked') })`);
    result('pricing: the arrow keys work the choices, and the lens follows', keyed.lens.pick === 'pro' && keyed.focus === 'Yes, watch' && keyed.checked === 'true', keyed);
    await press('[data-f-live="yes"]');
    await press('[data-f-live="yes"]');
    await sleep(900);
    result('pricing: a double press changes nothing', (await evalIn(browser, s, LENS)).pick === 'pro');

    await media('dark', 'reduce');
    await open('/pricing');
    await press('[data-f-live="yes"]');
    const instant = await evalIn(browser, s, `(() => { const r = ${LENS}; return { ...r, anims: document.querySelector('.ledger__lens').getAnimations().length }; })()`);
    result('pricing: with reduced motion the lens is simply there, without travelling', instant.pick === 'pro' && instant.off < 1 && instant.anims === 0, instant);

    /* -------------------------------------------------------------- pictures */

    for (const name of ['desktop', 'phone']) {
      for (const scheme of ['dark', 'light']) {
        await media(scheme);
        await size(name);
        await open('/pricing');
        await shot(browser, s, `pricing-${name}-${scheme}-top`);
        await picture('.ledger', `pricing-${name}-${scheme}-sheet`);
        await press('[data-f-live="yes"]');
        await sleep(900);
        await picture('.ledger', `pricing-${name}-${scheme}-pro`);
      }
      await media('dark');
      await size(name);
      await goto(browser, s, `${base}/`, "document.querySelector('#pricing .ledger')");
      await sleep(1500);
      await evalIn(browser, s, "document.querySelector('#pricing').scrollIntoView({ block: 'start', behavior: 'instant' })");
      await sleep(1800);
      await shot(browser, s, `pricing-home-${name}`);
    }
    // A phone reading down the rows keeps the plan names in view.
    await media('dark');
    await size('phone');
    await open('/pricing');
    await evalIn(browser, s, "scrollTo({ top: [...document.querySelectorAll('.ledger__ask')].pop().getBoundingClientRect().top + scrollY - 300, behavior: 'instant' })");
    await sleep(800);
    await shot(browser, s, 'pricing-phone-dark-scrolled');
    const stuck = await evalIn(browser, s, `(() => { const n = document.querySelector('.nav, header').getBoundingClientRect(); const h = document.querySelector('.ledger__table thead').getBoundingClientRect(); return { navBottom: Math.round(n.bottom), headTop: Math.round(h.top) }; })()`);
    result('pricing: phone: the plan names stay in view under the header as you read down', stuck.headTop >= stuck.navBottom - 1 && stuck.headTop < stuck.navBottom + 12, stuck);

    /* ------------------------------------------------------- the signed-in page */

    await size('desktop');
    await goto(browser, s, `${base}/login`);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    const email = `plans-${Date.now()}@example.com`;
    const password = 'Plan-Check-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });
    for (const name of ['desktop', 'phone']) {
      await size(name);
      await open('/app/plan');
      await picture('.ledger', `pricing-app-${name}`);
      const app = await evalIn(browser, s, `({ take: [...document.querySelectorAll('.ledger__take td')].map((td) => td.textContent.trim()), buttons: document.querySelectorAll('main button[data-plan]').length, lens: ${LENS}, wide: document.documentElement.scrollWidth - innerWidth })`);
      result(`pricing: ${name}: the signed-in plan page marks your plan and offers nothing it cannot give`, app.take.join('|') === 'Your plan|Not on sale yet|Not on sale yet|Not on sale yet' && app.buttons === 0 && app.lens.pick === 'free' && app.lens.off < 1 && app.wide <= 0, app);
    }

    result('pricing: nothing went wrong in the page', errors.length === 0, errors.slice(0, 5));
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkPricing;
