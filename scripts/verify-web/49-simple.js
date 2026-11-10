'use strict';
/**
 * simple  Simple view as a person uses it: switched on in Settings (Appearance), it hides the pages most people do not
 *         need from the side bar and the search palette (which ends with Show all pages, and still finds every page by
 *         name), and a result keeps its answer, what was not checked and what to do, in bigger words, with Show
 *         details bringing the rest back. A partly checked result never loses the line that says so. Switched off,
 *         everything is back. Real scans from the real server; a scam and a partly checked site.
 *         Pictures: simple-<state>-<size>-<theme>.png, simple-full-scam-desktop-dark.png (the same result in full
 *         view, for comparison), simple-details-scam-phone-dark.png, simple-side-desktop-<theme>.png.
 */
const fs = require('fs');
const path = require('path');
const { OUT, sleep, result, launch, evalIn, openPage, goto, startServer, watchErrors, until, shot, markLists } = require('./_shared');

const SIZES = { desktop: [1366, 900, false], phone: [390, 844, true] };
const THEMES = ['dark', 'light'];
const STATES = { scam: ['https://paypa1-secure-login.com/account/verify', false], partly: ['https://example-bakery.com/', true] };

const RESULT = "document.querySelector('[data-out] [data-result]')";
const READ = `(() => { const r = ${RESULT}; const seen = (q) => { const e = typeof q === 'string' ? r.querySelector(q) : q; return Boolean(e && e.checkVisibility()); };
  const actions = document.querySelector('[data-out] .actions');
  return { simple: document.documentElement.dataset.simple !== undefined, tone: [...r.classList].find((c) => /^result--/.test(c)), title: r.querySelector('h2').textContent.trim(),
    h2: parseFloat(getComputedStyle(r.querySelector('h2')).fontSize), lead: seen('.result__lead'), partly: seen('[data-partly]'), notRun: seen('[data-not-run]'),
    steps: seen('.next-steps'), reasons: seen('.reasons'), more: seen('.result__more'), details: seen('[data-details]'), actions: Boolean(actions && actions.checkVisibility()),
    wide: document.documentElement.scrollWidth - innerWidth }; })()`;

async function checkSimple() {
  const server = await startServer('simple');
  const { base, dbPath } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await goto(browser, s, `${base}/login`);
    const email = `simple-${Date.now()}@example.com`;
    const password = 'Simple-Check-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });
    await api('/billing/plan', { plan: 'max' });

    const media = (theme) => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    const size = ([width, height, mobile]) => browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
    const scan = async (url) => {
      await goto(browser, s, `${base}/app/check?url=${encodeURIComponent(url)}`);
      return until(browser, s, `${RESULT} && !document.querySelector('[data-out] .scanning')`, 40000);
    };
    // The whole answer, however tall: the app's own scrolling boxes laid out at full height for the picture.
    const picture = async (name) => {
      const clip = await evalIn(browser, s, `(() => {
        for (const el of document.querySelectorAll('main, .main, .view')) { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; }
        document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
        const r = document.querySelector('[data-out]').getBoundingClientRect();
        return { x: Math.max(0, r.left + scrollX - 8), y: Math.max(0, r.top + scrollY - 8), width: Math.min(r.width + 16, innerWidth), height: Math.min(r.height + 16, 3800) };
      })()`);
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } }, s);
      fs.writeFileSync(path.join(OUT, `simple-${name}.png`), Buffer.from(data, 'base64'));
    };

    /* ------------------------------------------------------------ full view, as it is */
    await size(SIZES.desktop);
    await media('dark');
    markLists(dbPath, false);
    await scan(STATES.scam[0]);
    await sleep(500);
    const full = await evalIn(browser, s, READ);
    result('simple: full view is the default, with every part of the result shown', !full.simple && full.reasons && full.more && full.actions && !full.details, full);
    await picture('full-scam-desktop-dark');

    /* ------------------------------------------------------------ switched on in Settings */
    await goto(browser, s, `${base}/app/settings#simple-view`, "document.querySelector('#set-simple-view-c')");
    await evalIn(browser, s, "document.querySelector('#set-simple-view-c').click()");
    await sleep(600);
    const on = await evalIn(browser, s, `({ simple: document.documentElement.dataset.simple !== undefined, checked: document.querySelector('#set-simple-view-c').checked,
      kept: localStorage.getItem('sentinel:simple'), toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '),
      sites: document.querySelector('.side a[href="/app/sites"]').checkVisibility(), history: document.querySelector('.side a[href="/app/history"]').checkVisibility() })`);
    result('simple: the Settings switch turns it on at once, remembers it on this device and says what changed', on.simple && on.checked && on.kept === '1' && /Simple view is on/.test(on.toast), on);
    result('simple: the side bar tucks away Site rules and keeps History', !on.sites && on.history, on);
    for (const theme of THEMES) { await media(theme); await sleep(200); await shot(browser, s, `simple-side-desktop-${theme}`); }

    // The palette: the pages most people need, then Show all pages; a search still finds a tucked-away page.
    await evalIn(browser, s, "document.querySelector('[data-palette]').click()");
    const options = () => evalIn(browser, s, "[...document.querySelectorAll('.palette__list [role=option]')].map((o) => o.querySelector('.palette__label') ? o.querySelector('.palette__label').textContent : '')");
    const short = await options();
    await evalIn(browser, s, "(() => { const i = document.querySelector('.palette input'); const n = [...document.querySelectorAll('.palette__list [role=option]')].findIndex((o) => /Show all pages/.test(o.textContent)); for (let k = 0; k < n; k++) i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
    await sleep(200);
    const all = await options();
    const still = await evalIn(browser, s, "Boolean(document.querySelector('.palette')) && document.activeElement === document.querySelector('.palette input')");
    await evalIn(browser, s, "(() => { const i = document.querySelector('.palette input'); i.value = 'checkup'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
    const found = await options();
    await evalIn(browser, s, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    result('simple: the palette lists the main pages and ends with Show all pages', !short.includes('Site rules') && short.includes('History') && short.includes('Show all pages'), short);
    result('simple: Show all pages lists every page, and the palette stays open with the cursor in it', all.includes('Site rules') && all.includes('Plan & usage') && !all.includes('Show all pages') && still, { all, still });
    result('simple: a search still finds a tucked-away page', found.includes('Browser checkup'), found);

    /* ------------------------------------------------------------ results in simple view */
    const seen = {};
    for (const [state, [url, missing]] of Object.entries(STATES)) {
      markLists(dbPath, missing);
      for (const [name, dims] of Object.entries(SIZES)) {
        await size(dims);
        for (const theme of THEMES) {
          await media(theme);
          await scan(url);
          await sleep(500);
          seen[`${state}-${name}-${theme}`] = await evalIn(browser, s, READ);
          await picture(`${state}-${name}-${theme}`);
        }
      }
    }
    const each = Object.entries(seen);
    result('simple: a result keeps its answer and drops the clues, the checklist and the actions until asked',
      each.every(([, r]) => r.simple && r.lead && !r.reasons && !r.more && !r.actions && r.details), seen);
    result('simple: a scam keeps what to do now, in red', each.filter(([k]) => k.startsWith('scam')).every(([, r]) => r.tone === 'result--red' && r.steps), seen);
    result('simple: partly checked keeps the line that says so, and the line of what did not run (never a false all clear)',
      each.filter(([k]) => k.startsWith('partly')).every(([, r]) => r.tone === 'result--partial' && r.partly && r.notRun), seen);
    result('simple: the answer is in bigger words than in full view', seen['scam-desktop-dark'].h2 > full.h2, { simple: seen['scam-desktop-dark'].h2, full: full.h2 });
    result('simple: nothing scrolls sideways on a phone', each.every(([, r]) => r.wide <= 0), each.map(([k, r]) => `${k}: ${r.wide}`));

    // Show details, by keyboard: everything comes back for this result, and goes again.
    await size(SIZES.phone);
    await media('dark');
    await scan(STATES.scam[0]);
    await evalIn(browser, s, "(() => { const b = document.querySelector('[data-details]'); b.focus(); b.click(); })()");
    await sleep(300);
    const open = await evalIn(browser, s, `(() => { const r = ${READ}; const b = document.querySelector('[data-details]'); return { ...r, expanded: b.getAttribute('aria-expanded'), words: b.textContent.trim(), focus: document.activeElement === b }; })()`);
    await picture('details-scam-phone-dark');
    await evalIn(browser, s, "document.querySelector('[data-details]').click()");
    const shut = await evalIn(browser, s, READ);
    result('simple: Show details brings back the clues, the checklist and the actions, and Hide details tucks them away again',
      open.reasons && open.more && open.actions && open.expanded === 'true' && open.words === 'Hide details' && open.focus && !shut.more && !shut.actions, { open, shut });

    /* ------------------------------------------------------------ switched off */
    await goto(browser, s, `${base}/app/settings#simple-view`, "document.querySelector('#set-simple-view-c')");
    await evalIn(browser, s, "document.querySelector('#set-simple-view-c').click()");
    await sleep(600);
    await scan(STATES.scam[0]);
    const back = await evalIn(browser, s, READ);
    result('simple: switched off, every page and detail is back', !back.simple && back.reasons && back.more && back.actions && !back.details, back);

    result('simple: no errors on the page', !errors.length, errors);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkSimple;
