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
          // The circle runs 0.72 s once the browser has its pictures of the page; the first change of a page can wait
          // longer for them on a busy runner (run 43550196853: rose, the first, still had vt-pick at 1 s). So the
          // change is waited for, and one still running after 4 s fails.
          const t0 = Date.now();
          await until(browser, s, "![...document.documentElement.classList].some((c) => c.startsWith('vt-'))", 4000);
          const ms = Date.now() - t0;
          const m = await evalIn(browser, s, READ);
          seen.push(m.gold400);
          const ok = m.accent === id && m.checked.join() === id && m.gold400 !== gold.gold400 && m.btn !== gold.btn && m.contrast >= 4.5 && m.vt === ''
            && ['red', 'orange', 'yellow', 'green', 'bg'].every((k) => m[k] === gold[k]);
          result(`${tag}: ${id} takes the whole page, keeps 4.5:1 (${m.contrast.toFixed(2)}) and leaves the warnings alone (${ms} ms)`, ok, ok ? undefined : { m, gold });
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
      await evalIn(browser, s, `(() => { const pick = (sc) => Object.fromEntries(Object.entries(SentinelLook.ramp('sapphire', sc)).filter(([k]) => /^--(gold|metal|line|sketch|btn-grad|gilt|text|muted|faint|bg|surface|field-bg|sheet|panel|glass|haze|glow|star|live|words)/.test(k)));
        localStorage.setItem('sentinel:accent', 'sapphire'); localStorage.setItem('sentinel:look-vars', JSON.stringify({ accent: 'sapphire', dark: pick('dark'), light: pick('light') })); return true; })()`);
      await goto(browser, s, `${files.base}/index.html`, "document.querySelectorAll('.colour__pick .swatch').length === 6");
      await sleep(1500);
      await toColour(s);
      const theirs = await evalIn(browser, s, READ);
      // Rose first, so gold is worked out while another colour is drawn over the page.
      await click(s, gem('rose'));
      await sleep(1100);
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

    // The swatch sheet: each accent's words, button and chip on the light pages' grounds, with each one's worst contrast.
    {
      const { s, done } = await open(1366, 900, false, 'light', 'no-preference');
      const GROUNDS = ['#efe8da', '#e4dbca', '#f6f1e7'];
      const tone = (r) => r['--gold-400'] || L.GOLD.light.web[400];
      const cells = (r) => { const c = tone(r); const worst = Math.min(...GROUNDS.map((g) => L.contrast(c, g)));
        return GROUNDS.map((g) => `<div style="background:${g};padding:9px 14px;border-radius:10px;display:grid;gap:4px"><b style="color:${c};font:500 17px/1.2 var(--sans)">Check a link</b><span style="color:${c};font:400 13px/1.2 var(--mono)">${c} ${L.contrast(c, g).toFixed(2)}:1</span></div>`).join('')
          + `<div style="display:grid;place-items:center;border-radius:12px;background:${r['--acc-grad'] || ''};background-color:${c};color:#fff;font:600 15px var(--sans)">Button</div><div style="font:500 13px var(--mono);align-self:center;color:${worst >= 4.5 ? '#1a6e35' : '#b3261e'}">worst ${worst.toFixed(2)}</div>`; };
      const row = (label, r) => `<div style="display:grid;grid-template-columns:150px repeat(3,1fr) 110px 100px;gap:10px;align-items:stretch"><div style="font:500 15px var(--sans);align-self:center">${label}</div>${cells(r)}</div>`;
      const html = [];
      for (const a of L.ACCENTS) html.push(row(a.name, L.ramp(a.id, 'light')));
      await evalIn(browser, s, `(() => { document.body.innerHTML = ${JSON.stringify(`<div style="display:grid;gap:6px;padding:16px 24px;background:#efe8da;color:#1d1811">${html.join('')}</div>`)}; document.body.style.margin = '0'; scrollTo(0, 0); return true; })()`);
      await sleep(400);
      await shot(browser, s, 'colour-swatches-light');
      await done();
    }

    // Caution on light paper, two ways, beside gold, safe and warning: as olive words (1.20.2's first try) and as a
    // yellow fill with ink (what ships). Each: a heading, a chip, a mark's tile, a dot, and how caution and safe green
    // look to someone without green cones (Machado 2009). Then warning orange before and after, on the cards' ground.
    {
      const { s, done } = await open(1366, 760, false, 'light', 'no-preference');
      const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const gam = (v) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055); };
      const DEUTAN = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];
      const deutan = (hex) => { const c = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16))); return '#' + DEUTAN.map((r) => (256 | Math.round(gam(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))).toString(16).slice(1)).join(''); };
      const INK = '#15130d', Y = L.STATUS.light.yellow, GOLD = L.GOLD.light.web[400], GREEN = L.STATUS.light.green;
      const seal = (fill, glyph) => `<svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="10.5" fill="${fill}" stroke="${INK}" stroke-opacity=".55" stroke-width="1.2"/><rect x="11" y="6.5" width="2" height="7" rx="1" fill="${glyph}"/><circle cx="12" cy="16.6" r="1.25" fill="${glyph}"/></svg>`;
      const cell = (inner, bg = '#f6f1e7') => `<div style="background:${bg};padding:12px 14px;border-radius:10px;display:flex;gap:10px;align-items:center;min-height:62px">${inner}</div>`;
      const sw = (c, label) => `<span style="display:grid;gap:3px;justify-items:center;font:400 11px var(--mono)"><i style="display:block;width:34px;height:22px;border-radius:6px;background:${c}"></i>${label}</span>`;
      const way = (label, words, chip, tile, dot, caution) => `<div style="display:grid;grid-template-columns:170px 1.5fr 1fr 70px 70px 1.2fr;gap:10px;align-items:stretch"><div style="font:500 15px var(--sans);align-self:center">${label}</div>`
        + cell(words) + cell(chip) + cell(tile) + cell(dot)
        + cell(`${sw(deutan(caution), 'caution')}${sw(deutan(GREEN), 'safe')}${sw(deutan(GOLD), 'gold')}<span style="font:400 12px var(--sans);color:#57554f">without green cones</span>`) + '</div>';
      const OLIVE = '#646400';
      const html = [
        way('Olive words<br><small>first try, #646400</small>',
          `<b style="color:${OLIVE};font:600 17px var(--sans)">Take care on this page</b>`,
          `<span style="padding:5px 12px;border-radius:999px;color:${OLIVE};background:color-mix(in srgb, ${OLIVE} 13%, transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb, ${OLIVE} 40%, transparent);font:600 14px var(--sans)">Caution</span>`,
          seal(`color-mix(in srgb, ${OLIVE} 13%, #f6f1e7)`, OLIVE), `<i style="width:12px;height:12px;border-radius:50%;background:${OLIVE}"></i>`, OLIVE),
        way(`Yellow fill<br><small>shipped, ${Y}</small>`,
          `<i style="flex:none;width:.62em;height:.62em;border-radius:50%;background:${Y};box-shadow:inset 0 0 0 1.5px rgb(21 19 13 / .55);font-size:17px"></i><b style="color:${INK};font:600 17px var(--sans)">Take care on this page</b>`,
          `<span style="padding:5px 12px;border-radius:999px;color:${INK};background:${Y};font:600 14px var(--sans)">Caution</span>`,
          seal(Y, INK), `<i style="width:12px;height:12px;border-radius:50%;background:${Y};box-shadow:0 0 0 1px rgb(21 19 13 / .45)"></i>`, Y),
        way('Gold, for scale<br><small>the accent</small>', `<b style="color:${GOLD};font:600 17px var(--sans)">Check a link</b>`,
          `<span style="padding:5px 12px;border-radius:999px;color:#fff;background:${GOLD};font:600 14px var(--sans)">Button</span>`, '', '', GOLD)
      ];
      const orange = (label, c) => `<div style="display:grid;grid-template-columns:170px 1fr;gap:10px"><div style="font:500 15px var(--sans);align-self:center">${label}</div>`
        + cell(`<b style="color:${c};font:600 17px var(--sans)">Warning: likely scam</b><span style="font:400 13px var(--mono);color:${c}">${c} ${L.contrast(c, '#e4dbca').toFixed(2)}:1 on the cards' #e4dbca</span>`, '#e4dbca') + '</div>';
      html.push(orange('Warning, 1.20.1', '#b04a00'), orange('Warning, now', L.STATUS.light.orange));
      await evalIn(browser, s, `(() => { document.body.innerHTML = ${JSON.stringify(`<div style="display:grid;gap:8px;padding:16px 24px;background:#efece6;color:#1d1811">${html.join('')}</div>`)}; document.body.style.margin = '0'; scrollTo(0, 0); return true; })()`);
      await sleep(400);
      await shot(browser, s, 'colour-caution-olive-vs-fill');
      await done();
    }

    // The marks sheet: the real pieces that say danger, warning, caution and safe, drawn by the site's and the app's own
    // stylesheets, light beside dark in one picture. Caution is never louder than danger: on light paper its tile is a
    // pale yellow wash with an ink mark, its words ink beside a small yellow dot; on dark, the yellow words it always was.
    const seen = {};
    for (const [label, width, height, mobile] of [['desktop', 1366, 820, false], ['phone', 390, 1700, true]]) {
      const { s, done } = await open(width, height, mobile, 'light', 'reduce');
      const got = await evalIn(browser, s, `(async () => {
        const g = (t) => window.SentinelMasks ? SentinelMasks.svg(t) : '';
        const S = [['red', 'scam', 'Confirmed scam', 'Danger'], ['orange', 'virus', 'Likely virus', 'Warning'], ['yellow', 'malware', 'Possible malware', 'Caution'], ['green', 'scam', 'No scam signs', 'Safe']];
        const body = '<main style="display:grid;gap:16px;padding:18px;background:var(--bg);color:var(--text);min-height:100vh;box-sizing:border-box">'
          + '<b style="font:600 15px var(--sans)">' + '%SCHEME%' + '</b>'
          + '<div class="masks">' + S.slice(0, 3).map(([c, t]) => '<span class="m m--' + c + ' is-on">' + g(t) + '</span>').join('') + '</div>'
          + '<div style="display:flex;gap:10px;flex-wrap:wrap">' + S.map(([c, t]) => '<div class="result__glyph" data-s="' + c + '" data-status="' + c + '" style="animation:none">' + g(t) + '</div>').join('') + '</div>'
          + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">' + S.map(([c, t, w]) => '<div class="try__threat" data-s="' + c + '" data-status="' + c + '">' + g(t) + '<b>' + w + '</b></div>').join('') + '</div>'
          + '<div style="display:flex;gap:10px;align-items:center">' + S.map(([c, t]) => '<div class="verdict__icon" data-status="' + c + '">' + g(t) + '</div><span class="list__icon" data-status="' + c + '">' + g(t) + '</span>').join('') + '</div>'
          + '<div class="severity">' + S.slice(0, 3).reverse().map(([c, , , w]) => '<button type="button" data-sev="' + c + '" style="--sc:var(--' + c + ')" aria-pressed="' + (c === 'yellow') + '">' + w + '</button>').join(' ') + '</div>'
          + ['red', 'orange', 'yellow', 'green'].map((c) => '<div class="next-steps next-steps--' + (c === 'green' ? 'clear' : c) + '" data-s="' + c + '"><h3>' + { red: 'What to do now', orange: 'What to do now', yellow: 'If you are not sure', green: 'Before you use it' }[c] + '</h3></div>').join('')
          + '</main>';
        const css = ['sentinel', 'interactive', 'app'].map((f) => '<link rel="stylesheet" href="/assets/css/' + f + '.css">').join('');
        const frame = (scheme) => new Promise((r) => { const f = document.createElement('iframe'); f.dataset.scheme = scheme; f.onload = () => r(f);
          f.style.cssText = 'border:0;width:100%;height:100%;display:block';
          f.srcdoc = '<!doctype html><html data-theme="' + scheme + '"><head><base href="' + location.origin + '/">' + css + '</head><body style="margin:0">' + body.replace('%SCHEME%', scheme === 'light' ? 'Light' : 'Dark') + '</body></html>';
          document.getElementById('sheet').append(f); });
        document.body.innerHTML = '<div id="sheet" style="display:grid;grid-template-' + (innerWidth < 700 ? 'rows' : 'columns') + ':1fr 1fr;width:100vw;height:100vh"></div>';
        document.body.style.margin = '0'; scrollTo(0, 0);
        const out = {};
        for (const scheme of ['light', 'dark']) {
          const f = await frame(scheme);
          await new Promise((r) => setTimeout(r, 500));
          const d = f.contentDocument, cs = (sel, p = 'color') => f.contentWindow.getComputedStyle(d.querySelector(sel))[p];
          const o = {};
          for (const c of ['red', 'orange', 'yellow', 'green']) o[c] = { tile: cs('.try__threat[data-s="' + c + '"]'), tileBg: cs('.try__threat[data-s="' + c + '"]', 'backgroundColor'), glyphBg: cs('.result__glyph[data-s="' + c + '"]', 'backgroundColor'), h3: cs('.next-steps[data-s="' + c + '"] h3') };
          const path = (sel) => { const p = f.contentWindow.getComputedStyle(d.querySelector(sel + ' path')); return { fill: p.fill, stroke: p.stroke }; };
          for (const c of ['red', 'orange', 'yellow', 'green']) Object.assign(o[c], { glyph: path('.result__glyph[data-s="' + c + '"]'), icon: path('.verdict__icon[data-status="' + c + '"]') });
          o.mark = path('.m--yellow');
          o.markBg = cs('.m--yellow', 'backgroundColor'); o.pressed = cs('.severity [data-sev="yellow"]');
          out[scheme] = o;
        }
        out.wide = document.documentElement.scrollWidth > innerWidth + 1;
        return out;
      })()`);
      await shot(browser, s, `colour-marks-sheet-${label}`);
      seen[label] = got;
      await done();
    }
    // Caution's tile is the same pale share of yellow in both schemes, as danger's and warning's are of theirs: never louder.
    const hex2rgb = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
    // Caution's words and its mask's hairline take caution's ink (look.js); words on the yellow itself, --on-yellow.
    const INK = hex2rgb(L.CAUTION_INK), ON_YELLOW = 'rgb(21, 19, 13)', YEL = 'rgb(245, 197, 66)';
    // Glyph weight, danger > warning > caution: danger's, warning's and safe's masks are solid in their colour; caution's
    // is yellow, edged on light paper by a hairline of ink (never the solid ink mask that outweighed danger), plain on dark.
    const solid = (o, sc, c) => o[c].glyph.fill === hex2rgb(L.STATUS[sc][c]) && o[c].glyph.stroke === 'none' && o[c].icon.fill === hex2rgb(L.STATUS[sc][c]);
    result('colour: danger, warning, caution and safe side by side, named by data-status; caution on light paper is ink words on a pale yellow and a yellow mask edged in ink, lighter than danger and warning; on dark, yellow',
      Object.values(seen).every((v) => !v.wide && ['light', 'dark'].every((sc) => {
        const o = v[sc], light = sc === 'light', edge = light ? INK : 'none';
        return o.yellow.h3 === (light ? INK : YEL) && o.yellow.tile === (light ? INK : YEL) && o.red.tile === hex2rgb(L.STATUS[sc].red) && o.red.h3 === hex2rgb(L.STATUS[sc].red)
          && o.pressed === ON_YELLOW && o.yellow.glyphBg === 'rgba(245, 197, 66, 0.14)' && o.yellow.tileBg !== YEL
          && ['red', 'orange', 'green'].every((c) => solid(o, sc, c))
          && [o.yellow.glyph, o.yellow.icon, o.mark].every((p) => p.fill === YEL && p.stroke === edge);
      })), seen);
  } finally { await close(); files.server.close(); }
}

module.exports = checkColour;
