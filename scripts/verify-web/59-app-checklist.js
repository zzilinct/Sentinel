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
const { sleep, result, launch, evalIn, openPage, goto, startServer, clickSel, until, shot, watchErrors } = require('./_shared');

const SIZES = { desktop: { width: 1366, height: 900, mobile: false }, phone: { width: 360, height: 740, mobile: true } };
// The matrix: each size in these looks. Three accents besides gold, light and dark of each, Larger text twice.
const LOOKS = [
  ['dark', 'gold', 'default'], ['light', 'gold', 'default'], ['dark', 'sapphire', 'default'], ['light', 'rose', 'default'],
  ['dark', 'gold', 'larger'], ['light', 'teal', 'larger']
];
const STATUS = ['#e5484d', '#f08a24', '#f5c542', '#4cb782', '#b3261e', '#a14400', '#1a6e35'];

// what: the words in the report; sel: the element; n: how many there must be; only: 'desktop' or 'phone'; all: check each
// one, not only the first; through: the pointer passes through it by design, so what is drawn over it is not a fault.
const FRAME = [{ what: 'app title bar', sel: '.frame' }, { what: 'title bar mark', sel: '.frame__mark svg' }, { what: 'title bar name', sel: '.frame b' }];
const SHELL = [
  { what: 'logo mark', sel: '.side .logo__mark svg', only: 'desktop' },
  { what: 'logo mark in the top bar', sel: '.topbar-mobile .logo__mark svg', only: 'phone' },
  { what: 'every page in the side bar', sel: '.side__nav .side__link', n: 10, all: true, only: 'desktop' },
  { what: 'the five places in the bottom bar', sel: '.side__nav [data-phone]', n: 5, all: true, only: 'phone' },
  { what: 'search box', sel: '.side__search', only: 'desktop' },
  { what: 'theme button', sel: '.theme-toggle', only: 'desktop' },
  { what: 'account row and its avatar', sel: '.me .avatar', only: 'desktop' },
  { what: 'page title', sel: '.page-title h1' },
  { what: 'the 3D mask beside the title', sel: '.lux-mask .m3', only: 'desktop', through: true }
];
const CHECKLIST = {
  '/app': [
    { what: 'greeting', sel: '.page-title h1 .greet' }, { what: 'gold rule under the greeting', sel: '.page-title .lux-rule path' },
    { what: 'paste box', sel: '.scanbox input' }, { what: 'Check button', sel: '.scanbox .btn--gold' }, { what: 'what it can check line', sel: '.scan-meta a' }
  ],
  '/app/check': [
    { what: 'paste area', sel: '.ask__text' }, { what: 'add a file', sel: '[data-add]' }, { what: 'Check button', sel: '.ask__go' }, { what: 'examples line', sel: '[data-try]' }
  ],
  '/app/protection': [{ what: 'a protection row', sel: '.set-row' }, { what: 'the first panel or row has words', sel: '.page-title p' }],
  '/app/sites': [{ what: 'trusted sites panel', sel: '[data-allow]' }, { what: 'blocked sites panel', sel: '[data-block]' }],
  '/app/checkup': [{ what: 'the checkup panel', sel: '.panel' }],
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
const LOGIN = [
  { what: 'sign-in: the scope drawing', sel: '.auth__scope' }, { what: 'sign-in: the mask', sel: '.auth__mask' }, { what: 'sign-in: the Sentinel word', sel: '.auth__word' },
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
    if ((it.only === 'desktop' && ctx.phone) || (it.only === 'phone' && !ctx.phone)) continue;
    let els = [...document.querySelectorAll(it.sel)];
    const need = it.n || 1;
    if (els.length < need) { out.push(`${it.what}: missing (${els.length} of ${need} for ${it.sel})`); continue; }
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
        if (own && alphaOf(cs.color) < 0.3) bad.push(`its words are transparent (${cs.color})`);
        const x = Math.min(innerWidth - 1, Math.max(1, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(1, r.top + r.height / 2));
        const hit = document.elementFromPoint(x, y);
        if (!it.through && hit && hit !== e && !e.contains(hit) && !hit.contains(e)) bad.push(`covered by ${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === 'string' ? '.' + hit.className.trim().split(/\s+/)[0] : ''}`);
        for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          const o = getComputedStyle(a);
          if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
          const ar = a.getBoundingClientRect();
          const cutX = o.overflowX !== 'visible' && o.overflowX !== 'auto' && o.overflowX !== 'scroll' && (r.left < ar.left - 1 || r.right > ar.right + 1);
          const cutY = o.overflowY !== 'visible' && o.overflowY !== 'auto' && o.overflowY !== 'scroll' && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1);
          if (cutX || cutY) { bad.push(`cut by ${a.tagName.toLowerCase()}${typeof a.className === 'string' && a.className ? '.' + a.className.trim().split(/\s+/)[0] : ''}`); break; }
        }
        if (e.tagName !== 'svg' && !(e instanceof SVGElement) && own && cs.overflow !== 'visible' && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2)) bad.push('its words are cut off');
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
    return h >= 30 && h <= 52 && s >= 0.25 && l >= 0.2 && l <= 0.93;
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
    const visit = async (url, items, size, lk, name, ready) => {
      const tag = `${name}-${size}-${lk[0]}-${lk[1]}-${lk[2]}`;
      errors.length = 0;
      await goto(browser, s, `${server.base}${url}`, ready);
      await until(browser, s, "document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect.getComputedTiming().endTime)).length === 0", 4000);
      await sleep(500);
      const why = await ev(`(${probe})(${JSON.stringify(items)}, ${JSON.stringify({ phone: size === 'phone', accent: lk[1] })})`);
      if (lk[1] !== 'gold') why.push(...(await ev(`(${goldLeft})(${JSON.stringify(lk[1])}, ${JSON.stringify(STATUS)})`)));
      if (errors.length) why.push(...errors.slice(0, 3).map((e) => `the page logged: ${e.slice(0, 160)}`));
      await ev('window.scrollTo(0, 0), true');
      await sleep(150);
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
    // The title bar over the app's own pages.
    const framed2 = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.sentinelDesktop = { framed: true };' }, s)).identifier;
    for (const lk of [LOOKS[2], LOOKS[3]]) {
      await look('desktop', lk);
      await visit('/app/check', [...FRAME, ...SHELL, ...CHECKLIST['/app/check']], 'desktop', lk, 'check-titlebar', "document.querySelector('.frame__page')");
    }
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: framed2 }, s);
    result('app-checklist: every line of the list shows on every page, desktop and phone, light and dark, default and Larger text, in gold, sapphire, rose and teal, and no gold is left in the others',
      !failures.length, [`${seen.length} pages looked at`, ...failures.slice(0, 60)]);

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
