/**
 * "Did you type anything?" after a fake sign-in (the worker decides when; see "did you type anything?" in
 * background.js).
 *
 * On a page the companion flagged, this looks for a password box or a box made for a card number, by the box's type
 * and its own labels (autocomplete, name, id, placeholder, label): never what is in it. It tells the worker which kinds
 * it found. It runs in every frame, since a card box is often in a payment provider's frame; only the top page asks. Later, on another page, the worker may ask it to show one calm question in the corner: "Did you type a
 * password on that page?". Yes asks the worker to open the recovery guide; No closes it. Never while the page is full
 * screen (a game or a video): the question waits until it is not.
 */
(() => {
  'use strict';
  const CARD = /\bcc-(number|csc)\b|card.?(num|no\b)|credit.?card|debit.?card|\bcvv|\bcvc|security.?code|kartennummer|num[eé]ro de (la )?carte|n[uú]mero de (la )?tarjeta/i;

  /** Whether the document has a password box, and a box made for a card number. */
  function fields(doc) {
    let pw = false;
    let card = false;
    for (const el of doc.querySelectorAll('input')) {
      const type = String(el.type || '').toLowerCase();
      if (type === 'password') { pw = true; continue; }
      if (!/^(text|tel|number|)$/.test(type)) continue;
      const labels = [...(el.labels || [])].map((l) => l.textContent);
      if (CARD.test([el.autocomplete, el.name, el.id, el.placeholder, el.getAttribute('aria-label'), ...labels].join(' '))) card = true;
    }
    return { pw, card };
  }

  /** The question's words for what the page had: 'password', 'card' or 'password,card'. */
  function words(happened) {
    const ticks = String(happened || '').split(',');
    const pw = ticks.includes('password');
    const card = ticks.includes('card');
    return pw && card ? 'a password or card number' : card ? 'a card number' : 'a password';
  }

  if (typeof module === 'object' && module.exports) { module.exports = { fields, words, CARD }; return; }
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  const send = (msg) => Promise.resolve(ext.runtime.sendMessage(msg)).catch(() => null);

  // Watch for the boxes about once a second for two minutes (a sign-in form often appears after a moment). Told again
  // (a web app moved to another screen without loading), the two minutes start over.
  let timer = 0;
  let n = 0;
  let told = { pw: false, card: false };
  function look() {
    const f = fields(document);
    if ((f.pw && !told.pw) || (f.card && !told.card)) {
      told = { pw: told.pw || f.pw, card: told.card || f.card };
      send({ type: 'typed-fields', ...told });
    }
    if ((told.pw && told.card) || ++n >= 120) { clearInterval(timer); timer = 0; }
  }
  function watch() {
    n = 0;
    if (timer || (told.pw && told.card)) return;
    timer = setInterval(look, 1000);
    if (document.body) look(); else document.addEventListener('DOMContentLoaded', look, { once: true });
  }

  let asked = false;
  function ask(happened, site) {
    if (asked) return;
    asked = true;
    const show = () => {
      // Never over a full-screen page: wait until it is not.
      if (document.fullscreenElement) { document.addEventListener('fullscreenchange', show, { once: true }); return; }
      const what = words(happened);
      globalThis.SentinelAlarm.show({
        small: true,
        accent: '#d6b25a',
        title: `Did you type ${what} on that page?`,
        chip: site || '',
        lead: `Sentinel warned you about that page, and it asked for ${what}. If you typed one there, the recovery guide shows what to do now, most urgent first.`,
        buttons: [
          { text: 'Yes, I did', kind: 'go', on: (ev, c) => { c.close(); send({ type: 'typed-yes' }); } },
          { text: 'No', on: (ev, c) => { c.close(); send({ type: 'typed-no' }); } }
        ],
        foot: 'Sentinel never sees what you type.'
      });
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
  }

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== ext.runtime.id || !msg) return false;
    if (msg.type === 'sentinel:typed-watch') { watch(); return false; }
    if (msg.type === 'sentinel:typed-ask' && typeof msg.happened === 'string' && window === window.top) {
      ask(msg.happened.slice(0, 40), typeof msg.site === 'string' ? msg.site.slice(0, 200) : '');
      sendResponse({ shown: true });
    }
    return false;
  });
})();
