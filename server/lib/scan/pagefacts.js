/**
 * What a page's own shape says, read in the person's browser, for an address the companion already finds suspect
 * (on a free host, or scored 8 or more). Four yes-or-no facts and one brand name leave the browser, nothing else: no
 * page text, no field values, no title. The title is matched here, against the brand names Sentinel protects, and only
 * the matched name goes.
 *
 *   password   the page has a password box
 *   crossForm  a form holding a password box sends it to another site
 *   frame      the page is one frame the size of the window
 *   brand      the protected brand whose name the page title says, or null
 *
 * One file for both: the server keeps the original (checklist X03 judges the facts), the companion gets a copy in
 * extension/src/content (scripts/build-extension.js); tests/pagefacts.test.js checks the copy is the same.
 */
(function (root) {
  'use strict';

  // The words of a title, and neighbouring words joined ("One Drive" -> onedrive).
  function brandIn(title, tokens) {
    const w = String(title || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const set = new Set(w);
    for (let i = 0; i + 1 < w.length; i++) set.add(w[i] + w[i + 1]);
    return tokens.find((t) => set.has(t)) || null;
  }

  const PASSWORD = 'input[type="password"]';

  /** @param doc the page's document  @param view {w, h} the window's size  @param tokens the protected brand names */
  function read(doc, view, tokens) {
    const host = String(doc.location.hostname).toLowerCase();
    const away = (form) => {
      try {
        const h = new URL(form.action, doc.location.href).hostname.toLowerCase();
        return Boolean(h) && h !== host && !h.endsWith('.' + host) && !host.endsWith('.' + h);
      } catch { return false; }
    };
    const frames = [...doc.querySelectorAll('iframe')];
    const box = frames.length === 1 ? frames[0].getBoundingClientRect() : null;
    return {
      password: Boolean(doc.querySelector(PASSWORD)),
      crossForm: [...doc.querySelectorAll('form')].some((f) => f.querySelector(PASSWORD) && away(f)),
      frame: Boolean(box && box.width >= view.w * 0.9 && box.height >= view.h * 0.8),
      brand: brandIn(doc.title, tokens)
    };
  }

  const api = { read, brandIn };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SentinelPageFacts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
// The value the companion gets back from running this file in a page (nothing in tests, which have no page).
typeof SentinelPageFacts === 'object' && typeof document === 'object' ? SentinelPageFacts.read(document, { w: innerWidth, h: innerHeight }, globalThis.SentinelBrandTokens || []) : null;
