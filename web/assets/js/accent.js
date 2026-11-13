/* The colour preview on the home page (#colour): the product's own accents (look.js), tried on the whole page.
 *
 * The colours are look.js's: its table and its ramp, the same tones the app, live scanning and the companion draw,
 * with red, orange, yellow and green never among them. Nothing is computed here.
 *
 * A pick opens the new colour as a circle from the gem. Gold comes back with a different motion, a band of gold
 * light sweeping down, when the section is scrolled away from (once the scrolling stops), instantly under the tab
 * panels when a tab is clicked, and instantly when the browser tab is hidden. Nothing is saved. Nothing runs at
 * rest: one IntersectionObserver, and a scroll listener only while a return to gold is waiting.
 */
(function (root) {
  'use strict';

  const L = root.SentinelLook;
  // Rainbow order, gold as the yellow.
  const ORDER = ['rose', 'gold', 'teal', 'sapphire', 'amethyst', 'platinum'];

  /*
   * The stylesheet for one accent: dark everywhere, light where the page is light, so it follows a theme changed while
   * it shows. !important, so it is drawn over a look this visitor chose in the app (look.js draws that on the page
   * itself); taking the sheet away gives their own look back.
   */
  function css(id) {
    const decl = (s) => Object.entries(L.ramp(id, s)).map(([k, v]) => `${k}:${v} !important`).join(';');
    const light = decl('light');
    return `:root[data-accent]{${decl('dark')}}`
      + `@media (prefers-color-scheme: light){:root[data-accent]:not([data-theme="dark"]){${light}}}`
      + `:root[data-accent][data-theme="light"]{${light}}`;
  }
  if (typeof module === 'object' && module.exports) { module.exports = { css, ORDER }; return; }
  if (!L) return;
  const ACCENTS = ORDER.map((id) => L.ACCENTS.find((a) => a.id === id));

  /* ------------------------------------------------------------- the page */

  const doc = root.document;
  const html = doc.documentElement;
  const section = doc.getElementById('colour');
  const group = section && section.querySelector('.colour__pick');
  if (!group) return;
  const name = section.querySelector('[data-accent-name]');
  const sheet = doc.createElement('style');
  doc.head.appendChild(sheet);
  // Motion Off (boot.js data-motion, which the system asking for less motion also sets): every change is instant.
  const still = () => html.dataset.motion === 'off';

  group.innerHTML = ACCENTS.map((a) => {
    const r = a.id === 'gold' ? null : L.ramp(a.id, 'dark');
    const c = (s) => (r ? r[`--gold-${s}`] : L.GOLD.dark.web[s]);
    return `<button type="button" class="swatch" role="radio" aria-checked="${a.id === 'gold'}" tabindex="${a.id === 'gold' ? 0 : -1}" data-accent="${a.id}"`
      + ` style="--sw-hi:${c(200)};--sw:${c(400)};--sw-lo:${c(600)}"><span class="swatch__gem" aria-hidden="true"></span><span class="swatch__name">${a.name}</span></button>`;
  }).join('');
  const swatches = [...group.querySelectorAll('.swatch')];

  // The accent look.js drew for this visitor (gold, or their own from the app), given back when gold comes back.
  // ponytail: with an accent of their own, the Gold gem gives back theirs, not gold; a gold sheet when that matters.
  const own = html.getAttribute('data-accent');
  let current = 'gold';
  let vt = null;
  function apply(id) {
    current = id;
    if (id === 'gold') { if (own) html.setAttribute('data-accent', own); else html.removeAttribute('data-accent'); sheet.textContent = ''; } else { sheet.textContent = css(id); html.dataset.accent = id; }
    swatches.forEach((b) => { const on = b.dataset.accent === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    if (name) name.textContent = ACCENTS.find((a) => a.id === id).name;
  }

  // how: 'pick' (a circle from the swatch), 'gold' (the band sweeping down) or 'instant'.
  function go(id, how, from) {
    if (id === current) return;
    // A second click finishes the first change at once, so two never fight.
    if (vt) { vt.skipTransition(); vt = null; }
    html.classList.remove('vt-pick', 'vt-gold');
    if (how === 'instant' || still() || !doc.startViewTransition) { apply(id); return; }
    if (from) {
      const b = from.getBoundingClientRect();
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      html.style.setProperty('--vt-x', `${x}px`);
      html.style.setProperty('--vt-y', `${y}px`);
      html.style.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    }
    html.classList.add(how === 'gold' ? 'vt-gold' : 'vt-pick');
    let band = null;
    const t = doc.startViewTransition(() => {
      apply(id);
      if (how === 'gold') { band = doc.createElement('div'); band.className = 'gold-band'; band.setAttribute('aria-hidden', 'true'); doc.body.appendChild(band); }
    });
    vt = t;
    t.finished.finally(() => {
      if (band) band.remove();
      if (vt === t) { vt = null; html.classList.remove('vt-pick', 'vt-gold'); }
    });
  }

  // While a change runs, the browser shows pictures over the page and a click lands on <html>, not on the gem under
  // it, so the gem is found by where the click fell. The second click then finishes the first and wins.
  doc.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.swatch')
      || (vt && swatches.find((s) => { const r = s.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; }));
    if (b) go(b.dataset.accent, 'pick', b);
  });
  group.addEventListener('keydown', (e) => {
    const i = swatches.findIndex((b) => b.dataset.accent === current);
    const n = swatches.length;
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const b = swatches[(to + n) % n];
    b.focus();
    go(b.dataset.accent, 'pick', b);
  });

  // Back to gold. Under the tab panels (site.js's wipe) the change is hidden, so it is instant; otherwise the band
  // sweeps once the page has stopped moving, so the picture it animates is never a moving one.
  const covered = () => Boolean(doc.querySelector('.wipe.is-cover'));
  let wait = 0;
  const settle = () => { clearTimeout(wait); wait = setTimeout(home, 180); };
  function stopWaiting() { clearTimeout(wait); root.removeEventListener('scroll', settle); }
  function home() {
    stopWaiting();
    if (current !== 'gold') go('gold', covered() ? 'instant' : 'gold');
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting || current === 'gold') { stopWaiting(); return; }
    if (covered()) { home(); return; }
    root.addEventListener('scroll', settle, { passive: true });
    settle();
  }).observe(section);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden && current !== 'gold') { stopWaiting(); go('gold', 'instant'); } });
  root.addEventListener('pageshow', (e) => { if (e.persisted && current !== 'gold') go('gold', 'instant'); });
})(typeof window !== 'undefined' ? window : globalThis);
