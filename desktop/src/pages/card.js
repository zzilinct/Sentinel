'use strict';
/**
 * The one look of every desktop warning (warn.html, guard.html, filescan.html): a frameless card in Sentinel's black
 * and gold that springs out of the corner island (overlay.html .corner) the way the island opens, as tall as its
 * words, with no scrollbar inside at any length. Loaded in <head>, before the page draws: it brings the card's
 * styles, the keyboard (Escape, Tab kept inside the card) and the measure main.js sizes the window by.
 *
 * The window itself is transparent (main.js cardWindow); the card is the page's <body>, PAD px in from every edge so
 * its shadow has room. main.js CARD_PAD is the same number.
 */
(function () {
  const PAD = 14;
  const WIDTHS = [480, 560, 660];   // the card's widths, tried in turn until the words fit the screen's height

  const style = document.createElement('style');
  style.textContent = `
  :root { color-scheme: dark; --spring: linear(0, 0.063, 0.207, 0.382, 0.555, 0.706, 0.828, 0.918, 0.98, 1.018, 1.038, 1.046, 1.045, 1.039, 1.031, 1.023, 1.016, 1.009, 1); }
  html { height: 100%; margin: 0; padding: ${PAD}px; box-sizing: border-box; background: transparent; overflow: hidden; }
  body { height: 100%; margin: 0; box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr auto; padding: 22px 24px 20px; overflow: hidden;
    color: #e9e6df; font: var(--t-ui)/var(--lh-lead) var(--sans);
    background: radial-gradient(120% 90% at 100% 100%, color-mix(in srgb, var(--c, #d6b25a) 10%, transparent), transparent 62%), #0c0d10;
    border: 1px solid color-mix(in srgb, var(--c, #d6b25a) 42%, transparent); border-radius: 18px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05), 0 6px 12px rgba(0, 0, 0, .45); }
  /* The card is moved by its head, as a title bar would; its buttons stay buttons. */
  .head { display: flex; align-items: center; gap: 14px; -webkit-app-region: drag; }
  button, a { -webkit-app-region: no-drag; }
  .mark { width: 46px; height: 46px; flex: none; color: var(--c, #d6b25a); }
  .mark svg { display: block; width: 100%; height: 100%; }
  /* The title and address may wrap anywhere: a long address must not push the card wider than its window. */
  .head > div { min-width: 0; }
  h1 { margin: 0; font: 400 var(--t-title-s)/var(--lh-display) var(--display); color: var(--c, #d6b25a); }
  .host, .sub, .name { --track: 0px; margin: 2px 0 0; font: var(--t-note) var(--mono); color: #c9c5bb; overflow-wrap: anywhere; }
  .body { margin-top: 16px; min-height: 0; }
  .body p { margin: 0 0 10px; color: #b9b5ab; }
  .body b { color: #e9e6df; font-weight: 500; }
  ul { margin: 0 0 4px; padding-left: 18px; color: #c9c5bb; }
  ul:empty { display: none; }
  li { margin: 4px 0; overflow-wrap: anywhere; }
  li::marker { color: color-mix(in srgb, var(--c, #d6b25a) 70%, transparent); }
  small { display: block; margin-top: 12px; color: #8d8a82; font-size: var(--t-label); }
  .row { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; margin-top: 18px; }
  button { min-height: 38px; padding: 7px 16px; overflow-wrap: anywhere; border: 1px solid rgba(255, 255, 255, .06); border-radius: 11px; cursor: pointer; font: 500 var(--t-ui) var(--sans); color: #e9e6df; background: #1a1c21; }
  button:hover { background: #22252b; }
  button.primary { border-color: transparent; color: #16130b; background: linear-gradient(180deg, #efd79c 0%, #d6b066 48%, #b88e3d 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 14px 34px -14px rgba(212,174,99,.75); }
  button:focus-visible { outline: 2px solid #e2c47f; outline-offset: 2px; }
  [hidden] { display: none !important; }
  button[disabled] { opacity: .6; cursor: default; }
  button.quiet { margin-right: auto; padding: 0 2px; border: 0; background: none; color: #8d8a82; text-decoration: underline; text-underline-offset: 3px; }
  button.link { height: auto; padding: 0; border: 0; background: none; border-radius: 4px; color: #e2c47f; font: inherit; text-decoration: underline; text-underline-offset: 3px; }
  /* Opening: the card grows out of the island's 46 px mask in its bottom right corner with the island's own spring,
     then the mask pops and the words settle. Once per opening (a new warning loads the page again); nothing loops. */
  body { animation: card-open .62s var(--spring) both; }
  .mark { animation: card-pop .6s var(--spring) .08s both; }
  .head > div, .body, .row { animation: card-rise .5s cubic-bezier(.16, 1, .3, 1) both; }
  .head > div { animation-delay: .12s; }
  .body { animation-delay: .17s; }
  .row { animation-delay: .22s; }
  @keyframes card-open { from { clip-path: inset(calc(100% - 46px) 0 0 calc(100% - 46px) round 12px); } to { clip-path: inset(0 round 18px); } }
  @keyframes card-pop { from { opacity: 0; transform: scale(.55) rotate(-8deg); } }
  @keyframes card-rise { from { opacity: 0; transform: translateY(10px); } }
  @keyframes card-fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { body, .mark, .head > div, .body, .row { animation: card-fade .2s ease both; } }
  `;
  document.head.appendChild(style);

  const focusable = () => [...document.querySelectorAll('button, a[href]')].filter((x) => x.offsetParent && !x.disabled);
  document.addEventListener('keydown', (e) => {
    // Escape presses the button marked for it (the one that changes nothing). guard.html answers Escape itself.
    if (e.key === 'Escape' && !e.defaultPrevented) {
      const b = document.querySelector('[data-escape]');
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
    // Tab goes round the card's buttons, never out of it.
    if (e.key === 'Tab') {
      const all = focusable();
      if (!all.length) return;
      const i = all.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); all[all.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === all.length - 1)) { e.preventDefault(); all[0].focus(); }
    }
  });

  /**
   * The window's size for these words: the narrowest card whose words fit `room` px of height (the screen's work
   * area). When even the widest is too tall (a small screen at high scaling), the words a page marked data-trim
   * (the later reasons, a side note) are left out, last first, until it fits: they are all in the app behind "Open in
   * Sentinel". The card's height is its words' own, nothing scrolls inside it.
   */
  function measure(room) {
    const r = document.documentElement, b = document.body;
    const keep = [r.style.height, b.style.height, b.style.width];
    r.style.height = b.style.height = 'auto';
    for (const e of document.querySelectorAll('[data-trimmed]')) { e.hidden = false; e.removeAttribute('data-trimmed'); }
    const at = (w) => { b.style.width = `${w}px`; return { width: w + 2 * PAD, height: Math.ceil(b.getBoundingClientRect().height) + 2 * PAD }; };
    let size = null;
    for (const w of WIDTHS) {
      size = at(w);
      if (!(room > 0) || size.height <= room) break;
    }
    const trim = [...document.querySelectorAll('[data-trim]')].filter((e) => !e.hidden);
    while (room > 0 && size.height > room && trim.length) {
      const e = trim.pop();
      e.hidden = true;
      e.setAttribute('data-trimmed', '');
      size = at(WIDTHS[WIDTHS.length - 1]);
    }
    [r.style.height, b.style.height, b.style.width] = keep;
    return size;
  }

  /**
   * Anything cut off or scrolling inside the card (empty when it fits its words): for the end-to-end checks. Only a
   * box that clips (or scrolls) can hide words; whatever spills out of one that does not ends up in the card itself
   * (the body clips), and is found there.
   */
  function clipped() {
    const clips = (e) => e === document.documentElement || ['overflowX', 'overflowY'].some((k) => getComputedStyle(e)[k] !== 'visible');
    return [document.documentElement, document.body, ...document.body.querySelectorAll('*')]
      .filter((e) => e.clientHeight > 0 && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) && clips(e))
      .filter((e) => !(e.tagName === 'BUTTON' && getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollHeight <= e.clientHeight + 1))
      .map((e) => e.id || e.className || e.tagName.toLowerCase());
  }

  // New words in the same window (the shield's next step): the window is sized to them again.
  document.addEventListener('DOMContentLoaded', () => {
    let queued = false;
    new MutationObserver(() => {
      if (queued || !window.sentinelDesktop || !window.sentinelDesktop.cardFit) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; window.sentinelDesktop.cardFit().catch(() => {}); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  window.SentinelCard = { PAD, WIDTHS, measure, clipped };
})();
