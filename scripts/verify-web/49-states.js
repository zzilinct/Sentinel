'use strict';
/**
 * states  What the app says when there is nothing to show, when a part of a page cannot load, when nothing answers at
 *         all, and when a wait runs long: one calm block in that part's own place, with Try again running only that
 *         part again. When nothing answers, one line under the top says so, and the part loads again by itself when
 *         the connection is back. Only the answers for the account's history and site rules are stood in for (a server
 *         fault, a lost connection, a reply held back); everything else is the real server.
 *         Pictures: states-<state>-<size>-<theme>.png.
 */
const { sleep, result, launch, evalIn, openPage, goto, startServer, until, shot } = require('./_shared');

const SIZES = { desktop: [1366, 900, false], phone: [390, 844, true] };
const THEMES = ['dark', 'light'];

const BLOCK = (slot) => `(() => { const b = document.querySelector('${slot} [data-state]'); const bar = document.querySelector('[data-netbar]');
  return b ? { state: b.dataset.state, role: b.getAttribute('role'), text: b.innerText.replace(/\\s+/g, ' ').trim(), retry: Boolean(b.querySelector('[data-retry]')),
    bar: Boolean(bar && !bar.hidden && bar.checkVisibility()), wide: document.documentElement.scrollWidth - innerWidth } : null; })()`;

async function checkStates() {
  const server = await startServer('states');
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await goto(browser, s, `${server.base}/login`);
    const email = `states-${Date.now()}@example.com`;
    const password = 'States-Check-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });

    // How the stood-in answers behave: 'pass' (the real server), 'fault' (a 500), 'hold', for the four answers named
    // here; 'down' fails every call to Sentinel, as a lost connection does.
    let mode = 'pass';
    const held = [];
    const STOOD_IN = /\/api\/v1\/(account\/history|sites\/overrides|week|account\/sessions|ai\/providers)/;
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/*' }] }, s);
    browser.on('Fetch.requestPaused', (p, sid) => {
      if (sid !== s) return;
      if (mode !== 'down' && !STOOD_IN.test(p.request.url)) browser.send('Fetch.continueRequest', { requestId: p.requestId }, s).catch(() => {});
      else if (mode === 'fault') browser.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 500, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"error":{"message":"x"}}').toString('base64') }, s).catch(() => {});
      else if (mode === 'down') browser.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' }, s).catch(() => {});
      else if (mode === 'hold') held.push(p.requestId);
      else browser.send('Fetch.continueRequest', { requestId: p.requestId }, s).catch(() => {});
    });
    const release = () => { for (const id of held.splice(0)) browser.send('Fetch.continueRequest', { requestId: id }, s).catch(() => {}); };

    /* ---------------------------------------------- a wait is as tall as what replaces it */
    // Each place's wait, held, then what came, at the same width: the first time (a new account's empty places, from
    // app.css) and the next time (the height kept on this device). A difference is the page jumping under the reader.
    const SLOTS = { recent: '[data-recent]', week: '[data-week]', stats: '[data-stats]', history: '[data-list]', allow: '[data-allow]', block: '[data-block]', devices: '[data-sessions]', assistants: '[data-pane]' };
    const PAGES = { '/app': ['recent'], '/app/week': ['week'], '/app/history': ['stats', 'history'], '/app/sites': ['allow', 'block'], '/app/settings': ['devices'], '/app/assistants': ['assistants'] };
    const jumps = [];
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    for (const [name, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      await evalIn(browser, s, "localStorage.removeItem('sentinel:heights')");
      for (const visit of ['first', 'next']) {
        for (const [page, keys] of Object.entries(PAGES)) {
          mode = 'hold';
          await goto(browser, s, `${server.base}${page}`, keys.map((k) => `document.querySelector('[data-skel="${k}"]')`).join(' && '));
          const wait = await evalIn(browser, s, `(${JSON.stringify(keys)}).map((k) => document.querySelector('[data-skel="' + k + '"]').offsetHeight)`);
          mode = 'pass';
          release();
          await until(browser, s, `!document.querySelector('[data-skel]')`, 15000);
          await sleep(300);
          const came = await evalIn(browser, s, `(${JSON.stringify(keys.map((k) => SLOTS[k]))}).map((q) => { const e = document.querySelector(q); const c = getComputedStyle(e); return Math.round(e.clientHeight - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom)); })`);
          keys.forEach((k, i) => jumps.push({ at: `${name} ${visit} ${k}`, wait: wait[i], came: came[i], jump: came[i] - wait[i] }));
        }
      }
    }
    console.log(`      heights: ${jumps.map((j) => `${j.at} ${j.wait}->${j.came}`).join('; ')}`);
    result('states: the first time, each wait is as tall as what a new account sees there', jumps.filter((j) => / first /.test(j.at)).every((j) => Math.abs(j.jump) <= 2), jumps.filter((j) => / first /.test(j.at)));
    result('states: after that, each wait is as tall as that place was last time, so nothing jumps', jumps.filter((j) => / next /.test(j.at)).every((j) => Math.abs(j.jump) <= 1), jumps.filter((j) => / next /.test(j.at)));

    const seen = { empty: [], fault: [], down: [], slow: [] };
    for (const [name, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        const tag = `${name}-${theme}`;

        // Empty: a new account's history, with the way to fill it.
        mode = 'pass';
        await goto(browser, s, `${server.base}/app/history`, "document.querySelector('[data-rows] [data-state]')");
        seen.empty.push({ tag, ...(await evalIn(browser, s, BLOCK('[data-rows]'))), link: await evalIn(browser, s, "Boolean(document.querySelector('[data-rows] a[href=\"/app/check\"]'))") });
        await sleep(300);
        await shot(browser, s, `states-empty-${tag}`);

        // A server fault: the history says so in its place; Try again loads it.
        mode = 'fault';
        await goto(browser, s, `${server.base}/app/history`, "document.querySelector('[data-list] [data-state]')");
        const fault = await evalIn(browser, s, BLOCK('[data-list]'));
        await sleep(300);
        await shot(browser, s, `states-fault-${tag}`);
        mode = 'pass';
        await evalIn(browser, s, "document.querySelector('[data-retry]').click()");
        const again = await until(browser, s, "Boolean(document.querySelector('[data-list] [data-total]'))", 15000);
        seen.fault.push({ tag, ...fault, again });

        // Nothing answers: the line under the top, the block waits, and it loads by itself when the connection is back.
        mode = 'pass';
        await goto(browser, s, `${server.base}/app/settings`, "document.querySelector('[data-set-row]')");
        mode = 'down';
        await evalIn(browser, s, "document.querySelector('a[href=\"/app/history\"][data-route]').click()");
        await until(browser, s, "document.querySelector('[data-list] [data-state]')", 15000);
        await sleep(300);
        const down = await evalIn(browser, s, BLOCK('[data-list]'));
        await sleep(300);
        await shot(browser, s, `states-offline-${tag}`);
        mode = 'pass';
        await evalIn(browser, s, "window.dispatchEvent(new Event('online'))");
        const back = await until(browser, s, "Boolean(document.querySelector('[data-list] [data-total]')) && document.querySelector('[data-netbar]').hidden", 15000);
        seen.down.push({ tag, ...down, back });

        // A long wait says so after 8 seconds, in its own place.
        mode = 'hold';
        await goto(browser, s, `${server.base}/app/history`, "document.querySelector('[data-list] .skeleton')");
        const late = (q) => evalIn(browser, s, `(() => { const e = document.querySelector('${q}'); const a = e && getComputedStyle(e, '::after'); return a ? a.visibility + ' ' + a.content : 'gone'; })()`);
        const early = await late('[data-list] .skeleton');
        await sleep(8600);
        const after = await late('[data-list] .skeleton');
        await shot(browser, s, `states-slow-${tag}`);
        mode = 'pass';
        release();
        const loaded = await until(browser, s, "Boolean(document.querySelector('[data-list] [data-total]'))", 15000);
        seen.slow.push({ tag, early, after, loaded });
      }
    }
    result('states: an empty history says it is empty, calmly, with the way to fill it', seen.empty.every((e) => e.state === 'waiting' && /No scans yet/.test(e.text) && e.link), seen.empty);
    result('states: a part that could not load says so in its place, read out at once, with Try again that loads it',
      seen.fault.every((e) => e.state === 'error' && e.role === 'alert' && /Your history could not be loaded/.test(e.text) && e.retry && e.again && !e.bar), seen.fault);
    result('states: with no answer at all, the line under the top says so and the part loads again by itself when the connection is back',
      seen.down.every((e) => e.state === 'offline' && e.role === 'status' && /cannot be reached/.test(e.text) && e.bar && e.back), seen.down);
    result('states: a long wait says so after 8 seconds and not before, then shows what came', seen.slow.every((e) => /^hidden/.test(e.early) && /^visible .*taking longer/.test(e.after) && e.loaded), seen.slow);
    result('states: nothing scrolls sideways', [...seen.fault, ...seen.down].every((e) => e.wide <= 0), [...seen.fault, ...seen.down].map((e) => `${e.tag}: ${e.wide}`));

    // Site rules: both lists come from one answer, so one block says it, and the empty second list does not shimmer on.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    mode = 'fault';
    await goto(browser, s, `${server.base}/app/sites`, "document.querySelector('[data-allow] [data-state]')");
    const sites = await evalIn(browser, s, `({ ...${BLOCK('[data-allow]')}, blockHidden: document.querySelector('[data-block]').hidden })`);
    mode = 'pass';
    await evalIn(browser, s, "document.querySelector('[data-retry]').click()");
    const sitesBack = await until(browser, s, "!document.querySelector('[data-block]').hidden && document.querySelectorAll('[data-state=waiting]').length === 2", 15000);
    result('states: site rules that could not load say so once, and Try again brings both lists', sites.state === 'error' && sites.blockHidden && sitesBack, { sites, sitesBack });

    // An optional card that could not load is one quiet line with Try again, never a red block.
    mode = 'fault';
    await goto(browser, s, `${server.base}/app`, "document.querySelector('[data-week-card] [data-state]')");
    const card = await evalIn(browser, s, `({ ...${BLOCK('[data-week-card]')}, line: document.querySelector('[data-week-card] .empty--line') ? document.querySelector('[data-week-card] .empty--line').offsetHeight : 0 })`);
    await shot(browser, s, 'states-quiet-desktop-dark');
    mode = 'pass';
    await evalIn(browser, s, "document.querySelector('[data-week-card] [data-retry]').click()");
    const cardBack = await until(browser, s, "!document.querySelector('[data-week-card] [data-state]')", 15000);
    result('states: the week card that could not load is one quiet line, read out politely, and Try again asks again',
      card.state === 'unavailable' && card.role === 'status' && card.retry && /Your week could not be loaded/.test(card.text) && card.line > 0 && card.line < 60 && cardBack, { card, cardBack });
    await browser.send('Fetch.disable', {}, s);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkStates;
