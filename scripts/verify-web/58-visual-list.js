'use strict';
/**
 * visual-list  The list of what must be on screen, page by page, as one check. Every public page and every page of the
 *              signed-in app is opened as a person meets it (a computer and a 360 px phone, light and dark, standard
 *              and Larger text, gold and two other colours, with and without motion), scrolled through once so every
 *              entrance has played, and each item on its list is found and judged: it is there, shown, not empty, not
 *              transparent, not off the screen, not clipped by what holds it, not under something else, and (for a
 *              picture drawn in a canvas) really drawn. A sweep of every heading, button and field on the page is
 *              judged the same way, for what nobody thought to list. An item that fails is never taken off the list.
 *              Also: the bottom bar never covers the end of a phone page, the answer's first sentence stands above it,
 *              the status colours are the same in every colour, no page throws, and the web fonts arriving moves
 *              nothing (the stand-in fonts' sizes, measured as layout shift). Pictures: list-<page>-<setup>.png.
 */
const path = require('path');
const { ROOT, sleep, result, launch, evalIn, openPage, startServer, watchErrors, goto, shot, until } = require('./_shared');
const L = require(path.join(ROOT, 'web', 'assets', 'js', 'look.js'));

const COINS = L.ACCENTS.length;
const DESKTOP = { width: 1366, height: 900, mobile: false, dsf: 1 };
const PHONE = { width: 360, height: 740, mobile: true, dsf: 2 };
// One line per setup: where, which theme, which text size, which colour, whether motion is asked for.
const SETUPS = [
  { id: 'desk-dark-gold', size: DESKTOP, scheme: 'dark', text: 'standard', accent: 'gold', motion: 'no-preference' },
  { id: 'desk-light-sapphire', size: DESKTOP, scheme: 'light', text: 'standard', accent: 'sapphire', motion: 'no-preference' },
  { id: 'desk-dark-larger-rose', size: DESKTOP, scheme: 'dark', text: 'larger', accent: 'rose', motion: 'no-preference' },
  { id: 'desk-light-larger-gold-still', size: DESKTOP, scheme: 'light', text: 'larger', accent: 'gold', motion: 'reduce' },
  { id: 'phone-dark-gold', size: PHONE, scheme: 'dark', text: 'standard', accent: 'gold', motion: 'no-preference' },
  { id: 'phone-light-larger-sapphire', size: PHONE, scheme: 'light', text: 'larger', accent: 'sapphire', motion: 'no-preference' },
  { id: 'phone-dark-larger-rose', size: PHONE, scheme: 'dark', text: 'larger', accent: 'rose', motion: 'no-preference' },
  { id: 'phone-light-gold-still', size: PHONE, scheme: 'light', text: 'standard', accent: 'gold', motion: 'reduce' }
];
const DESK = SETUPS.filter((x) => !x.size.mobile);
const PH = SETUPS.filter((x) => x.size.mobile);

/* Items: [id, selector, flags]. Flags: only 'desktop'|'phone'; dark (dark theme only); text (words, not transparent);
   canvas (really drawn); img (decoded); bg (a layer behind the page: not tested for being clipped or covered); n (at
   least this many shown); op (least opacity); min (least size in px). */
const NAV = [
  ['nav logo', '.nav .logo', { text: true }], ['nav links', '.nav__links a', { menu: 'no', n: 7, text: true, oneLine: true }],
  ['menu button', '.nav__toggle', { menu: 'yes' }], ['theme button', '.theme-toggle', { menu: 'no' }],
  ['nav buttons', '.nav__actions .btn', { menu: 'no', n: 2, text: true }]
];
const FOOT = [['footer logo', '.footer .logo', { text: true }], ['footer headings', '.footer__h', { n: 3, text: true }], ['footer base', '.footer__base', { text: true }]];
const H1 = [['heading', 'main h1', { text: true }]];
const STARS = [['stars', 'canvas.cosmos', { canvas: true, bg: true, dark: true, op: 0.2 }]];
const PUBLIC = [
  ['/', 'home', "document.querySelector('.hero__unmask') && document.querySelector('.cosmos, .hero__word')", [
    ...NAV, ...H1, ...STARS, ...FOOT,
    ['hero name', '[data-hero-word]', { top: true }], ['hero words', '.hero__lede', { text: true, top: true }],
    ['hero buttons', '.hero .hero__cta .btn', { n: 2, text: true, top: true }], ['hero essentials', '.hero__fine li', { n: 3, text: true, top: true }],
    ['hero 3D mask', '[data-hero-mask] .mask3d--ready .mask3d__canvas', { canvas: true, top: true }], ['hero what Sentinel sees', '.hero__unmask', { bg: true }],
    ['demo heading', '.sec-demo h2', { text: true }], ['galaxy', '.galaxy__canvas', { canvas: true, bg: true }], ['galaxy heading', '.sec-galaxy h2', { text: true }],
    ['masks heading', '.sec-masks h2', { text: true }], ['masks 3D', '.plate__art .mask3d__canvas', { canvas: true, n: 3 }],
    ['colour coins', '.colour__pick .swatch', { n: COINS }], ['colour preview', '.colour__crest', { text: true }], ['colour note', '.colour__note', { text: true }],
    ['how heading', '.sec-how h2', { text: true }], ['game heading', '.sec-game h2', { text: true }],
    ['try modes', '[data-try-mode]', { n: 2, text: true }], ['pricing heading', '.sec-pricing h2', { text: true }],
    ['security heading', '.sec-security h2', { text: true }], ['faq heading', '.sec-faq h2', { text: true }],
    ['closing heading', '.sec-cta h2', { text: true }], ['closing mask', '.sec-cta .mask3d--ready .mask3d__canvas', { canvas: true }]
  ]],
  ['/pricing', 'pricing', 'document.querySelector("main h1")', [...NAV, ...H1, ...STARS, ...FOOT, ['plans', 'main .btn', { text: true }]]],
  ['/download', 'download', 'document.querySelector("main h1")', [...NAV, ...H1, ...STARS, ...FOOT, ['download button', '.get__offer .btn', { text: true }], ['offer mask', '.get__offer .mask3d--ready .mask3d__canvas', { canvas: true }]]],
  ['/call', 'call', 'document.querySelector("main h1")', [...NAV, ...H1, ...STARS, ...FOOT]],
  ['/recover', 'recover', 'document.querySelector("main h1")', [...NAV, ...H1, ...STARS, ...FOOT]],
  ['/practice', 'practice', 'document.querySelector("main h1")', [...NAV, ...H1, ...STARS, ...FOOT]],
  ['/privacy', 'privacy', 'document.querySelector("main h1")', [...NAV, ...H1, ...FOOT]],
  ['/terms', 'terms', 'document.querySelector("main h1")', [...NAV, ...H1, ...FOOT]],
  ['/refunds', 'refunds', 'document.querySelector("main h1")', [...NAV, ...H1, ...FOOT]],
  ['/no-such-page', 'not-found', 'document.querySelector("main h1")', [...NAV, ...H1]],
  ['/login', 'login', 'document.querySelector("form")', [['heading', 'h1', { text: true }], ['form fields', 'form input:not([type=hidden])', { text: true }], ['sign in button', 'form button[type=submit]', { text: true }]]],
  ['/signup', 'signup', 'document.querySelector("form")', [['heading', 'h1', { text: true }], ['form fields', 'form input:not([type=hidden])', { text: true }], ['create button', 'form button[type=submit]', { text: true }]]]
];
const SIDE = [
  ['app logo', '.side .logo, .topbar-mobile .logo', { text: true }], ['side links', '.side__link', { only: 'desktop', n: 9, text: true }],
  ['bar links', '.side__link[data-phone]', { only: 'phone', n: 5, text: true }], ['page title', '#view h1', { text: true }],
  ['page words', '#view .page-title p', { text: true }], ['stars', 'canvas.cosmos', { canvas: true, bg: true, dark: true, op: 0.2 }]
];
const APP = [
  ['/app', 'app-home', "document.querySelector('[data-quick]') && !document.querySelector('[data-recent] .skeleton')", [
    ...SIDE, ['check box', '[data-quick] input', {}], ['check button', '[data-quick] .btn', { text: true }],
    ['line under the check box', '.scan-meta', { text: true }], ['corner mask', '.lux-mask .mask3d--ready .mask3d__canvas', { only: 'desktop', canvas: true }],
    ['usage cards', '.usage-list .usage-link', { n: 2 }]
  ]],
  ['/app/check', 'check', "document.querySelector('[data-form]')", [
    ...SIDE, ['check box', '.ask__text', {}], ['check button', '.ask__go', { text: true }], ['add a file', '.ask__add', { text: true }],
    ['what goes here', '.ask__try', { text: true }], ['call line', '.ask__call', { text: true }]
  ]],
  ['/app/history', 'history', "document.querySelector('#view h1') && !document.querySelector('#view .skeleton')", [...SIDE]],
  ['/app/settings', 'settings', "document.querySelectorAll('[data-set-row]').length > 20", [...SIDE, ['colour coins', '#accent .look__coin', { n: COINS }], ['text size', '#text-size [data-seg]', { n: 2, text: true }]]],
  ['/app/plan', 'plan', "document.querySelector('#view h1') && !document.querySelector('#view .skeleton')", [...SIDE]],
  ['/app/sites', 'sites', "document.querySelector('#view h1') && !document.querySelector('#view .skeleton')", [...SIDE]],
  ['/app/checkup', 'checkup', "document.querySelector('#view h1') && !document.querySelector('#view .skeleton')", [...SIDE]],
  ['/app/week', 'week', "document.querySelector('#view h1') && !document.querySelector('#view .skeleton')", [...SIDE]],
  ['/app/assistants', 'assistants', "document.querySelector('#view h1') && !document.querySelector('#view .skeleton')", [...SIDE]],
  ['/app/protection', 'protection', "document.querySelector('#view h1') && !document.querySelector('#view .skeleton')", [...SIDE]]
];
// What a page has that nobody listed: every heading, button and field a person can see.
const SWEEP = 'main h1, main h2, main h3, main .btn, main button, main input:not([type=hidden]), main textarea, #view h1, #view h2, #view .btn, #view input, #view textarea';

/** Runs in the page: finds and judges each item. Returns what is wrong, one line each. */
async function audit(items, sweep, phone, dark, bottomBar) {
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const alpha = (c) => { const m = c.match(/[\d.]+/g) || []; return m.length > 3 ? Number(m[3]) : m.length ? 1 : 0; };
  const shown = (e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden' && !e.closest('[hidden], [inert], .sr-only, .skip-link, .is-out') && !(e.closest('details:not([open])') && !e.closest('summary'));
  };
  const name = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''}`;
  const why = async (e, it) => {
    scrollTo({ top: 0, behavior: 'instant' });
    if (it.top && e.getBoundingClientRect().bottom <= innerHeight) await raf();
    else if (!it.bg) { e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); await raf(); }
    const r0 = e.getBoundingClientRect();
    const min = it.min || 4;
    if (r0.width < min || r0.height < min) return `too small (${Math.round(r0.width)} by ${Math.round(r0.height)})`;
    // An entrance may still be playing (a picture fading in as it is reached): given up to a second and a half.
    let o = 0;
    for (let k = 0; k < 15 && o < (it.op || 0.5); k++) { if (k) await new Promise((r) => setTimeout(r, 100)); o = 1; for (let p = e; p && p.nodeType === 1; p = p.parentElement) o *= Number(getComputedStyle(p).opacity); }
    if (o < (it.op || 0.5)) return `transparent (opacity ${o.toFixed(2)})`;
    if (it.oneLine && e.clientHeight - parseFloat(getComputedStyle(e).paddingTop) - parseFloat(getComputedStyle(e).paddingBottom) > parseFloat(getComputedStyle(e).fontSize) * 2) return `its words wrap onto a second line (${Math.round(r0.height)} px tall)`;
    if (it.text) {
      const cs = getComputedStyle(e);
      if (alpha(cs.color) < 0.1 || alpha(cs.webkitTextFillColor) < 0.1) return `the words are transparent (${cs.color})`;
      if (!e.matches('input, textarea') && !e.textContent.trim() && !e.querySelector('img, svg, canvas')) return 'no words';
    }
    if (it.canvas) {
      if (e.matches('img')) { if (!(e.complete && e.naturalWidth > 0)) return 'picture not loaded'; }
      else {
        const g = e.getContext && e.getContext('2d');
        if (!g || !e.width || !e.height) return 'canvas has no size or no 2D drawing';
        let hit = 0; const data = g.getImageData(0, 0, e.width, e.height).data;
        for (let i = 3; i < data.length && !hit; i += 4 * 7) if (data[i] > 8) hit = 1;
        if (!hit) return 'drawn blank';
      }
    }
    if (it.bg) return '';
    const r = e.getBoundingClientRect();
    const W = document.documentElement.clientWidth;
    if (r.right < 1 || r.left > W - 1) return `off the screen (${Math.round(r.left)} to ${Math.round(r.right)} of ${W})`;
    if (r.left < -2 || r.right > W + 2) return `sticks out sideways (${Math.round(r.left)} to ${Math.round(r.right)} of ${W})`;
    for (let p = e.parentElement; p && p !== document.documentElement && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/hidden|clip/.test(cs.overflowX + cs.overflowY)) {
        const a = p.getBoundingClientRect();
        const cut = (/hidden|clip/.test(cs.overflowX) && (r.left < a.left - 2 || r.right > a.right + 2)) || (/hidden|clip/.test(cs.overflowY) && (r.top < a.top - 2 || r.bottom > a.bottom + 2));
        if (cut) return `clipped by ${name(p)}`;
      }
    }
    const cs = getComputedStyle(e);
    if (/hidden|clip/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 2 && !e.matches('canvas, img, svg')) return `its words are cut (${e.scrollWidth} in ${e.clientWidth})`;
    const vx = Math.max(r.left, 0), vy = Math.max(r.top, 0), vr = Math.min(r.right, W), vb = Math.min(r.bottom, innerHeight);
    if (vr - vx < 1 || vb - vy < 1) return `not in the window after scrolling to it (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}, left ${Math.round(r.left)}, right ${Math.round(r.right)}, window ${W} by ${innerHeight}, scrolled ${Math.round(scrollY)})`;
    const top = document.elementFromPoint((vx + vr) / 2, (vy + vb) / 2);
    if (top && !(e.contains(top) || top.contains(e) || (top.closest('a, button, label') && top.closest('a, button, label').contains(e)) || (top.closest('.m3, [data-mask3d]') && top.closest('.m3, [data-mask3d]') === e.closest('.m3, [data-mask3d]')))) return `under ${name(top)}`;
    return '';
  };
  const bad = [];
  // Where the links are folded into the menu button (a phone, or Larger text on a laptop), the links are not asked for, the button is.
  const toggle = document.querySelector('.nav__toggle');
  const menu = Boolean(toggle && getComputedStyle(toggle).display !== 'none');
  for (const it of items) {
    const [id, sel, f] = it;
    if ((f.menu === 'no' && menu) || (f.menu === 'yes' && !menu) ||
      (f.only === 'desktop' && phone) || (f.only === 'phone' && !phone) || (f.dark && !dark)) continue;
    const all = [...document.querySelectorAll(sel)];
    // A held layer (the home page's first screen under the demo) is shown only where the person is looking at it.
    scrollTo({ top: 0, behavior: 'instant' });
    if (f.top && all[0] && all[0].getBoundingClientRect().bottom <= innerHeight) await raf();
    else if (all[0] && !f.bg) { all[0].scrollIntoView({ block: 'center', behavior: 'instant' }); await raf(); }
    const here = all.filter(shown);
    if (!all.length) { bad.push(`${id}: missing (nothing matches ${sel})`); continue; }
    if (here.length < (f.n || 1)) { bad.push(`${id}: ${here.length} of ${f.n || 1} shown (${all.length} in the page)`); continue; }
    for (const e of here) { const w = await why(e, { ...f, min: f.min }); if (w) { bad.push(`${id}: ${w}`); break; } }
  }
  if (sweep) {
    const seen = new Set();
    for (const e of document.querySelectorAll(sweep)) {
      if (seen.has(e) || !shown(e) || e.closest('[aria-hidden=true]') || e.closest('.nav, .footer, dialog, [role=dialog]') || e.matches(':disabled, input[type=radio], input[type=checkbox]')) continue;
      const fold = e.closest('.set-fold'); if (fold && fold.getBoundingClientRect().height < 20) continue;
      seen.add(e);
      const t = e.matches('input, textarea') ? { text: false } : { text: !e.matches('.btn:empty, button:empty') };
      const w = await why(e, { ...t, min: 2 });
      if (w) bad.push(`sweep ${name(e)} "${(e.textContent || e.name || '').trim().slice(0, 30)}": ${w}`);
    }
  }
  // The bar under a phone page: nothing at the end of the page lies under it.
  if (bottomBar) {
    const bar = document.querySelector('.side');
    if (bar && getComputedStyle(bar).position === 'fixed') {
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); await raf();
      const floor = bar.getBoundingClientRect().top;
      let last = null, low = 0;
      for (const e of document.querySelectorAll('#main *')) {
        if (!shown(e) || e.closest('[aria-hidden=true], .toasts, .side, .topbar-mobile')) continue;
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
        if (!own && !e.matches('button, input, textarea')) continue;
        const b = e.getBoundingClientRect().bottom;
        if (b > low && getComputedStyle(e).position !== 'fixed') { low = b; last = e; }
      }
      if (last && low > floor + 0.5) bad.push(`the end of the page is under the bottom bar: ${name(last)} "${last.textContent.trim().slice(0, 30)}" ends ${Math.round(low)}, the bar starts ${Math.round(floor)}`);
    }
  }
  return bad;
}

/** Every entrance played: the page scrolled through once, then back to the top. */
const SETTLE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = Math.max(300, innerHeight * 0.7);
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo({ top: y, behavior: 'instant' }); await sleep(140); }
  scrollTo({ top: 0, behavior: 'instant' });
  await sleep(1600);
  return true;
})()`;

const STATUS = "['--red', '--orange', '--yellow', '--green'].map((k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim()).join(' ')";

async function checkVisualList() {
  const server = await startServer('visual-list');
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    const signIn = async () => {
    await goto(browser, s, `${server.base}/login`);
    const email = `list-${Date.now()}@example.com`;
    const password = 'Visual-List-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Ada', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });
    };

    const setup = async (x, i) => {
      const z = x.size;
      await browser.send('Emulation.setDeviceMetricsOverride', { width: z.width, height: z.height, deviceScaleFactor: z.dsf, mobile: z.mobile }, s);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: z.mobile, maxTouchPoints: 5 }, s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: x.scheme }, { name: 'prefers-reduced-motion', value: x.motion }] }, s);
      await goto(browser, s, `${server.base}/robots.txt`);   // on the site's own address, where its storage is
      // Even setups meet the first-run step on home; odd ones have finished it.
      await evalIn(browser, s, `(() => { for (const k of ['sentinel:theme', 'sentinel:accent', 'sentinel:type', 'sentinel:first-choices']) localStorage.removeItem(k);
        localStorage.setItem('sentinel:theme', '${x.scheme}'); if ('${x.accent}' !== 'gold') localStorage.setItem('sentinel:accent', '${x.accent}');
        localStorage.setItem('sentinel:type', JSON.stringify({ text: '${x.text}', density: 'comfortable' })); ${i % 2 ? "localStorage.setItem('sentinel:first-choices', '1');" : ''} return true; })()`);
    };
    const status = {};
    let swapRun = null, swaps = null;
    /* ----------------------------------- the web fonts arriving moves nothing (stand-in fonts sized to match) */

    const CLS = "window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; (window.__shifts = window.__shifts || []).push([e.value.toFixed(4), ...e.sources.map((s) => `${s.node && (s.node.nodeType === 3 ? '#text in ' + s.node.parentElement.nodeName + '.' + s.node.parentElement.className + ' < ' + (s.node.parentElement.parentElement || {}).className : s.node.nodeName + '.' + s.node.className)} ${Math.round(s.previousRect.y)}>${Math.round(s.currentRect.y)} h${Math.round(s.previousRect.height)}>${Math.round(s.currentRect.height)}`)]); } }).observe({ type: 'layout-shift', buffered: true }); } catch {}";
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: CLS }, s);
    await browser.send('Network.enable', {}, s); await browser.send('Network.setBypassServiceWorker', { bypass: true }, s); await browser.send('Network.setCacheDisabled', { cacheDisabled: true }, s);
    let holding = false;
    const held = [];
    browser.on('Fetch.requestPaused', (e, sid) => { if (sid && sid !== s) return; if (holding) held.push(e.requestId); else browser.send('Fetch.continueRequest', { requestId: e.requestId }, s).catch(() => {}); });
    const boxes = (sels) => evalIn(browser, s, `${JSON.stringify(sels)}.map((q) => { const e = document.querySelector(q); if (!e) return null; let y = 0; for (let p = e; p; p = p.offsetParent) y += p.offsetTop; return [y, e.offsetHeight]; })`);
    swaps = [['/app', "document.querySelector('[data-quick]')", ['#view h1', '.page-title', '[data-quick]', '.scan-meta']],
      ['/app/check', "document.querySelector('[data-form]')", ['.page-title', '.ask', '.ask__call']],
      ['/', "document.querySelector('.hero__copy h1')", ['.hero__copy h1', '.hero__lede', '.hero__cta', '.hero__card']]];
    swapRun = async (list) => { for (const [p, ready, sels] of list) {
      for (const x of [SETUPS[4], SETUPS[5], SETUPS[0], SETUPS[2]]) {
        await setup(x, 1);
        await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*woff2*' }] }, s);
        holding = true; held.length = 0;
        await browser.send('Page.navigate', { url: `${server.base}${p}?swap=${Date.now()}` }, s);
        await until(browser, s, ready, 30000);
        await sleep(1200);
        const before = await boxes(sels);
        await evalIn(browser, s, 'window.__cls = 0; window.__shifts = []; true');
        holding = false;
        const n = held.length;
        for (const id of held) await browser.send('Fetch.continueRequest', { requestId: id }, s).catch(() => {});
        await evalIn(browser, s, 'document.fonts.ready.then(() => true)', { awaitPromise: true });
        await sleep(1200);
        const after = await boxes(sels);
        const cls = await evalIn(browser, s, 'window.__cls');
        const shifts = await evalIn(browser, s, '(window.__shifts || []).slice(0, 6)');
        await browser.send('Fetch.disable', {}, s);
        const moved = sels.map((q, i) => (!before[i] || !after[i] ? `${q} missing` : Math.abs(before[i][0] - after[i][0]) > 1.5 || Math.abs(before[i][1] - after[i][1]) > 1.5 ? `${q} ${before[i].join('/')} then ${after[i].join('/')}` : '')).filter(Boolean);
        result(`visual-list: ${p}, ${x.id}: the web fonts arriving moves nothing (layout shift ${Number(cls).toFixed(4)})`, n > 0 && !moved.length && cls < 0.01, { fonts: n, moved, cls, shifts });
      }
    } };

    const run = async (list, setups, app) => {
      for (const [p, name, ready, items] of list) {
        for (const x of setups) {
          await setup(x, SETUPS.indexOf(x));
          errors.length = 0;
          await goto(browser, s, `${server.base}${p}?list=${Date.now()}`, ready);
          await sleep(500);
          await evalIn(browser, s, SETTLE, { awaitPromise: true });
          const phone = x.size.mobile;
          const bad = await evalIn(browser, s, `(${audit})(${JSON.stringify(items)}, ${JSON.stringify(SWEEP)}, ${phone}, ${x.scheme === 'dark'}, ${app && phone})`, { awaitPromise: true });
          const look = await evalIn(browser, s, `({ accent: document.documentElement.dataset.accent || 'gold', text: document.documentElement.dataset.text || 'standard', status: ${STATUS} })`);
          if (look.accent !== x.accent) bad.push(`the colour is ${look.accent}, not ${x.accent}`);
          if (app && look.text !== x.text) bad.push(`the text size is ${look.text}, not ${x.text}`);
          status[x.scheme] = status[x.scheme] || look.status;
          if (look.status !== status[x.scheme]) bad.push(`the status colours moved in ${x.accent}: ${look.status} against ${status[x.scheme]}`);
          const real = errors.filter((e) => !(name === 'not-found' && /404/.test(e)));
          if (real.length) bad.push(...real.slice(0, 4));
          await evalIn(browser, s, "scrollTo({ top: 0, behavior: 'instant' }), true");
          await sleep(200);
          result(`visual-list: ${p}, ${x.id}: everything on the list is on screen`, bad.length === 0, bad);
          await shot(browser, s, `list-${name}-${x.id}`);
        }
      }
    };
    // Home: every setup. The other pages: a computer and a phone each, the setups taken in turn so every one is met.
    const some = (list) => list.map((row, i) => [row, DESK[i % DESK.length], PH[i % PH.length]]);
    // A signed-in person is sent from the home page to the app, so the public pages are met signed out, first.
    for (const [row, d, ph] of some(PUBLIC)) await run([row], row[1] === 'home' ? SETUPS : [d, ph], false);
    await swapRun(swaps.filter((x) => x[0] === '/'));
    await signIn();
    for (const [row, d, ph] of some(APP)) await run([row], row[1] === 'app-home' ? SETUPS : [d, ph], true);
    await swapRun(swaps.filter((x) => x[0] !== '/'));

  } finally { await close(); await server.stop(); }
}

module.exports = checkVisualList;
