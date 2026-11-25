'use strict';
/**
 * app-checklist  Every visual detail the app must show, page by page, as one list (CHECKLIST below), each line with the
 *         element that proves it. A line fails when its element is missing, hidden, zero-size, off screen, transparent,
 *         covered by something else, cut by a parent, or a picture that did not load. It runs on every page of the app
 *         (and the sign-in page) at a computer's width and a 360 px phone, in light and dark, at the default text size
 *         and Larger text, in gold and in three other colours. In any colour but gold, nothing on the page may still be
 *         drawn in gold's hue except the caution yellow and the warning orange (the status colours never move), and the
 *         colour's own tokens (--gold-*, --live*) must have moved: that is the "colour reaches everything" half. The
 *         Windows app's title bar (html.framed .frame, drawn by boot.js) is checked on the sign-in page and Check.
 *         A press on a colour coin draws the colour within 250 ms with no long task over 150 ms.
 *         Pictures: app-<page>-<size>-<theme>-<accent>-<text>.png; a failing line is named in the report.
 */
const path = require('path');
const { ROOT, sleep, result, launch, evalIn, openPage, goto, startServer, serveFiles, clickSel, until, shot, watchErrors } = require('./_shared');

const SIZES = { desktop: { width: 1366, height: 900, mobile: false }, phone: { width: 360, height: 740, mobile: true } };
// The matrix: each size in these looks. Three accents besides gold, light and dark of each, Larger text twice.
const LOOKS = [
  ['dark', 'gold', 'default'], ['light', 'gold', 'default'], ['dark', 'sapphire', 'default'], ['light', 'rose', 'default'],
  ['dark', 'gold', 'larger'], ['light', 'teal', 'larger']
];
// The status colours and caution's ink (look.js STATUS, CAUTION_INK): never an accent's, so never found "still gold".
const STATUS = ['#e5484d', '#f08a24', '#f5c542', '#4cb782', '#b3261e', '#a14400', '#1a6e35', '#645e53'];
// The Windows app's bridge to Electron, as the pages ask of it (desktop/src/preload.js): every answer plausible, every
// call answered, the look left to the page (the window's own look is main.js's, not this page's).
const STANDIN = `window.sentinelDesktop = new Proxy({ framed: true, look: undefined,
  info: async () => ({ version: '1.21.3', platform: 'win32', embeddedServer: true, openAtLogin: true, clipboardCheck: false, commandShield: true, walletGuard: true,
    snip: { supported: true, enabled: true, key: 'a', keys: [{ id: 'a', label: 'Ctrl+Shift+S' }] }, scanMenu: { supported: true, enabled: true }, exposureAlerts: false, mySites: true, weekRecap: false, pairedUserId: null,
    downloads: { active: true, folder: 'Downloads' }, live: { supported: true, enabled: false }, chatSafety: { supported: true, enabled: true }, parentLock: { enabled: false },
    remoteGuard: { supported: true, enabled: true }, textSafety: { supported: true, enabled: false }, liveMode: 'fast', marksLevel: 'all', warningsLevel: 'all', autoScan: false,
    defense: { supported: true, active: true, enabled: true, watched: ['Downloads'] }, browsers: { installed: [], running: [] }, update: { status: 'idle' } }),
  recentDownloads: async () => [], mySites: async () => [], exposures: async () => [], lockStatus: async () => ({ enabled: false }), week: undefined, takeMenuFile: async () => null, defense: async () => ({ ledger: [] })
}, { get: (k, n) => (n in k ? k[n] : typeof n !== 'string' || n === 'look' || n === 'setLook' || n === 'onLook' || n === 'then' ? undefined : /^on[A-Z]/.test(n) ? () => () => {} : async () => null) });`;

// what: the words in the report; sel: the element; n: how many there must be; only: 'desktop' or 'phone'; all: check each
// one, not only the first; through: the pointer passes through it by design, so what is drawn over it is not a fault.
const FRAME = [{ what: 'app title bar', sel: '.frame' }, { what: 'title bar mark', sel: '.frame__mark svg' }, { what: 'title bar name', sel: '.frame b' }];
const SHELL = [
  { what: 'logo mark', sel: '.side .logo__mark svg', only: 'desktop' },
  { what: 'logo mark in the top bar', sel: '.topbar-mobile .logo__mark svg', only: 'phone' },
  { what: 'every page in the side bar', sel: '.side__nav .side__link:not(.side__more)', n: 10, all: true, only: 'desktop' },
  { what: 'the five places in the bottom bar', sel: '.side__nav [data-phone]', n: 5, all: true, only: 'phone' },
  { what: 'search box', sel: '.side__search', only: 'desktop' },
  { what: 'theme button', sel: '.theme-toggle', only: 'desktop' },
  { what: 'account row and its avatar', sel: '.me .avatar', only: 'desktop' },
  { what: 'the stars', sel: 'canvas.cosmos', only: 'dark', through: true, stars: true },
  { what: 'floating motes', sel: '.lux-atmos i', n: 8, exists: true },
  { what: 'page title', sel: '.page-title h1' },
  { what: 'rule under the title, drawn', sel: '.page-title .lux-rule', drawn: true }
];
const CHECKLIST = {
  '/app': [
    { what: 'the 3D mask beside the greeting', sel: '.lux-mask .m3', only: 'desktop', through: true },
    { what: 'paste box', sel: '.scanbox input' }, { what: 'Check button', sel: '.scanbox .btn--gold' }, { what: 'what it can check line', sel: '.scan-meta a' },
    { what: 'make it yours: colour coins', sel: '.look__coin', n: 6, all: true }
  ],
  '/app/check': [
    { what: 'paste area', sel: '.ask__text' }, { what: 'add a file', sel: '[data-add]' }, { what: 'Check button', sel: '.ask__go' }, { what: 'examples line', sel: '[data-try]' }
  ],
  '/app/protection': [{ what: 'what live protection watches', sel: '.feature' }, { what: 'the words under the title', sel: '.page-title p' }],
  '/app/sites': [{ what: 'trusted sites panel', sel: '[data-allow]' }, { what: 'blocked sites panel', sel: '[data-block]' }],
  '/app/checkup': [{ what: 'the words under the title', sel: '.page-title p' }],
  '/app/week': [{ what: 'the week', sel: '[data-week]' }],
  '/app/history': [{ what: 'the figures', sel: '[data-stats]' }, { what: 'the list', sel: '[data-list]' }],
  '/app/settings': [
    { what: 'groups on the left', sel: '.set-rail a', n: 11, all: true, only: 'desktop' }, { what: 'find a setting', sel: '.set-find input' },
    { what: 'Appearance group', sel: '[data-set-group="look"]' }, { what: 'colour coins', sel: '#accent .look__coin', n: 6, all: true },
    { what: 'light and dark choice', sel: '.look__group' }
  ],
  '/app/plan': [{ what: 'the plan panel', sel: '.panel' }],
  '/app/assistants': [{ what: 'the assistants panel', sel: '.panel' }],
  '/app/recover': [{ what: 'the first question', sel: '.recover__what' }]
};
// The Windows app's own windows (desktop/src/pages), as 51-look serves them: a warning card, the first start, the page that
// says the app did not start, and the live-scanning island with its marks on a page.
const WINDOWS = [
  ['warn', '/d/pages/warn.html', [{ what: 'warning card: mask', sel: '.mark' }, { what: 'warning card: title', sel: '#label' }, { what: 'warning card: the strongest reason', sel: '#why' },
    { what: 'warning card: the address', sel: '#host' }, { what: 'warning card: what to do', sel: '#lead' }, { what: 'warning card: the other reasons', sel: '#reasons li' },
    { what: 'warning card: go to the real site', sel: '#real' }, { what: 'warning card: Got it', sel: '#close' }, { what: 'warning card: where it was seen', sel: '#browser' }],
    { badge: 'orange', label: 'Likely scam', host: 'paypa1-secure-login.example', reasons: ['The address imitates paypal.com', 'The site is three days old', 'It asks for a password'].join(String.fromCharCode(10)), real: 'paypal.com', browser: 'Microsoft Edge' }, "document.getElementById('real').textContent", [520, 560]],
  ['loading', '/d/pages/loading.html', [{ what: 'first start: the mark', sel: '.mark' }, { what: 'first start: the bar', sel: '.bar' }], {}, "document.querySelector('.bar')", [800, 560]],
  ['error', '/d/pages/error.html', [{ what: 'did not start: the mark', sel: '.mark' }, { what: 'did not start: Try again', sel: '#retry' }, { what: 'did not start: Open log', sel: '#logs' },
    { what: 'did not start: Quit', sel: '#quit' }, { what: 'did not start: the countdown', sel: '#auto' }], { message: 'Sentinel could not start its checks.', log: 'sentinel.log', retryIn: '30' }, "document.getElementById('log').textContent", [800, 560]],
  ['island', '/d/pages/overlay.html', [{ what: 'island: the corner', sel: '#corner', through: true }, { what: 'island: its mask', sel: '#cornerMask svg', through: true }, { what: 'island: a mark by each checked link (the fifth, still being checked, pulses by design)', sel: '#marks .mark:not(.is-pending)', n: 4, all: true, through: true }],
    {}, 'window.__on && window.__on["overlay:watching"]', [1366, 768]]
];
const LOGIN = [
  { what: 'sign-in: the scope drawing', sel: '.auth__scope', only: 'desktop', through: true }, { what: 'sign-in: the mask', sel: '.auth__mask', cutOk: true },
  { what: 'sign-in: the Sentinel word', sel: '.auth__word' },
  { what: 'sign-in: the line under it', sel: '.auth__line' }, { what: 'sign-in: heading', sel: '.auth__inner h1' }, { what: 'sign-in: email box', sel: '#email' },
  { what: 'sign-in: Sign in button', sel: '.auth__inner .btn--gold' }
];

/* Runs in the page. items: the lines; ctx: { phone, accent }. Returns the lines that failed, each with why. */
async function probe(items, ctx) {
  const out = [];
  const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
  const opacityOf = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const alphaOf = (c) => { const m = /\/\s*([\d.]+)\s*\)$|rgba\([^)]*,\s*([\d.]+)\)$/.exec(c); return m ? parseFloat(m[1] || m[2]) : 1; };
  for (const it of items) {
    if ((it.only === 'desktop' && ctx.phone) || (it.only === 'phone' && !ctx.phone) || (it.only === 'dark' && ctx.theme !== 'dark')) continue;
    let els = [...document.querySelectorAll(it.sel)];
    const need = it.n || 1;
    if (els.length < need) { out.push(`${it.what}: missing (${els.length} of ${need} for ${it.sel})`); continue; }
    if (it.exists) continue;
    els = els.slice(0, it.all ? els.length : 1);
    for (const e of els) {
      const bad = [];
      e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await tick(); await tick();
      for (let k = 0; k < 48 && opacityOf(e) < 0.95; k++) await new Promise((r) => setTimeout(r, 25));
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) bad.push('hidden');
      else {
        if (r.width < 2 || r.height < 2) bad.push(`zero-size ${Math.round(r.width)}x${Math.round(r.height)}`);
        if (opacityOf(e) < 0.95) bad.push(`transparent (${opacityOf(e).toFixed(2)})`);
        if (r.left < -1 || r.right > innerWidth + 1) bad.push(`off screen (${Math.round(r.left)} to ${Math.round(r.right)} of ${innerWidth})`);
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        // Words filled with a gradient (background-clip: text) have a clear colour on purpose; theirs is the gradient.
        const gradient = cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text';
        if (own && !gradient && alphaOf(cs.color) < 0.3) bad.push(`its words are transparent (${cs.color})`);
        if (gradient && cs.backgroundImage === 'none') bad.push('its gradient fill is missing, so its words are clear');
        if (it.drawn && [...e.querySelectorAll('path')].some((p) => parseFloat(getComputedStyle(p).strokeDashoffset) > 0.05)) bad.push('the line is not drawn');
        const x = Math.min(innerWidth - 1, Math.max(1, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(1, r.top + r.height / 2));
        const hit = document.elementFromPoint(x, y);
        if (!it.through && hit && hit !== e && !e.contains(hit) && !hit.contains(e)) bad.push(`covered by ${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === 'string' ? '.' + hit.className.trim().split(/\s+/)[0] : ''}`);
        for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          const o = getComputedStyle(a);
          if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
          const ar = a.getBoundingClientRect();
          const cutX = o.overflowX !== 'visible' && o.overflowX !== 'auto' && o.overflowX !== 'scroll' && (r.left < ar.left - 1 || r.right > ar.right + 1);
          const cutY = o.overflowY !== 'visible' && o.overflowY !== 'auto' && o.overflowY !== 'scroll' && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1);
          if ((cutX || cutY) && !it.cutOk) { bad.push(`cut by ${a.tagName.toLowerCase()}${typeof a.className === 'string' && a.className ? '.' + a.className.trim().split(/\s+/)[0] : ''}`); break; }
        }
        if (e.tagName !== 'svg' && !(e instanceof SVGElement) && own && cs.overflow !== 'visible' && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2)) bad.push('its words are cut off');
        if (it.stars) {
          // A 2D canvas can be read: the stars are drawn (not an empty sky), and in a colour other than gold none of them is gold's hue.
          const c = e.getContext('2d'), d = c.getImageData(0, 0, e.width, e.height).data;
          let lit = 0, warm = 0;
          for (let i = 0; i < d.length; i += 16) {
            if (d[i + 3] < 60) continue;
            lit++;
            const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
            if (dd < 0.08) continue;
            const h = (mx === r ? ((g - b) / dd + 6) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4) * 60;
            if (h >= 30 && h <= 56) warm++;
          }
          if (lit < 20) bad.push(`the sky is empty (${lit} lit points)`);
          if (ctx.accent !== 'gold' && lit && warm / lit > 0.25) bad.push(`${Math.round((100 * warm) / lit)}% of the stars are still gold's hue`);
        }
        if (!it.cutOk && window.scrollY <= 0 && r.top < -1) bad.push(`starts ${Math.round(-r.top)} px above the top of the page`);
        if (e.tagName === 'IMG' && !(e.complete && e.naturalWidth > 0)) bad.push('picture not loaded');
        if (e.matches('.m3') && !e.querySelector('canvas, img')) bad.push('no picture or 3D model inside');
        const pic = e.matches('.m3') ? e.querySelector('canvas, img') : null;
        if (pic) { const pr = pic.getBoundingClientRect(); if (pr.width < 40 || pr.height < 40) bad.push('the model is too small to see'); if (pic.tagName === 'IMG' && !(pic.complete && pic.naturalWidth > 0)) bad.push('the model picture did not load'); }
      }
      if (bad.length) out.push(`${it.what}: ${bad.join(', ')} (${it.sel})`);
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} in ${innerWidth})`);
  return out;
}

/* Runs in the page, in any colour but gold: what is still drawn in gold's hue, and which tokens did not move. */
function goldLeft(accent, status) {
  const toRgb = (s) => {
    let m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(s);
    if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s);
    return m ? [m[1] * 255, m[2] * 255, m[3] * 255, m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]] : null;
  };
  const hsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  };
  const st = status.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const isGold = (c) => {
    if (!c || c[3] < 0.12) return false;
    if (st.some((s) => Math.abs(s[0] - c[0]) + Math.abs(s[1] - c[1]) + Math.abs(s[2] - c[2]) < 24)) return false;   // a status colour, or a tint of one
    const [h, s, l] = hsl(c);
    return h >= 30 && h <= 56 && s >= 0.08 && l >= 0.2 && l <= 0.93;   // cream is gold's hue, only paler
  };
  const found = new Map();
  const note = (e, prop, v) => {
    const name = e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '');
    const k = `${name} ${prop}`;
    if (!found.has(k)) found.set(k, v);
  };
  const tokens = (s) => s.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g) || [];
  for (const e of document.body.querySelectorAll('*')) {
    if (e.closest('.look__coin, .lux-mask, .m3, [data-status], .sentinel-mask, picture, img, canvas, script, style') || !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(e, pseudo);
      if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
      const own = pseudo || [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own && isGold(toRgb(cs.color))) note(e, `${pseudo || ''} color`, cs.color);
      if (isGold(toRgb(cs.backgroundColor))) note(e, `${pseudo || ''} background`, cs.backgroundColor);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none' && isGold(toRgb(cs[`border${side}Color`]))) { note(e, `${pseudo || ''} border`, cs[`border${side}Color`]); break; }
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && isGold(toRgb(cs.outlineColor))) note(e, `${pseudo || ''} outline`, cs.outlineColor);
      if (e instanceof SVGElement && !pseudo) {
        if (cs.fill !== 'none' && isGold(toRgb(cs.fill))) note(e, 'fill', cs.fill);
        if (cs.stroke !== 'none' && isGold(toRgb(cs.stroke))) note(e, 'stroke', cs.stroke);
      }
      for (const prop of ['backgroundImage', 'boxShadow', 'textShadow', 'filter']) if (tokens(cs[prop]).some((t) => isGold(toRgb(t)))) note(e, `${pseudo || ''} ${prop}`, cs[prop].slice(0, 90));
    }
  }
  const out = [...found].slice(0, 30).map(([k, v]) => `still gold: ${k} = ${v}`);
  const root = getComputedStyle(document.documentElement);
  if (document.documentElement.dataset.accent !== accent) out.push(`the page says its colour is ${document.documentElement.dataset.accent}, not ${accent}`);
  for (const t of ['--gold-300', '--gold-400', '--live', '--live-hi']) {
    const v = root.getPropertyValue(t).trim();
    const probeEl = document.createElement('i'); probeEl.style.color = v || 'transparent'; document.body.appendChild(probeEl);
    const c = toRgb(getComputedStyle(probeEl).color); probeEl.remove();
    if (v && isGold(c)) out.push(`token ${t} is still gold (${v})`);
  }
  return out;
}

async function checkApp() {
  const server = await startServer('appchecklist');
  const { browser, close } = await launch();
  const failures = [];
  const seen = [];
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const ev = (expr) => evalIn(browser, s, expr);
    const look = async (size, [theme, accent, text]) => {
      await Promise.all([
        browser.send('Emulation.setDeviceMetricsOverride', { ...SIZES[size], deviceScaleFactor: 1 }, s),
        browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }, s)
      ]);
      await ev(`(() => { localStorage.setItem('sentinel:theme', '${theme}'); ${accent === 'gold' ? "localStorage.removeItem('sentinel:accent');" : `localStorage.setItem('sentinel:accent', '${accent}');`}
        ${text === 'larger' ? `localStorage.setItem('sentinel:type', '{"text":"larger","density":"comfortable"}');` : "localStorage.removeItem('sentinel:type');"} return true; })()`);
    };
    const visit = async (url, items, size, lk, name, ready, base = server.base) => {
      const tag = `${name}-${size}-${lk[0]}-${lk[1]}-${lk[2]}`;
      errors.length = 0;
      await goto(browser, s, `${base}${url}`, ready);
      await until(browser, s, "document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect.getComputedTiming().endTime)).length === 0", 4000);
      await sleep(500);
      const why = await ev(`(${probe})(${JSON.stringify(items)}, ${JSON.stringify({ phone: size === 'phone', accent: lk[1], theme: lk[0] })})`);
      if (lk[1] !== 'gold') why.push(...(await ev(`(${goldLeft})(${JSON.stringify(lk[1])}, ${JSON.stringify(STATUS)})`)));
      const noise = errors.filter((e) => !/favicon.ico/.test(e));
      if (noise.length) why.push(...noise.slice(0, 3).map((e) => `the page logged: ${e.slice(0, 160)}`));
      await ev("[document.scrollingElement, ...document.querySelectorAll('*')].forEach((e) => { if (e && e.scrollTop) e.scrollTop = 0; }), true");
      await sleep(250);
      await shot(browser, s, `app-${tag}`);
      seen.push(tag);
      for (const w of why) failures.push(`${tag}: ${w}`);
    };

    /* ------------------------------------------- signed out: the sign-in page, and the title bar on it */
    for (const size of Object.keys(SIZES)) {
      for (const lk of LOOKS) {
        await goto(browser, s, `${server.base}/login`);
        await look(size, lk);
        await visit('/login', LOGIN, size, lk, 'login', "document.querySelector('.auth__word')");
      }
    }
    const framed = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.sentinelDesktop = { framed: true };' }, s)).identifier;
    await look('desktop', LOOKS[2]);
    await visit('/login', [...FRAME, ...LOGIN], 'desktop', LOOKS[2], 'login-titlebar', "document.querySelector('.frame__page')");
    await look('desktop', LOOKS[3]);
    await visit('/login', [...FRAME, ...LOGIN], 'desktop', LOOKS[3], 'login-titlebar', "document.querySelector('.frame__page')");
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: framed }, s);

    /* ------------------------------------------------------------------------------ signed in: every page */
    await goto(browser, s, `${server.base}/login`);
    const api = (p, body) => ev(`fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    const email = `appcl-${Date.now()}@example.com`;
    await api('/auth/signup', { email, password: 'Checklist-Lamp-2026-x', firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password: 'Checklist-Lamp-2026-x' });
    for (const size of Object.keys(SIZES)) {
      for (const lk of LOOKS) {
        await look(size, lk);
        for (const [page, items] of Object.entries(CHECKLIST)) {
          await visit(page, [...SHELL, ...items], size, lk, page === '/app' ? 'overview' : page.slice(5), "document.querySelector('.page-title h1')");
        }
      }
    }
    // Inside the Windows app's window: the bridge answering, and the title bar drawn over every page.
    const inApp = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: STANDIN }, s)).identifier;
    for (const lk of LOOKS) {
      await look('desktop', lk);
      for (const [page, items] of Object.entries(CHECKLIST)) {
        await visit(page, [...FRAME, ...SHELL, ...items], 'desktop', lk, `inapp-${page === '/app' ? 'overview' : page.slice(5)}`, "document.querySelector('.page-title h1') && document.querySelector('.frame__mark svg')");
      }
    }
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inApp }, s);
    // The Windows app's own windows: each in the looks, the way 51-look serves them.
    const files = await serveFiles({ '/shared/fonts/': path.join(ROOT, 'web', 'assets', 'fonts'), '/shared/': path.join(ROOT, 'web', 'assets', 'js'), '/d/': path.join(ROOT, 'desktop', 'src') });
    await browser.send('Page.setBypassCSP', { enabled: true }, s);
    const hook = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.sentinelOverlay = { on(n, f) { (window.__on = window.__on || {})[n] = f; }, interact() {}, act() {} };" }, s)).identifier;
    const marks = [{ badge: 'red', kind: 'malware', label: 'Malware detected' }, { badge: null, kind: 'scam', label: 'No scam signs' }, { badge: 'orange', kind: 'scam', label: 'Likely scam' }, { badge: 'yellow', kind: 'scam', label: 'Suspicious' }, { pending: true }]
      .map((m, i) => ({ k: `r${i}`, x: 80, y: 120 + i * 70, w: 380, h: 24, ...m }));
    try {
      for (const lk of LOOKS.slice(0, 4)) {
        for (const [name, url, items, query, ready, [w, h]] of WINDOWS) {
          await look('desktop', lk);
          await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, s);
          const q = new URLSearchParams({ ...query, theme: lk[0], accent: lk[1] });
          const pageUrl = `${url}?${q}`;
          if (name === 'island') {
            const tag = `window-island-${lk[0]}-${lk[1]}`;
            await goto(browser, s, `${files.base}${pageUrl}`, ready);
            await ev(`(() => { document.body.style.background = '${lk[0] === 'light' ? '#ffffff' : '#202124'}'; __on['overlay:watching']({ appeared: true, browser: 'msedge' }); __on['overlay:page']({ host: 'paypa1-secure-login.example', search: false }); __on['overlay:marks']({ marks: ${JSON.stringify(marks)}, epoch: 0 }); __on['overlay:sweep']({ kind: 'search' }); return true; })()`);
            await sleep(900);
            const why = await ev(`(${probe})(${JSON.stringify(items)}, { phone: false, accent: ${JSON.stringify(lk[1])}, theme: ${JSON.stringify(lk[0])} })`);
            if (lk[1] !== 'gold') why.push(...(await ev(`(${goldLeft})(${JSON.stringify(lk[1])}, ${JSON.stringify(STATUS)})`)));
            await shot(browser, s, `app-${tag}`);
            seen.push(tag);
            for (const w2 of why) failures.push(`${tag}: ${w2}`);
          } else await visit(pageUrl, items, 'desktop', lk, `window-${name}`, ready, files.base);
        }
      }
    } finally { await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook }, s); files.server.close(); }
    // Each fault once, with where it was seen, so one cause is one line.
    const byFault = new Map();
    for (const f of failures) { const [tag, ...rest] = f.split(': '); const k = rest.join(': '); byFault.set(k, [...(byFault.get(k) || []), tag]); }
    result('app-checklist: every line of the list shows on every page, in the browser and in the Windows window (title bar drawn), desktop and phone, light and dark, default and Larger text, in gold, sapphire, rose and teal, and no gold is left in the others',
      !failures.length, [`${seen.length} pages looked at`, ...[...byFault].map(([k, tags]) => `${k}  [${tags.length}: ${tags.slice(0, 4).join(', ')}${tags.length > 4 ? ', ...' : ''}]`).slice(0, 120)]);

    /* --------------------------------------------------- a press on a coin: drawn at once, nothing long blocks */
    await look('desktop', LOOKS[0]);
    await goto(browser, s, `${server.base}/app/settings#accent`, "document.querySelector('#accent .look__coin')");
    await sleep(1200);
    await ev(`(() => { window.__lag = { t0: 0, drawn: null, long: 0 };
      document.addEventListener('pointerdown', () => { __lag.t0 = performance.now(); }, true);
      new MutationObserver(() => { if (__lag.drawn == null && __lag.t0) __lag.drawn = performance.now() - __lag.t0; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent', 'style'] });
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) __lag.long = Math.max(__lag.long, e.duration); }).observe({ type: 'longtask', buffered: false }); } catch (e) { /* not offered */ }
      return true; })()`);
    await clickSel(browser, s, '#accent .look__coin:has(input[value="sapphire"])');
    await sleep(1800);
    const lag = await ev("({ ...__lag, accent: document.documentElement.dataset.accent, vt: document.documentElement.classList.contains('look-vt') })");
    result('app-checklist: a press on a colour coin draws the colour within 250 ms, no task holds the page over 150 ms, and the change has finished (no stuck transition class)',
      lag.accent === 'sapphire' && lag.drawn != null && lag.drawn <= 250 && lag.long <= 150 && !lag.vt, lag);
  } finally { await close(); await server.stop(); }
}

module.exports = checkApp;
