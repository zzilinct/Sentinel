/**
 * Pay pause by wording: run in a tab only when the worker asks (a page was warned about in the last hour, and this
 * site has not had the pause). Reads the page's title and its short visible headings, buttons and form labels (never
 * links, footers, navigation or anything typed) and checks them with paywords.js, loaded just before this. Only the
 * kind ('gift' or 'crypto') goes to the worker; the words stay in this page. A send dialog that opens later (the
 * address does not change) is seen as it opens, for ten minutes.
 */
(() => {
  'use strict';
  if (globalThis.__sentinelPayRead) return;
  globalThis.__sentinelPayRead = true;
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  const Words = globalThis.SentinelPayWords;
  if (!Words) return;

  const PICK = 'h1, h2, h3, [role="heading"], button, [role="button"], [role="tab"], label, legend, input, select, textarea, [role="dialog"][aria-label]';
  const SKIP = 'footer, nav, a, [role="contentinfo"], [role="navigation"], [aria-hidden="true"]';
  const LOOK_MS = 10 * 60 * 1000;

  function words() {
    const out = [];
    for (const el of document.querySelectorAll(PICK)) {
      if (out.length >= 400) break;
      if (el.closest(SKIP) || !el.getClientRects().length) continue;
      // Boxes: only what they are labelled with, never what is in them.
      const t = el.matches('input, select, textarea, [role="dialog"]')
        ? (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
        : (el.innerText || '');
      if (t && t.length <= 80) out.push(t);
    }
    return out;
  }

  let done = false;
  let timer = 0;
  let observer = null;
  function stop() { done = true; clearTimeout(timer); if (observer) observer.disconnect(); }
  function look() {
    timer = 0;
    if (done) return;
    const kind = Words.kind({ title: document.title, words: words() });
    if (!kind) return;
    stop();
    Promise.resolve(ext.runtime.sendMessage({ type: 'paywords', kind })).catch(() => {});
  }
  look();
  if (done) return;
  // Pages change under the reader (a dialog opening): looked at again at most once a second.
  observer = new MutationObserver(() => { if (!timer && !done) timer = setTimeout(look, 1000); });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setTimeout(stop, LOOK_MS);
})();
