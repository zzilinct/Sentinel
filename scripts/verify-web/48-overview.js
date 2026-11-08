'use strict';
/**
 * overview  The top of the Overview and the pages beside it, signed in on Free on the real server. The Overview leads
 *           with the box (nothing between the greeting and it), then at most one notice, chosen by state: none while
 *           every allowance has more than a quarter left, one line when one is nearly gone or gone. Then one card:
 *           whether Sentinel is watching, and the week's headline as the server counts it. No list of allowances, no
 *           locked advert. The sidebar holds one allowance, the one closest to running out, and is never cut off. Your
 *           week sets this week against nothing (half a week beside a whole one read as a drop) and draws its bar as
 *           still filling. The AI assistants key box has an icon the size of the search box's, not a padlock filling
 *           it. On a phone the Overview fetches no 3D models (app-lux.css hides the mask there); on a computer they
 *           are asked for only after the page has loaded.
 *           Pictures: overview-<state>-<size>-<theme>.png, week-<size>-<theme>.png, assistants-<size>-<theme>.png.
 */
const { DatabaseSync } = require('node:sqlite');
const { sleep, result, launch, evalIn, openPage, goto, shot, startServer, watchErrors, until } = require('./_shared');

const SIZES = { phone: [390, 844, true], desktop: [1366, 900, false] };
const WEEK = 7 * 24 * 3600e3;
const weekStart = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); };

// What the top of the Overview is made of, read in the page.
const TOP = `(() => { const v = document.querySelector('#view .view'); const kids = [...v.children];
  const card = v.querySelector('.week-card');
  return { first: kids[0] && kids[0].className, second: kids[1] && kids[1].tagName + '.' + kids[1].className,
    notices: [...document.querySelectorAll('#view .top-notice, #view .verify-bar, #view .banner')].map((n) => n.innerText.replace(/\\s+/g, ' ').trim()),
    lists: v.querySelectorAll('.usage-list, .usage-row, .locked').length,
    card: card && { guard: (card.querySelector('.week-card__guard')?.innerText || '').replace(/\\s+/g, ' ').trim(), h: card.querySelector('h2')?.textContent, busy: card.querySelector('[aria-busy]') !== null,
      index: kids.indexOf(card) },
    side: (document.querySelector('[data-usage-mini]')?.innerText || '').replace(/\\s+/g, ' ').trim(), meters: document.querySelectorAll('[data-usage-mini] .meter').length }; })()`;

async function checkOverview() {
  const server = await startServer('overview');
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: ${body ? "'POST'" : "'GET'"}, credentials: 'same-origin', ${body ? `headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))}` : ''} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
    const size = async (name, theme) => {
      const [width, height, mobile] = SIZES[name];
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    };
    const settled = "document.querySelector('.week-card') && !document.querySelector('.week-card [aria-busy]') && document.querySelector('[data-recent] .list, [data-recent] .empty, [data-recent] .muted')";

    await size('desktop', 'dark');
    await goto(browser, s, `${base}/login`);
    const email = `overview-${Date.now()}@example.com`;
    const password = 'Overview-Lamp-2026';
    const a = await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    const b = await api('/auth/login', { email, password });
    if (a.status !== 201 || b.status !== 200) throw new Error(`the test account could not sign in: ${a.status} ${b.status}`);

    // A whole last week of live scanning against two days of this one: what once read as Sentinel doing less.
    const userId = (await api('/auth/me')).body.user.id;
    const db = new DatabaseSync(server.dbPath);
    const now = weekStart(Date.now());
    const put = db.prepare('INSERT INTO usage_counters (user_id, week, metric, used) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, week, metric) DO UPDATE SET used = excluded.used');
    for (const [week, metric, n] of [[now - WEEK, 'live_links', 412], [now - WEEK, 'live_flagged', 3], [now - 2 * WEEK, 'live_links', 260], [now, 'live_links', 37], [now, 'live_flagged', 1]]) put.run(userId, week, metric, n);
    db.close();
    const week = (await api('/week')).body.weeks.at(-1);

    /* -------------------------------------------------------- a fresh Overview */

    const fresh = {};
    for (const name of Object.keys(SIZES)) {
      for (const theme of ['dark', 'light']) {
        await size(name, theme);
        await goto(browser, s, `${base}/app`, settled);
        await sleep(300);
        fresh[`${name}-${theme}`] = await evalIn(browser, s, TOP);
        await shot(browser, s, `overview-fresh-${name}-${theme}`);
      }
    }
    const f = fresh['desktop-dark'];
    result('overview: the box comes straight after the greeting, then one card, and no list of allowances or locked advert',
      /page-title/.test(f.first) && /^FORM\.scanbox/.test(f.second) && !f.lists && f.card && f.card.index > 1 && f.card.index <= 4, f);
    result('overview: with every allowance mostly left there is no notice at all', Object.values(fresh).every((t) => !t.notices.length), fresh);
    result('overview: the card says whether Sentinel is watching, then the week as the server counts it',
      Boolean(f.card) && !f.card.busy && f.card.h === week.headline && /Sentinel app for Windows/.test(f.card.guard), { card: f.card, week: week.headline });
    result('overview: the sidebar holds one allowance, the one closest to running out', f.meters === 1 && /^Fast scans 10 left Resets in \d+ (day|hour)s?$/.test(f.side), f.side);

    // The sidebar's foot on a laptop screen: the allowance is in view without scrolling the sidebar.
    const clip = {};
    for (const [w, hgt] of [[1366, 768], [1280, 720]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: false }, s);
      await sleep(250);
      clip[`${w}x${hgt}`] = await evalIn(browser, s, "(() => { const side = document.querySelector('.side'); const r = document.querySelector('[data-usage-mini]').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), view: side.clientHeight, scrolls: side.scrollHeight > side.clientHeight }; })()");
    }
    result('overview: the sidebar\'s allowance is never cut off on a laptop screen (1366x768, 1280x720)', Object.values(clip).every((c) => c.top >= 0 && c.bottom <= c.view), clip);

    /* ------------------------------------------------- the 3D mask and the phone */

    await size('phone', 'dark');
    await goto(browser, s, `${base}/app`, settled);
    await sleep(2500);
    const phone = await evalIn(browser, s, "({ masks: document.querySelectorAll('[data-mask3d]').length, fetched: performance.getEntriesByType('resource').filter((e) => /mask3d\\.js|\\.glb|onyx\\.webp/.test(e.name)).map((e) => e.name.split('/').pop()) })");
    result('overview: on a phone, where the mask is hidden, no 3D models or mask picture are fetched', !phone.masks && !phone.fetched.length, phone);
    await size('desktop', 'dark');
    await goto(browser, s, `${base}/app`, settled);
    await until(browser, s, "performance.getEntriesByType('resource').some((e) => /mask3d\\.js/.test(e.name))", 12000);
    const desk = await evalIn(browser, s, "(() => { const nav = performance.getEntriesByType('navigation')[0]; const m = performance.getEntriesByType('resource').find((e) => /mask3d\\.js/.test(e.name)); return { mask: Boolean(document.querySelector('.lux-mask [data-mask3d]')), loaded: Math.round(nav.loadEventEnd), asked: m ? Math.round(m.startTime) : null }; })()");
    result('overview: on a computer the mask is there, and its models are asked for only after the page has loaded', desk.mask && desk.asked !== null && desk.asked >= desk.loaded, desk);

    /* ------------------------------------------------------- your week */

    const weekPage = {};
    for (const name of Object.keys(SIZES)) {
      for (const theme of ['dark', 'light']) {
        await size(name, theme);
        await goto(browser, s, `${base}/app/week`, "document.querySelector('.week-bars')");
        await sleep(300);
        weekPage[`${name}-${theme}`] = await evalIn(browser, s, "(() => { const cols = [...document.querySelectorAll('.week-bars__col')]; const last = cols.at(-1); return { rows: (document.querySelector('.week-rows')?.innerText || '').replace(/\\s+/g, ' '), now: last && last.classList.contains('is-now'), label: last && last.querySelector('span').textContent, aria: document.querySelector('.week-bars').getAttribute('aria-label'), others: cols.slice(0, -1).some((c) => c.classList.contains('is-now')), over: document.documentElement.scrollWidth - innerWidth }; })()");
        await shot(browser, s, `week-${name}-${theme}`);
      }
    }
    const wk = weekPage['desktop-dark'];
    result('your week: this week is set against nothing, not against a whole last week', Object.values(weekPage).every((x) => !/last week/i.test(x.rows)) && /Links checked by live scanning 37/.test(wk.rows), weekPage);
    result('your week: this week\'s bar is drawn as still filling, and said to be so far', wk.now && !wk.others && wk.label === 'So far' && /This week, so far: 1$/.test(wk.aria), wk);
    result('your week: nothing is wider than the screen', Object.values(weekPage).every((x) => x.over <= 0), Object.fromEntries(Object.entries(weekPage).map(([k, x]) => [k, x.over])));

    /* --------------------------------------------------------- AI assistants */

    const lock = {};
    for (const name of Object.keys(SIZES)) {
      for (const theme of ['dark', 'light']) {
        await size(name, theme);
        await goto(browser, s, `${base}/app/assistants`, "document.querySelector('[data-connect]')");
        await sleep(200);
        lock[`${name}-${theme}`] = await evalIn(browser, s, "(() => { const r = (document.querySelector('[data-connect] > svg') || document.body).getBoundingClientRect(); const q = document.querySelector('[data-connect]').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), box: Math.round(q.height) }; })()");
        await shot(browser, s, `assistants-${name}-${theme}`);
      }
    }
    result('ai assistants: the key box\'s padlock is icon sized (24 px at most), never filling the box', Object.values(lock).every((l) => l.w > 0 && l.w <= 24 && l.h <= 24 && l.box <= 64), lock);

    /* ------------------------------------------ one notice, when an allowance is low */

    await size('desktop', 'dark');
    for (let i = 0; i < 8; i++) await api('/scan/link', { url: `https://example.com/overview-${i}`, mode: 'fast' });
    const low = {};
    for (const name of Object.keys(SIZES)) {
      for (const theme of ['dark', 'light']) {
        await size(name, theme);
        await goto(browser, s, `${base}/app`, settled);
        await sleep(300);
        low[`${name}-${theme}`] = await evalIn(browser, s, TOP);
        await shot(browser, s, `overview-low-${name}-${theme}`);
      }
    }
    const l = low['desktop-dark'];
    result('overview: with 2 of 10 fast scans left, one calm line says so, with when more come, and the sidebar names the same one',
      Object.values(low).every((t) => t.notices.length === 1) && /^2 of 10 fast scans left this week\. More in \d+ (day|hour)s?\. Plan & usage$/.test(l.notices[0]) && /^Fast scans 2 left/.test(l.side), l);
    for (let i = 8; i < 10; i++) await api('/scan/link', { url: `https://example.com/overview-${i}`, mode: 'fast' });
    await goto(browser, s, `${base}/app`, settled);
    const gone = await evalIn(browser, s, TOP);
    await shot(browser, s, 'overview-none-desktop-dark');
    result('overview: with none left, the line says so and when they come back', gone.notices.length === 1 && /^No fast scans left this week\. They come back in \d+ (day|hour)s?\./.test(gone.notices[0]), gone);

    result('overview: no errors on the page', !errors.length, errors);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkOverview;
