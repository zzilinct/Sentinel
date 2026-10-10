'use strict';
/**
 * layout    Every public page and, signed in, every app page, at a phone's, a tablet's, a laptop's and a big screen's
 *           size, in dark and in light, after the pointer has moved and the page has been scrolled down and back (so
 *           the motion has run): no sideways scroll, no words past the screen's edge, no heading or button cut by a
 *           box that hides its overflow, and what is meant to be centred (the hero's name, centred section heads,
 *           the command palette, the app's message island) within 4 px of its middle.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, launch, evalIn, goto, shot } = require('./_shared');

const SIZES = [[390, 844], [768, 1024], [1366, 900], [1920, 1080]];
const THEMES = ['dark', 'light'];
const PUBLIC = [['index', '/'], ['pricing', '/pricing'], ['download', '/download'], ['privacy', '/privacy'], ['terms', '/terms'], ['refunds', '/refunds'],
  ['recover', '/recover'], ['practice', '/practice'], ['login', '/login'], ['signup', '/signup'], ['404', '/no-such-page']];
const APP = ['/app', '/app/week', '/app/scan', '/app/threats', '/app/email', '/app/text', '/app/call', '/app/history', '/app/sites', '/app/checkup',
  '/app/protection', '/app/plan', '/app/security', '/app/assistants', '/app/recover'].map((p) => [p.slice(1).replace('/', '-'), p]);

// Deliberate, each with its reason. A finding matches when its kind is the same and `el` is found in its description.
const ALLOWED = [
  { kind: 'clipped', el: 'button.usage-row', size: (w) => w > 900,
    why: 'a usage row under the pointer nudges 3 px right (app-lux.css); its 18 px padding keeps its words inside, only its plain edge slips under the list\'s rounded corner' },
  { kind: 'past-edge', el: '[data-hero-word]', size: (w) => w < 768,
    why: 'the hero\'s gold name is wider than a phone on purpose, cropped evenly on both sides by the hero\'s frame (12 px clip margin past its 2.6vw inset)' }
];

// A headless browser reports no mouse; this says there is one at a computer's sizes, so the pointer motion runs.
const MOUSE = `(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /hover: hover|pointer: fine/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); })();`;

/* ------------------------------------------------------------ in the page */

/** Runs in the page: every layout problem on it, as { kind, el, text, detail }. */
function measure(width) {
  const W = innerWidth;
  const out = [];
  const r = Math.round;
  const name = (el) => {
    const parts = [];
    for (let e = el, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++) {
      parts.unshift(e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + [...e.classList].slice(0, 2).map((c) => `.${c}`).join('') +
        (e.hasAttribute('data-hero-word') ? '[data-hero-word]' : ''));
    }
    return parts.join(' > ');
  };
  const words = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const box = (b) => ({ left: b.left, right: b.right, top: b.top, bottom: b.bottom });
  const cut = (a, b) => ({ left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) });
  const empty = (b) => b.right - b.left < 1 || b.bottom - b.top < 1;
  // Fixed boxes (the header, the motes) span whatever width the page has: they show sideways scroll, never cause it.
  const fixed = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') return true; return false; };
  // What may be moving it: an entrance still to play, or a transform on it or above it.
  const moving = (el) => {
    const rv = el.closest('[data-reveal]');
    let t = '';
    for (let e = el; e && e !== document.body && !t; e = e.parentElement) { const x = getComputedStyle(e).transform; if (x !== 'none') t = `; ${name(e)} has transform ${x}`; }
    return (rv ? `; its entrance (${rv.dataset.reveal || 'unveil'}) ${rv.classList.contains('is-in') ? 'played' : 'not played'}` : '') + t;
  };
  const seen = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });

  // The boxes that clip an element: ancestors with overflow other than visible that are on its containing-block chain
  // (an absolutely placed box escapes a static ancestor's overflow, a fixed one escapes all but a transformed one).
  // The body is left out: its overflow-x is the page's own, and the page's sideways scroll is measured on its own.
  const clippers = (el) => {
    const list = [];
    let pos = getComputedStyle(el).position;
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const contains = pos === 'absolute' ? cs.position !== 'static' || cs.transform !== 'none'
        : pos === 'fixed' ? cs.transform !== 'none' || cs.filter !== 'none' : true;
      if (!contains) continue;
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const b = a.getBoundingClientRect();
        const m = cs.overflowX === 'clip' ? parseFloat(cs.overflowClipMargin) || 0 : 0;
        const left = b.left + a.clientLeft - m;
        const top = b.top + a.clientTop - m;
        list.push({ a, hides: /hidden|clip/.test(cs.overflowX + cs.overflowY), b: { left, top, right: left + a.clientWidth + 2 * m, bottom: top + a.clientHeight + 2 * m } });
      }
      pos = cs.position;
    }
    return list;
  };
  const textRects = (el) => {
    let u = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const b of range.getClientRects()) {
        if (b.width < 1) continue;
        u = u ? { left: Math.min(u.left, b.left), right: Math.max(u.right, b.right), top: Math.min(u.top, b.top), bottom: Math.max(u.bottom, b.bottom) } : box(b);
      }
    }
    return u;
  };
  const allText = (el) => { const range = document.createRange(); range.selectNodeContents(el); const b = range.getBoundingClientRect(); return b.width ? box(b) : null; };

  // 1. Sideways scroll.
  const sw = document.documentElement.scrollWidth;
  if (sw > W || W !== width) {
    const wide = [...document.body.querySelectorAll('*')].filter((el) => !fixed(el)).map((el) => {
      let b = box(el.getBoundingClientRect());
      for (const c of clippers(el)) b = cut(b, c.b);
      return { el, b };
    }).filter(({ b }) => !empty(b) && (b.right > width + 1 || b.left < -1)).sort((x, y) => y.b.right - x.b.right).slice(0, 8);
    out.push({ kind: 'overflow', el: 'page', text: '', detail: `scrollWidth ${sw}, innerWidth ${W}; widest: ${wide.map((w) => `${name(w.el)} [${r(w.b.left)}, ${r(w.b.right)}]`).join('; ') || 'none found'}` });
  }

  // 2. Words past the screen's left or right edge, where they are not clipped first.
  for (const el of document.body.querySelectorAll('*')) {
    let t = textRects(el);
    if (!t || !seen(el)) continue;
    for (const c of clippers(el)) t = cut(t, c.b);
    if (empty(t)) continue;
    if (t.left < -1 || t.right > W + 1) out.push({ kind: 'past-edge', el: name(el), text: words(el), detail: `text from ${r(t.left)} to ${r(t.right)} on a ${W} px screen` });
  }

  // 3. Headings and buttons cut by a box that hides its overflow (one hidden entirely is closed, not cut).
  for (const el of document.body.querySelectorAll('h1, h2, h3, h4, h5, h6, button, .btn, [role="button"], input[type="submit"], input[type="button"]')) {
    if (!seen(el)) continue;
    const b = /^H\d$/.test(el.tagName) ? allText(el) : box(el.getBoundingClientRect());
    if (!b || empty(b)) continue;
    const cs = clippers(el);
    if (cs.some((c) => empty(cut(b, c.b)))) continue;
    const by = cs.find((c) => c.hides && (b.left < c.b.left - 1 || b.right > c.b.right + 1 || b.top < c.b.top - 1 || b.bottom > c.b.bottom + 1));
    if (by) {
      out.push({ kind: 'clipped', el: name(el), text: words(el),
        detail: `[${r(b.left)}, ${r(b.top)}, ${r(b.right)}, ${r(b.bottom)}] cut by ${name(by.a)} [${r(by.b.left)}, ${r(by.b.top)}, ${r(by.b.right)}, ${r(by.b.bottom)}]${moving(el)}` });
    }
  }

  // 4. What is meant to be centred.
  const mid = (b) => (b.left + b.right) / 2;
  const inner = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { left: b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), right: b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) }; };
  const centred = (what, el, b, ref) => {
    const off = mid(b) - mid(ref);
    if (Math.abs(off) > 4) out.push({ kind: 'off-centre', el: name(el), text: words(el), detail: `${what} is ${r(off)} px off (its middle ${r(mid(b))}, meant ${r(mid(ref))})` });
  };
  const word = document.querySelector('[data-hero-word]');
  if (word && seen(word)) { const t = allText(word); if (t) centred('the hero\'s name', word, t, document.querySelector('.hero__stage').getBoundingClientRect()); }
  for (const head of document.querySelectorAll('.section__head--center, .page-head')) {
    if (!seen(head) || head.getBoundingClientRect().width < 1) continue;
    if (head.classList.contains('section__head--center')) centred('the centred head', head, head.getBoundingClientRect(), inner(head.parentElement));
    for (const t of head.querySelectorAll('h1, h2, p')) {
      if (!seen(t) || getComputedStyle(t).textAlign !== 'center') continue;
      const b = allText(t);
      if (b) centred('the centred words', t, b, inner(head));
    }
  }
  return out;
}

/** Runs in the page: the command palette and the message island, opened, each centred where it is meant to be. */
function overlays(phase) {
  const out = [];
  const W = innerWidth;
  const mid = (b) => (b.left + b.right) / 2;
  const check = (what, el, want) => {
    if (!el) { out.push({ kind: 'off-centre', el: what, text: '', detail: 'did not open' }); return; }
    const off = mid(el.getBoundingClientRect()) - want;
    if (Math.abs(off) > 4) out.push({ kind: 'off-centre', el: what, text: (el.textContent || '').trim().slice(0, 40), detail: `${Math.round(off)} px off (meant ${Math.round(want)})` });
  };
  if (phase === 'palette') check('.palette__box', document.querySelector('.palette__box'), W / 2);
  if (phase === 'island') {
    // Over the page's own column: past the 256 px sidebar on a computer, the whole width on a phone or tablet.
    const island = document.querySelector('.lux-island.is-open');
    check('.lux-island', island, W > 900 ? 256 + (W - 256) / 2 : W / 2);
    if (island) check('.lux-island__msg', island.querySelector('.lux-island__msg:not(.is-out)'), mid(island.getBoundingClientRect()));
  }
  return out;
}

/** Runs in the page: down through every scrolling part a screen at a time (so what reveals on scroll has played), then back. */
async function scrollThrough() {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const parts = [document.scrollingElement, ...document.querySelectorAll('main, .main, .app__main, [data-view], .view')]
    .filter((el, i, all) => all.indexOf(el) === i && el.scrollHeight > el.clientHeight + 20 && (el === document.scrollingElement || /auto|scroll/.test(getComputedStyle(el).overflowY)));
  for (const el of parts) {
    const step = Math.max(200, el.clientHeight * 0.8);
    for (let y = step, n = 0; y < el.scrollHeight && n < 80; y += step, n++) {
      el.scrollTo({ top: y, behavior: 'instant' });   // the site's scroll is smooth (CSS), which would lag a screen behind each step
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));   // a frame drawn here, so what reveals on scroll has seen it
      await wait(80);
    }
    el.scrollTo({ top: 0, behavior: 'instant' });
  }
  // (A paragraph revealed word by word is motion.js's, scrubbed with the scroll, and never marked as played.)
  // An entrance still unplayed after that is brought to the middle of the screen once, as a person stopping there
  // would; one that still does not play is reported (its box is moved and hidden for good).
  const late = [...document.querySelectorAll('[data-reveal]:not(.is-in):not([data-reveal="words"])')].filter((el) => el.getClientRects().length);
  const said = (el) => el.tagName.toLowerCase() + [...el.classList].slice(0, 2).map((c) => `.${c}`).join('') + ` (${el.dataset.reveal || 'unveil'})`;
  for (const el of late) {
    document.scrollingElement.scrollBy({ top: el.getBoundingClientRect().top - innerHeight / 2, behavior: 'instant' });   // its top edge, where it opens from
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    await wait(150);
  }
  // What an intersection observer (as site.js sets one up) says of each that never played, brought to the middle.
  const never = [];
  for (const el of late.filter((e) => !e.classList.contains('is-in'))) {
    document.scrollingElement.scrollBy({ top: el.getBoundingClientRect().top - innerHeight / 2, behavior: 'instant' });   // its top edge, where it opens from
    const seen = await new Promise((res) => { const io = new IntersectionObserver((es) => { io.disconnect(); res(es[0]); }, { rootMargin: '0px 0px -8% 0px', threshold: 0 }); io.observe(el); setTimeout(() => res(null), 2000); });
    const q = (b) => b ? [b.left, b.top, b.right, b.bottom].map(Math.round).join(',') : '-';
    // And without its clip-path, then without its transform: which of the two hides it from the observer.
    const ask = () => new Promise((res) => { const io = new IntersectionObserver((es) => { io.disconnect(); res(es[0].isIntersecting); }, { rootMargin: '0px 0px -8% 0px', threshold: 0 }); io.observe(el); setTimeout(() => res(null), 2000); });
    el.style.clipPath = 'none';
    const noClip = await ask();
    el.style.clipPath = '';
    el.style.transform = 'none';
    const noMove = await ask();
    el.style.transform = '';
    never.push(`${said(el)}; observer: ${seen ? `intersecting ${seen.isIntersecting}, box ${q(seen.boundingClientRect)}, seen ${q(seen.intersectionRect)}` : 'no answer'}; without its clip-path ${noClip}, without its transform ${noMove}; played since: ${el.classList.contains('is-in')}`);
  }
  document.scrollingElement.scrollTo({ top: 0, behavior: 'instant' });
  return { late: late.filter((el) => el.classList.contains('is-in')).map(said), never };
}

/* ------------------------------------------------------------------ driving */

async function startServer() {
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-layout-db-'));
  const log = fs.openSync(path.join(OUT, 'layout-server.log'), 'w');
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', log, log],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo' }
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${base}/api/v1/auth/config`)).ok; } catch { /* still starting */ } }
  const stop = async () => { child.kill(); await sleep(500); try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ } };
  if (!up) { await stop(); throw new Error(`the Sentinel server did not start on ${base} (see layout-server.log)`); }
  return { base, stop };
}

async function tab(browser, contextId, [width, height], theme) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', ...(contextId ? { browserContextId: contextId } : {}) });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  const mobile = width < 1024;
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
  if (mobile) await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  else await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: MOUSE }, sessionId);
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }, sessionId);
  return { s: sessionId, close: () => browser.send('Target.closeTarget', { targetId }) };
}

async function checkLayout() {
  const { base, stop } = await startServer();
  const { browser, close } = await launch(['--hide-scrollbars']);
  const found = {};   // page -> [{ at, kind, el, text, detail }]
  const allowed = [];
  const lateNotes = [];
  try {
    // A throwaway account, signed in from the page itself in the default context; public pages open signed out.
    const { s: first, close: done } = await tab(browser, null, [1366, 900], 'dark');
    await goto(browser, first, `${base}/login`);
    const signed = await evalIn(browser, first, `(async () => {
      const post = (p, body) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const email = 'layout-' + Date.now() + '@example.com', password = 'Layout-Check-2026!';
      const a = await post('/api/v1/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
      const b = await post('/api/v1/auth/login', { email, password });
      return a.ok && b.ok;
    })()`);
    await done();
    if (!signed) throw new Error('the test account could not sign in');
    const { browserContextId: anonymous } = await browser.send('Target.createBrowserContext', {});

    const started = Date.now();
    // Dark and light side by side, each in its own tabs, to keep the sweep inside the job's time.
    await Promise.all(THEMES.map(async (theme) => {
      for (const size of SIZES) {
        const [w, h] = size;
        const at = `${w}x${h} ${theme}`;
        for (const [context, pages] of [[anonymous, PUBLIC], [null, APP]]) {
          const { s, close: closeTab } = await tab(browser, context, size, theme);
          for (const [page, url] of pages) {
            const list = found[page] = found[page] || [];
            try {
              await goto(browser, s, base + url, context ? 'true' : "document.querySelector('.side')");
              await sleep(1200);
              // The pointer crosses the page and comes to rest in the middle, the wheel turns, and the page is
              // scrolled through and back; then the motion settles (the hero's drift takes 1.4 s).
              for (const [x, y] of [[0.2, 0.3], [0.8, 0.7], [0.5, 0.5]]) {
                await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: w * x, y: h * y }, s);
                await sleep(120);
              }
              await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: w / 2, y: h / 2, deltaX: 0, deltaY: 500 }, s);
              await sleep(600);
              const entrances = await evalIn(browser, s, `(${scrollThrough})()`);
              if (entrances.late.length) lateNotes.push(`${page} ${at}: played only once its top was brought to the middle: ${entrances.late.join(', ')}`);
              await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: w / 2, y: h / 2, deltaX: 0, deltaY: -500 }, s);
              await sleep(1800);
              let problems = await evalIn(browser, s, `(${measure})(${w})`);
              for (const el of entrances.never) problems.push({ kind: 'never-shown', el, text: '', detail: 'its entrance did not play, even with its top brought to the middle of the screen' });
              if (url === '/app') {
                await evalIn(browser, s, "document.querySelector('[data-palette]').click()");
                await sleep(500);
                problems = problems.concat(await evalIn(browser, s, `(${overlays})('palette')`));
                for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, s);
                await sleep(300);
                await evalIn(browser, s, "UI.toast('Your settings are saved.', 'success')");
                await sleep(1000);
                problems = problems.concat(await evalIn(browser, s, `(${overlays})('island')`));
              }
              let bad = 0;
              for (const p of problems) {
                const ok = ALLOWED.find((a) => a.kind === p.kind && p.el.includes(a.el) && (!a.size || a.size(w)));
                if (ok) allowed.push(`${page} ${at}: ${p.kind} ${p.el}: ${ok.why}`); else { list.push({ at, ...p }); bad++; }
              }
              if (bad) await shot(browser, s, `layout-${page}-${w}-${theme}`);
            } catch (err) {
              list.push({ at, kind: 'error', el: url, text: '', detail: err.message });
            }
          }
          await closeTab();
        }
      }
    }));
    for (const [page, list] of Object.entries(found)) {
      // The same problem at several sizes is one line, with every size it was seen at.
      const lines = {};
      for (const p of list) (lines[`${p.kind} ${p.el} "${p.text}"`] ||= []).push(`${p.at}: ${p.detail}`);
      result(`layout: ${page} fits every size and theme (no sideways scroll, nothing past the edge or cut, centred things centred)`, !list.length,
        Object.entries(lines).map(([k, at]) => `${k} at ${at.join(' | ')}`));
    }
    result('layout: entrances that played only when brought to the middle (not a failure: a stepped scroll can pass them)', true, lateNotes);
    result('layout: the allowed exceptions, each with its reason', true, [...new Set(allowed.map((a) => a.replace(/ \d+x\d+ \w+:/, ':')))].concat(`${Math.round((Date.now() - started) / 1000)} s for ${SIZES.length * THEMES.length * (PUBLIC.length + APP.length)} page loads`));
  } finally {
    await close();
    await stop();
  }
}

module.exports = checkLayout;
