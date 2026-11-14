'use strict';
/**
 * colour  The home page's colour preview (#colour, web/assets/js/accent.js), used as a person uses it: on a large
 *         screen and a phone, dark and light. Each gem is clicked for real; the whole page takes the colour (the
 *         gold tokens and the gold button change, the warning colours do not), its text keeps 4.5:1 on the page in
 *         the real cascade, the pick opens as a circle and a second click finishes the first. Scrolling away brings
 *         gold back with the band sweeping down, once the page stops; a tab click brings it back instantly under the
 *         panels; so does hiding the browser tab. Arrow keys move the choice. With reduced motion the change is
 *         instant, with no transition at all. Photographed: at rest, mid-circle, mid-band, every colour.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, sleep, result, serveFiles, launch, evalIn, openPage, goto, shot, pressKey, until } = require('./_shared');
const L = require('../../web/assets/js/look.js');

const IDS = ['rose', 'gold', 'teal', 'sapphire', 'amethyst', 'platinum'];
// Read the tokens the page is really drawn with, and the contrast of the accent's text tone on the page.
const READ = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  return { accent: document.documentElement.dataset.accent || 'gold', gold400: v('--gold-400'), red: v('--red'), orange: v('--orange'), yellow: v('--yellow'), green: v('--green'), bg: v('--bg'),
    contrast: /^#[0-9a-f]{6}$/i.test(v('--gold-400')) && /^#[0-9a-f]{6}$/i.test(v('--bg')) ? ratio(v('--gold-400'), v('--bg')) : 0,
    btn: getComputedStyle(document.querySelector('.colour__view .btn')).backgroundImage,
    name: document.querySelector('[data-accent-name]').textContent,
    checked: [...document.querySelectorAll('.colour__pick [aria-checked="true"]')].map((b) => b.dataset.accent),
    vt: [...document.documentElement.classList].filter((c) => c.startsWith('vt-')).join(' ') };
})()`;

async function checkColour() {
  if (!fs.existsSync(path.join(STATIC, 'index.html'))) throw new Error(`no static build in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  const at = async (s, sel) => evalIn(browser, s, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  // A real click, as a finger or mouse makes it; the page is first moved (as a person scrolls) if it is out of sight.
  const click = async (s, sel) => {
    let [x, y] = await at(s, sel);
    const h = await evalIn(browser, s, 'innerHeight');
    if (y < 80 || y > h - 40) {
      await evalIn(browser, s, `Site.scrollTo(scrollY + ${y} - innerHeight * 0.7); new Promise((r) => setTimeout(r, 400))`);
      [x, y] = await at(s, sel);
    }
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, s);
  };
  const gem = (id) => `.swatch[data-accent="${id}"]`;
  // To the section, exactly, through the page's own scroller (Lenis when it is there).
  const toColour = (s) => evalIn(browser, s, `(() => { const t = document.querySelector(innerWidth <= 560 ? '#colour h2' : '#colour').getBoundingClientRect().top + scrollY - (innerWidth <= 560 ? 100 : 90); Site.scrollTo(t); return new Promise((r) => setTimeout(r, 400)); })()`);
  try {
    const open = async (width, height, mobile, scheme, motion) => {
      const { targetId, sessionId: s } = await openPage(browser);
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile }, s);
      if (mobile) await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: motion }] }, s);
      // Every view transition the page starts, counted.
      await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__vts = 0; if (document.startViewTransition) { const st = document.startViewTransition.bind(document); document.startViewTransition = (f) => { window.__vts++; return st(f); }; }` }, s);
      await goto(browser, s, `${files.base}/index.html`, "document.querySelectorAll('.colour__pick .swatch').length === 6");
      for (let i = 0; i < 60 && !(await evalIn(browser, s, "getComputedStyle(document.querySelector('.hero .hero__cta')).opacity === '1'")); i++) await sleep(250);
      await sleep(1200);
      await toColour(s);
      return { s, done: () => browser.send('Target.closeTarget', { targetId }) };
    };

    for (const [label, width, height, mobile] of [['desktop', 1366, 900, false], ['phone', 390, 844, true]]) {
      for (const scheme of ['dark', 'light']) {
        const { s, done } = await open(width, height, mobile, scheme, 'no-preference');
        const tag = `colour: ${label}, ${scheme}`;
        const gold = await evalIn(browser, s, READ);
        const row = await evalIn(browser, s, `(() => { const g = [...document.querySelectorAll('.colour__pick .swatch__gem')].map((e) => e.getBoundingClientRect());
          return { tops: new Set(g.map((r) => Math.round(r.top))).size, smallest: Math.min(...g.map((r) => r.width)), below: Math.max(...g.map((r) => r.bottom), document.querySelector('.colour__view').getBoundingClientRect().bottom) - innerHeight,
            green: (() => { const g = document.querySelector('.colour__view .m--clear').getBoundingClientRect(); return g.height > 0 && g.bottom <= innerHeight; })(),
            headTop: document.querySelector('#colour h2').getBoundingClientRect().top, left: Math.min(...g.map((r) => r.left)), right: Math.max(...g.map((r) => r.right)), sideways: document.documentElement.scrollWidth - innerWidth,
            radios: [...document.querySelectorAll('.colour__pick [role=radio]')].map((b) => b.getAttribute('aria-checked') + ':' + (b.textContent.trim() || '?')) }; })()`);
        await sleep(1500);
        result(`${tag}: heading, six real-size gems in one row and the view with its red and green examples all on one screen, gold chosen, nothing scrolls sideways`, row.green && row.tops === 1 && row.smallest >= 36 && row.below <= 0 && row.headTop >= 0 && row.left >= 0 && row.right <= width && row.sideways <= 0
          && row.radios.length === 6 && row.radios.filter((r) => r.startsWith('true')).join() === 'true:Gold' && gold.accent === 'gold', row);
        await shot(browser, s, `colour-${label}-${scheme}-gold`);

        // Every colour, clicked: the page's gold tokens change, the warnings do not, and the text still reads.
        const seen = [];
        for (const id of IDS.filter((x) => x !== 'gold')) {
          await click(s, gem(id));
          await sleep(1000);
          const m = await evalIn(browser, s, READ);
          seen.push(m.gold400);
          const ok = m.accent === id && m.checked.join() === id && m.gold400 !== gold.gold400 && m.btn !== gold.btn && m.contrast >= 4.5 && m.vt === ''
            && ['red', 'orange', 'yellow', 'green', 'bg'].every((k) => m[k] === gold[k]);
          result(`${tag}: ${id} takes the whole page, keeps 4.5:1 (${m.contrast.toFixed(2)}) and leaves the warnings alone`, ok, ok ? undefined : { m, gold });
          if (!mobile) await shot(browser, s, `colour-${label}-${scheme}-${id}`);
        }
        result(`${tag}: every colour is its own`, new Set(seen).size === seen.length, seen);

        // The pick, stopped half way and photographed: a circle opening from the gem.
        await click(s, gem('sapphire'));
        const circle = await until(browser, s, `(() => { const a = document.getAnimations().find((x) => x.effect && x.effect.pseudoElement === '::view-transition-new(root)');
          if (!a || !document.documentElement.classList.contains('vt-pick')) return null; a.pause(); a.currentTime = 90; return a.effect.getKeyframes().map((k) => k.clipPath).join(' '); })()`, 3000);
        if (scheme === 'dark' || mobile) await shot(browser, s, `colour-${label}-${scheme}-opening`);
        result(`${tag}: the pick opens as a circle from the gem`, /circle\(/.test(String(circle)), { circle });
        // A second click while it runs: the first finishes at once, the second wins, nothing is left over.
        await click(s, gem('rose'));
        await sleep(1100);
        const twice = await evalIn(browser, s, READ);
        result(`${tag}: a second click mid-change ends on the second colour, with nothing left running`, twice.accent === 'rose' && twice.vt === ''
          && (await evalIn(browser, s, "document.getAnimations().filter((x) => x.effect && /view-transition/.test(x.effect.pseudoElement || '')).length")) === 0, twice);

        // Arrow keys move the choice, as in any group of radio buttons.
        await evalIn(browser, s, `document.querySelector('${gem('rose')}').focus(); true`);
        await pressKey(browser, s, 'ArrowRight');
        await sleep(200);
        await pressKey(browser, s, 'ArrowRight');
        await sleep(1000);
        const key = await evalIn(browser, s, `[document.documentElement.dataset.accent, document.activeElement.dataset.accent]`);
        result(`${tag}: the right arrow moves through the colours (rose, gold, teal), and focus with it`, key[0] === 'teal' && key[1] === 'teal', key);

        // Scrolled away: nothing while the page moves, then the gold band sweeps down. Photographed half way.
        await evalIn(browser, s, `window.__band = null; new MutationObserver(() => { if (document.documentElement.classList.contains('vt-gold')) window.__band = window.__band || 'seen'; }).observe(document.documentElement, { attributes: true }); Site.scrollTo(0); true`);
        const band = await until(browser, s, `(() => { const a = document.getAnimations().find((x) => x.effect && x.effect.pseudoElement === '::view-transition-new(root)');
          if (!a || !document.documentElement.classList.contains('vt-gold')) return null; a.pause(); a.currentTime = 450; document.querySelectorAll('.gold-band').forEach((b) => b.getAnimations().forEach((x) => { x.pause(); x.currentTime = 450; })); return 'paused'; })()`, 4000);
        await shot(browser, s, `colour-${label}-${scheme}-return`);
        await evalIn(browser, s, "document.getAnimations().forEach((a) => a.play()); true");
        await sleep(1200);
        const back = await evalIn(browser, s, READ);
        result(`${tag}: scrolled away, gold comes back with the band sweeping down`, band === 'paused' && back.accent === 'gold' && back.gold400 === gold.gold400 && back.btn === gold.btn && back.name === 'Gold'
          && !(await evalIn(browser, s, "document.querySelector('.gold-band')")), { band, back });

        // A tab clicked: gold comes back under the panels, with no band of its own.
        if (!mobile) {
          await toColour(s);
          await click(s, gem('teal'));
          await sleep(1000);
          await evalIn(browser, s, 'window.__band = null; true');
          await click(s, '.nav__links a[href$="#how"]');
          await sleep(2600);
          const tab = await evalIn(browser, s, `[document.documentElement.dataset.accent || 'gold', window.__band]`);
          result(`${tag}: a tab click brings gold back under the panels, instantly`, tab[0] === 'gold' && tab[1] === null, tab);
        }

        // The browser tab hidden: gold, at once.
        await toColour(s);
        await click(s, gem('amethyst'));
        await sleep(1000);
        const hidden = await evalIn(browser, s, `(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
          const r = [document.documentElement.dataset.accent || 'gold', document.documentElement.className.includes('vt-')]; delete document.hidden; return r; })()`);
        result(`${tag}: a hidden browser tab comes back gold`, hidden[0] === 'gold' && hidden[1] === false, hidden);
        await done();
      }
    }

    // Reduced motion: the colour changes at once, no view transition is ever started; in a light system with the
    // dark theme chosen, the dark tones are the ones drawn.
    for (const scheme of ['dark', 'light']) {
      const { s, done } = await open(1366, 900, false, scheme, 'reduce');
      await click(s, gem('amethyst'));
      const m = await evalIn(browser, s, READ);
      const vts = await evalIn(browser, s, 'window.__vts');
      result(`colour: reduced motion, ${scheme}: the colour changes at once, with no transition`, m.accent === 'amethyst' && vts === 0 && m.vt === '' && m.contrast >= 4.5, { m, vts });
      await shot(browser, s, `colour-still-${scheme}-amethyst`);
      if (scheme === 'light') {
        await evalIn(browser, s, "document.documentElement.dataset.theme = 'dark'; true");
        const d = await evalIn(browser, s, READ);
        result('colour: light system, dark theme chosen: the dark tones are drawn and read', d.contrast >= 4.5 && d.gold400 !== m.gold400, { d, m });
      }
      await done();
    }
    // A visitor who chose sapphire in the app (kept as look-app.js keeps it): the page rests in sapphire with its gem
    // chosen, the Gold gem draws the stylesheets' real gold over it, and moving on gives sapphire back.
    for (const scheme of ['dark', 'light']) {
      const { s, done } = await open(1366, 900, false, scheme, 'no-preference');
      await evalIn(browser, s, `(() => { const pick = (sc) => Object.fromEntries(Object.entries(SentinelLook.ramp('sapphire', sc)).filter(([k]) => /^--(gold|metal|line-gold|sketch-gold|btn-grad|gilt)/.test(k)));
        localStorage.setItem('sentinel:accent', 'sapphire'); localStorage.setItem('sentinel:look-vars', JSON.stringify({ accent: 'sapphire', dark: pick('dark'), light: pick('light') })); return true; })()`);
      await goto(browser, s, `${files.base}/index.html`, "document.querySelectorAll('.colour__pick .swatch').length === 6");
      await sleep(1500);
      await toColour(s);
      const theirs = await evalIn(browser, s, READ);
      await click(s, gem('gold'));
      await sleep(1100);
      const real = await evalIn(browser, s, READ);
      await shot(browser, s, `colour-own-${scheme}-gold`);
      // The marketing pages' own gold (lux.css) in dark, sentinel.css's in light.
      const want = { dark: '#d2ac63', light: L.GOLD.light.web[400] }[scheme];
      result(`colour: own accent sapphire, ${scheme}: the page rests in it, the Gold gem draws real gold (${real.gold400}) over it`,
        theirs.accent === 'sapphire' && theirs.checked.join() === 'sapphire' && theirs.gold400 === L.ramp('sapphire', scheme)['--gold-400']
        && real.accent === 'gold' && real.checked.join() === 'gold' && real.gold400 === want && real.btn !== theirs.btn && real.name === 'Gold', { theirs, real });
      await evalIn(browser, s, 'Site.scrollTo(0); true');
      await sleep(2600);
      const back = await evalIn(browser, s, READ);
      result(`colour: own accent sapphire, ${scheme}: moving on gives their sapphire back`, back.accent === 'sapphire' && back.gold400 === theirs.gold400 && back.checked.join() === 'sapphire', back);
      await evalIn(browser, s, 'localStorage.clear(); true');
      await done();
    }

    // The swatch sheet: each colour's words, button and chip on the light pages' grounds, as 1.20.0 drew them (every
    // hue deepened to one shade, gold at 4.39:1) beside how they are drawn now, with each one's worst contrast.
    {
      const { s, done } = await open(1366, 900, false, 'light', 'no-preference');
      // 1.20.0's light word tones, as its look.js drew them.
      const BEFORE = { gold: '#8a6420', rose: '#8b4c67', amethyst: '#72538d', sapphire: '#405f99', teal: '#006b70', platinum: '#5c6167' };
      const GROUNDS = ['#efe8da', '#e4dbca', '#f6f1e7'];
      const tone = (r) => r['--gold-400'] || L.GOLD.light.web[400];
      const cells = (r) => { const c = tone(r); const worst = Math.min(...GROUNDS.map((g) => L.contrast(c, g)));
        return GROUNDS.map((g) => `<div style="background:${g};padding:14px 16px;border-radius:12px;display:grid;gap:8px"><b style="color:${c};font:500 17px/1.2 var(--sans)">Check a link</b><span style="color:${c};font:400 13px/1.2 var(--mono)">${c} ${L.contrast(c, g).toFixed(2)}:1</span></div>`).join('')
          + `<div style="display:grid;place-items:center;border-radius:12px;background:${r['--acc-grad'] || ''};background-color:${c};color:#fff;font:600 15px var(--sans)">Button</div><div style="font:500 13px var(--mono);align-self:center;color:${worst >= 4.5 ? '#1a6e35' : '#b3261e'}">worst ${worst.toFixed(2)}</div>`; };
      const row = (label, r) => `<div style="display:grid;grid-template-columns:150px repeat(3,1fr) 110px 100px;gap:10px;align-items:stretch"><div style="font:500 15px var(--sans);align-self:center">${label}</div>${cells(r)}</div>`;
      const html = [];
      for (const a of L.ACCENTS) html.push(row(`${a.name}, 1.20.0`, { '--gold-400': BEFORE[a.id] }), row(`${a.name}, now`, L.ramp(a.id, 'light')));
      await evalIn(browser, s, `(() => { document.body.innerHTML = ${JSON.stringify(`<div style="display:grid;gap:10px;padding:24px;background:#efe8da;color:#1d1811">${html.join('')}</div>`)}; document.body.style.margin = '0'; scrollTo(0, 0); return true; })()`);
      await sleep(400);
      await shot(browser, s, 'colour-swatches-light');
      await done();
    }
  } finally { await close(); files.server.close(); }
}

module.exports = checkColour;
