'use strict';
/**
 * public    The public site as a visitor meets it, on the real server and as the static build: each page's load time,
 *           heading and console; every link on every page answers (on this site and off it); links to a part of a
 *           page land on something; the Try a link box and the guest scan, including a double press; a real 404 for
 *           an address that does not exist; and the skip link first for the keyboard.
 */
const fs = require('fs');
const { STATIC, sleep, result, launch, evalIn, openPage, goto, shot, typeText, pressEnter, startServer, serveFiles, watchErrors, clickSel, pressKey, until } = require('./_shared');

const PAGES = ['/', '/pricing', '/download', '/privacy', '/terms', '/refunds', '/recover', '/practice', '/login', '/signup', '/forgot', '/guest'];

/** Every link's status, each address asked once. Off-site pages that refuse robots (403, 429) are noted, not failed. */
async function statuses(urls) {
  const out = {};
  await Promise.all([...urls].map(async (u) => {
    for (let i = 0; i < 2 && !out[u]; i++) {
      try {
        const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' } });
        out[u] = r.status;
      } catch (err) { if (i) out[u] = `unreachable (${err.cause ? err.cause.code || err.cause.message : err.message})`; }
    }
  }));
  return out;
}

async function crawl(browser, s, base, pages, label) {
  const errors = await watchErrors(browser, s);
  const found = [];
  const links = new Set();
  const external = new Set();
  const anchors = [];
  for (const p of pages) {
    const before = errors.length;
    await goto(browser, s, base + p);
    await sleep(900);
    const info = await evalIn(browser, s, `(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /^https?:/.test(h));
      const hashes = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.getElementById(h.slice(1)));
      return { load: Math.round(nav.loadEventEnd || 0), dcl: Math.round(nav.domContentLoadedEventEnd || 0), h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim().replace(/\\s+/g, ' ')).filter(Boolean), title: document.title, hrefs, hashes };
    })()`);
    for (const h of info.hrefs) (h.startsWith(base) ? links : external).add(h.split('#')[0]);
    if (info.hashes.length) anchors.push(`${p}: ${info.hashes.join(', ')}`);
    found.push({ page: p, ...info, errors: errors.slice(before) });
  }
  result(`public ${label}: every page loads in under 3 s, with one h1 and a title`, found.every((f) => f.load < 3000 && f.h1.length === 1 && f.title),
    found.map((f) => `${f.page} ${f.load} ms (ready ${f.dcl} ms), h1 ${JSON.stringify(f.h1)}`));
  const noisy = found.filter((f) => f.errors.filter((e) => !/status of 401/.test(e)).length);
  result(`public ${label}: no page logs a console error`, !noisy.length, noisy.map((f) => `${f.page}: ${f.errors.join(' ; ')}`));
  result(`public ${label}: every link to a part of a page lands on something`, !anchors.length, anchors);
  return { links, external };
}

async function checkPublic() {
  const server = await startServer('public');
  const { base } = server;
  const files = fs.existsSync(STATIC) ? await serveFiles({ '/': STATIC }) : null;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);

    /* --------------------------------------------- pages and their links */

    const live = await crawl(browser, s, base, PAGES, 'site');
    const own = await statuses(live.links);
    const broken = Object.entries(own).filter(([, st]) => st !== 200);
    result('public site: every link to a page on this site answers', !broken.length, broken.length ? broken.map(([u, st]) => `${st} ${u.replace(base, '')}`) : `${Object.keys(own).length} links`);
    let staticLinks = { links: new Set(), external: new Set() };
    if (files) {
      staticLinks = await crawl(browser, s, files.base, ['/index.html', '/pricing.html', '/download.html', '/privacy.html', '/terms.html', '/refunds.html', '/recover.html', '/practice.html'], 'static build');
      const st = await statuses(staticLinks.links);
      const bad = Object.entries(st).filter(([, x]) => x !== 200);
      result('public static build: every link to a page on the static site answers', !bad.length, bad.length ? bad.map(([u, x]) => `${x} ${u.replace(files.base, '')}`) : `${Object.keys(st).length} links`);
    }
    const ext = await statuses(new Set([...live.external, ...staticLinks.external].filter((u) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u))));
    const dead = Object.entries(ext).filter(([, st]) => typeof st !== 'number' || (st >= 400 && ![401, 403, 405, 429, 999].includes(st)));
    result('public: every link off the site answers (pages that refuse robots, 401/403/429, noted only)', !dead.length,
      [...dead.map(([u, st]) => `${st} ${u}`), `checked: ${Object.entries(ext).map(([u, st]) => `${st} ${u}`).join(', ')}`]);

    /* ------------------------------------------------------------- 404s */

    const notFound = await fetch(`${base}/no-such-page`);
    const notFoundText = await notFound.text();
    const asset = await fetch(`${base}/assets/js/no-such-file.js`);
    await goto(browser, s, `${base}/no-such-page`);
    await sleep(800);
    const page404 = await evalIn(browser, s, "({ h1: document.querySelector('h1').textContent.trim(), home: Boolean(document.querySelector('main a[href=\"/\"]')), title: document.title })");
    await shot(browser, s, 'public-404');
    result('public: an address that does not exist answers 404 with a page that says so and leads home', notFound.status === 404 && /Nothing behind this mask/.test(notFoundText) && page404.home, { status: notFound.status, ...page404 });
    result('public: a missing file answers 404, not a page', asset.status === 404 && !/<html/i.test(await asset.text()), asset.status);
    const trailing = await fetch(`${base}/pricing/`, { redirect: 'follow' });
    result('public: /pricing/ with a trailing slash still reaches the page', trailing.status === 200 && /<h1/.test(await trailing.text()), trailing.status);

    /* ------------------------------------------- Try a link and guest scan */

    await goto(browser, s, `${base}/`, "document.querySelector('[data-try-form]')");
    await sleep(1500);
    await evalIn(browser, s, "(() => { const f = document.querySelector('[data-try-form]'); f.elements.url.scrollIntoView({ block: 'center' }); f.elements.url.focus(); })()");
    await typeText(browser, s, 'paypa1-secure-login.com');
    let t = Date.now();
    await pressEnter(browser, s);
    const tried = await until(browser, s, "(() => { const r = document.querySelector('[data-try-out] .try__result, [data-try-out] .result, [data-try-out] [data-result]'); return r && r.innerText.replace(/\\s+/g, ' ').slice(0, 140); })()", 20000);
    await shot(browser, s, 'public-try');
    result('public: Try a link on the home page warns about a listed scam, in under 5 s', Boolean(tried) && Date.now() - t < 5000 && !/No threats found|No warning signs/.test(tried), { tried, ms: Date.now() - t });

    await goto(browser, s, `${base}/guest`, "document.querySelector('[data-form] input')");
    await sleep(800);
    await evalIn(browser, s, "(() => { const i = document.querySelector('[data-form] input'); i.focus(); })()");
    await typeText(browser, s, 'https://github.com');
    t = Date.now();
    await pressEnter(browser, s);
    const guest = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-result]'); return r && { title: r.querySelector('h2').textContent.trim(), left: document.querySelector('[data-left]').textContent }; })()", 20000);
    result('public: a guest scan answers without an account and counts down what is left today', Boolean(guest) && /9 of 10/.test(guest.left), { ...guest, ms: Date.now() - t });
    const ex = await evalIn(browser, s, "Boolean(document.querySelector('[data-example]'))");
    if (ex) {
      await clickSel(browser, s, '[data-example]');
      await sleep(60);
      await clickSel(browser, s, '[data-example]');
      const flash = await until(browser, s, "/Scan failed/.test(document.querySelector('[data-out]').innerText) && document.querySelector('[data-out]').innerText.slice(0, 160)", 2500);
      await until(browser, s, "document.querySelector('[data-out] [data-result]')", 20000);
      const left = await evalIn(browser, s, "document.querySelector('[data-left]').textContent");
      result('public: a double press on a guest example scans once, never flashing "Scan failed"', !flash && /8 of 10/.test(left), { flash, left });
    }

    /* -------------------------------------------------------- keyboard */

    const firstTab = {};
    for (const p of ['/', '/pricing', '/login']) {
      await goto(browser, s, base + p);
      await sleep(600);
      await pressKey(browser, s, 'Tab');
      firstTab[p] = await evalIn(browser, s, "(() => { const e = document.activeElement; const r = e.getBoundingClientRect(); return { text: (e.textContent || '').trim().slice(0, 30), href: e.getAttribute('href'), seen: r.width > 0 && r.top >= 0 && r.top < innerHeight }; })()");
    }
    result('public: the first Tab on a page lands on a visible "Skip to content" link', Object.values(firstTab).every((f) => /skip/i.test(f.text) && f.seen), firstTab);
  } finally {
    await close();
    await server.stop();
    if (files) files.server.close();
  }
}

module.exports = checkPublic;
