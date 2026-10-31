/**
 * The calm notes on an open page: "Before you pay" and the pay pause, drawn by alarm.js in a closed shadow root. A page
 * the companion flags is not covered here: the worker takes the tab to the block page (src/block.html).
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

  // The worker flagged this page (background.js onNavigate). Kept only here, for as long as the page is open, so a
  // private window keeps nothing anywhere else.
  let flagged = false;

  // Before you pay: a shop's checkout whose address is young or unknown. A quiet note in the corner, never a block.
  let paid = false;
  function payNote(text) {
    if (paid) return;
    paid = true;
    globalThis.SentinelAlarm.show({
      small: true,
      accent: '#d6b25a',
      title: 'Before you pay',
      lead: text,
      buttons: [{ text: 'OK', kind: 'quiet', on: (ev, c) => c.close() }]
    });
  }

  // Pay pause: gift cards or crypto soon after a warning. The one thing to know, and one way to close it.
  let paused = false;
  function pauseNote() {
    if (paused || flagged) return;
    paused = true;
    globalThis.SentinelAlarm.show({
      small: true,
      accent: '#d6b25a',
      title: 'A moment before you pay',
      lead: 'No real company, government office or bank asks to be paid in gift cards or crypto. Once paid this way, the money is almost always gone.',
      steps: ['Is someone on the phone telling you to do this? Hang up. Then call your bank on the number on the back of your card.'],
      buttons: [{ text: 'I am buying this for myself', kind: 'go', on: (ev, c) => c.close() }],
      foot: 'Sentinel shows this because it warned you about a page in the last hour.'
    });
  }

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id === ext.runtime.id && msg && msg.type === 'sentinel:flagged') { flagged = true; return; }
    if (sender.id === ext.runtime.id && msg && msg.type === 'sentinel:paypause') {
      // Never over a page the companion is warning about: it says so, and the worker does not count the site as told.
      if (flagged) { sendResponse({ flagged: true }); return; }
      if (document.body) pauseNote();
      else document.addEventListener('DOMContentLoaded', pauseNote, { once: true });
      return;
    }
    if (sender.id === ext.runtime.id && msg && msg.type === 'sentinel:pay' && typeof msg.text === 'string') {
      const show = () => payNote(msg.text.slice(0, 300));
      if (document.body) show();
      else document.addEventListener('DOMContentLoaded', show, { once: true });
    }
  });
})();
