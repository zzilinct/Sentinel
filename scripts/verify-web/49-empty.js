'use strict';
/**
 * empty     Empty places, entrances and the sidebar's marker (app.js emptyState, app-lux.js), signed in on a new account
 *           with motion on: a page enters the first time it opens in a session and is simply there when it comes back
 *           (by the sidebar or a reload); History with no scans says so beside the still onyx mask and offers Check,
 *           which goes there; a search with no match says that, with a seal, and one press shows every scan again; a
 *           browser checkup's earned good news wears a tick and what could not be read a bar; nothing in an empty place
 *           animates; the sidebar's raised plate is one object, and it travels between links rather than blinking.
 *           Pictures at phone and desktop size, dark and light: empty-<state>-<size>-<theme>.png.
 */
const { sleep, result, launch, evalIn, openPage, goto, shot, startServer, watchErrors, clickSel, until } = require('./_shared');

const SIZES = { desktop: [1366, 900, false], phone: [390, 844, true] };
const CHECKUP = {
  at: Date.now(), sitesChecked: true, looked: ['Chrome'], unchecked: [],
  browsers: [{ id: 'chrome', name: 'Google Chrome', open: 'chrome', policies: null,
    places: { search: 'chrome://settings/search', notifications: 'chrome://settings/content/notifications', addons: 'chrome://extensions', startup: 'chrome://settings/onStartup', policies: 'chrome://policy' },
    profiles: [{ name: 'Person 1', addons: [], notifications: [], search: null, startup: [] }, { name: 'Work', addons: [], notifications: null, search: null, startup: [] }] }]
};

async function checkEmpty() {
  const server = await startServer('empty');
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: ${body ? "'POST'" : "'GET'"}, credentials: 'same-origin', ${body ? `headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))}` : ''} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
    await goto(browser, s, `${base}/login`);
    const email = `empty-${Date.now()}@example.com`;
    const password = 'Empty-Page-Lamp-2026';
    const a = await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    const b = await api('/auth/login', { email, password });
    if (a.status !== 201 || b.status !== 200) throw new Error(`the test account could not sign in: ${a.status} ${b.status}`);
    const emulate = async (sid, size, theme) => {
      const [width, height, mobile] = SIZES[size];
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sid);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }, sid);
    };
    const emptyReady = "document.querySelector('[data-rows] .empty')";

    /* ------------------------------------------------- entrances, once a session */

    await emulate(s, 'desktop', 'dark');
    await evalIn(browser, s, '(sessionStorage.clear(), true)');
    await goto(browser, s, `${base}/app`, "document.querySelector('#view .page-title')");
    await sleep(800);
    // Every part that is made to wait or enter, counted as it happens.
    await evalIn(browser, s, `(() => { window.__staged = new Set(); new MutationObserver((rs) => { for (const r of rs) { const c = r.target.classList;
      if (c.contains('lux-wait') || c.contains('lux-in')) window.__staged.add(r.target); } }).observe(document.getElementById('view'), { subtree: true, attributes: true, attributeFilter: ['class'] }); return true; })()`);
    const visit = async (route, ready) => {
      await evalIn(browser, s, '(window.__staged.clear(), true)');
      await clickSel(browser, s, `.side__link[data-route="${route}"]`);
      await sleep(120);
      const ghost = await evalIn(browser, s, "Boolean(document.querySelector('.lux-ghost'))");
      await until(browser, s, ready, 10000);
      await sleep(2200);
      return evalIn(browser, s, `(() => { const w = document.querySelector('#view .lux-word'); return { ghost: ${ghost}, staged: window.__staged.size,
        again: document.getElementById('view').classList.contains('lux-again'), word: w ? getComputedStyle(w).animationName : null,
        still: [...document.querySelectorAll('#view .lux-word')].every((x) => getComputedStyle(x).transform === 'none') }; })()`);
    };
    const first = await visit('history', emptyReady);
    await visit('home', "document.querySelector('#view [data-recent] .empty, #view [data-recent] .list')");
    const back = await visit('history', emptyReady);
    result('empty: a page enters the first time it opens (its parts staged, its headline rising), and on a return is simply there: nothing staged, no headline rising, no old headline fading over it',
      first.staged > 0 && !first.again && first.word === 'lux-word' && back.staged === 0 && back.again && back.word === 'none' && back.still && !back.ghost, { first, back });
    await goto(browser, s, `${base}/app/history`, emptyReady);
    await sleep(300);
    const reload = await evalIn(browser, s, "({ again: document.getElementById('view').classList.contains('lux-again'), waiting: document.querySelectorAll('#view .lux-wait').length })");
    result('empty: a reload in the same session does not replay the entrance either', reload.again && !reload.waiting, reload);

    /* ------------------------------------------------------- History, nothing yet */

    const hist = await evalIn(browser, s, `(() => { const e = document.querySelector('[data-rows] .empty'); const img = e.querySelector('.empty__mark img'); const anim = (x) => x && getComputedStyle(x).animationName;
      return { kind: [...e.classList].join(' '), text: e.querySelector('p').textContent, go: (e.querySelector('a.btn') || { getAttribute: () => null }).getAttribute('href'),
        mask: img && /\\/masks\\/onyx-480\\.webp$/.test(img.getAttribute('src')) && img.complete && img.naturalWidth > 0, seal: Boolean(e.querySelector('.empty__seal')), threat: Boolean(e.querySelector(':scope > svg, .m')),
        moving: [e, e.querySelector('.empty__mark'), img, e.querySelector('p')].map(anim).filter((n) => n && n !== 'none') }; })()`);
    result('empty: History with no scans says so beside the still onyx mask (no seal, no threat mask) and offers Check',
      /empty--waiting/.test(hist.kind) && /^No scans yet\./.test(hist.text) && hist.go === '/app/check' && hist.mask && !hist.seal && !hist.threat && !hist.moving.length, hist);

    /* ---------------------------------------------------------- the sidebar's plate */

    const plateAt = `(() => { const nav = document.querySelector('.side__nav'); const p = nav.querySelector('.lux-plate'); const c = nav.querySelector('[aria-current=page]');
      const r = p.getBoundingClientRect(); const l = c.getBoundingClientRect(); const cs = getComputedStyle(c);
      return { plates: nav.querySelectorAll('.lux-plate').length, y: Math.round(r.top), x: Math.round(r.left), on: Math.abs(r.top - l.top) < 1.5 && Math.abs(r.left - l.left) < 1.5 && Math.abs(r.width - l.width) < 1.5,
        linkPlate: cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' }; })()`;
    const rest = await evalIn(browser, s, plateAt);
    await clickSel(browser, s, '.side__link[data-route="home"]');
    await sleep(110);
    const mid = await evalIn(browser, s, plateAt);
    await sleep(1200);
    const end = await evalIn(browser, s, plateAt);
    result('empty: the sidebar has one raised plate, on the current link (whose own plate gives way), and it travels to the next link rather than blinking there',
      rest.plates === 1 && rest.on && !rest.linkPlate && end.on && !end.linkPlate && mid.y < rest.y - 2 && mid.y > end.y + 2, { rest, mid, end });

    await until(browser, s, "document.querySelector('#view .page-title')", 10000);
    await goto(browser, s, `${base}/app/history`, emptyReady);
    await clickSel(browser, s, '[data-rows] .empty a.btn');
    const went = await until(browser, s, "location.pathname === '/app/check' && document.querySelector('[data-check-text]') && 'check'", 10000);
    result('empty: the empty History\'s Check something goes to Check', went === 'check', went);

    /* ------------------------------------------------------------- pictures, nothing yet */

    for (const size of Object.keys(SIZES)) {
      for (const theme of ['dark', 'light']) {
        await emulate(s, size, theme);
        await goto(browser, s, `${base}/app/history`, emptyReady);
        await evalIn(browser, s, "(document.querySelector('[data-rows] .empty').scrollIntoView({ block: 'center' }), true)");
        await sleep(700);
        await shot(browser, s, `empty-history-${size}-${theme}`);
        await evalIn(browser, s, '(scrollTo(0, 0), true)');
        await sleep(200);
        await clickSel(browser, s, '.side__link[data-route="home"]');
        await shot(browser, s, `empty-plate-moving-${size}-${theme}`);
        await sleep(900);
        await goto(browser, s, `${base}/app/week`, "document.querySelector('#view .empty')");
        await evalIn(browser, s, "(document.querySelector('#view .empty').scrollIntoView({ block: 'center' }), true)");
        await sleep(500);
        await shot(browser, s, `empty-week-${size}-${theme}`);
      }
    }

    /* ----------------------------------------------------- a search with no match */

    const scanned = await api('/scan/link', { url: 'https://github.com', mode: 'fast' });
    await emulate(s, 'desktop', 'dark');
    await goto(browser, s, `${base}/app/history`, "document.querySelector('[data-rows] .list')");
    const search = async (q) => evalIn(browser, s, `(() => { const i = document.querySelector('[data-q]'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await search('no-such-site-zzz');
    const none = await until(browser, s, "(() => { const e = document.querySelector('[data-rows] .empty--nomatch'); return e && { text: e.querySelector('p').textContent, seal: Boolean(e.querySelector('.empty__seal svg')), all: Boolean(e.querySelector('[data-show-all]')) }; })()", 5000);
    if (none) await clickSel(browser, s, '[data-show-all]');
    await sleep(200);
    const shown = await evalIn(browser, s, "({ rows: document.querySelectorAll('[data-rows] li').length, q: document.querySelector('[data-q]').value, all: document.querySelector('[data-filter=all]').getAttribute('aria-pressed'), focus: document.activeElement.dataset.filter || document.activeElement.tagName })");
    result('empty: a search with no match says it is the search, with a seal, and Show every scan brings the list back with the focus on All',
      scanned.status === 200 && Boolean(none) && /no-such-site-zzz/.test(none.text) && none.seal && shown.rows >= 1 && shown.q === '' && shown.all === 'true' && shown.focus === 'all', { scan: scanned.status, none, shown });
    for (const size of Object.keys(SIZES)) {
      for (const theme of ['dark', 'light']) {
        await emulate(s, size, theme);
        await goto(browser, s, `${base}/app/history`, "document.querySelector('[data-rows] .list')");
        await search('no-such-site-zzz');
        await until(browser, s, "document.querySelector('[data-rows] .empty--nomatch')", 5000);
        await evalIn(browser, s, "(document.activeElement.blur(), document.querySelector('[data-rows] .empty').scrollIntoView({ block: 'center' }), true)");
        await sleep(400);
        await shot(browser, s, `empty-nomatch-${size}-${theme}`);
      }
    }
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, s);
    result('empty: no console errors', !errors.length, errors.slice(0, 5));

    /* ------------------------------------------- earned good news, and what could not be read */

    // The Windows app, stood in for: a browser checkup that read one profile with nothing in it and could not read another's notifications.
    const { sessionId: q } = await openPage(browser);
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.sentinelDesktop = { info: () => Promise.reject(new Error('stand-in')), browserCheckup: () => Promise.resolve(${JSON.stringify(CHECKUP)}) };` }, q);
    let marks = null;
    for (const size of Object.keys(SIZES)) {
      for (const theme of ['dark', 'light']) {
        await emulate(q, size, theme);
        await goto(browser, q, `${base}/app/checkup`, "document.querySelector('[data-run-checkup]')");
        await clickSel(browser, q, '[data-run-checkup]');
        await until(browser, q, "document.querySelector('[data-checkup-out] .empty--clear')", 10000);
        marks = marks || await evalIn(browser, q, `(() => { const k = (c) => [...document.querySelectorAll('[data-checkup-out] .empty--' + c)].map((e) => ({ text: e.textContent.trim(), seal: (e.querySelector('.empty__seal svg') || {}).innerHTML || '' }));
          return { clear: k('clear'), unavailable: k('unavailable') }; })()`);
        await evalIn(browser, q, "(document.querySelector('[data-checkup-out] .empty--clear').scrollIntoView({ block: 'start' }), scrollBy(0, -90), true)");
        await sleep(500);
        await shot(browser, q, `empty-checkup-${size}-${theme}`);
      }
    }
    result('empty: in a checkup, nothing found where Sentinel read wears a tick, and what it could not read wears a bar, never the same mark',
      marks && marks.clear.length === 3 && marks.unavailable.length === 1 && /No add-ons|No site may send/.test(marks.clear[0].text) && /could not be read/.test(marks.unavailable[0].text)
        && marks.clear[0].seal && marks.unavailable[0].seal && marks.clear[0].seal !== marks.unavailable[0].seal, marks);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkEmpty;
