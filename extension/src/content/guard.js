/**
 * What the companion says over an open page, drawn by alarm.js in a closed shadow root: "Before you pay", the pay pause,
 * and the warning over a page the scanner calls a likely threat after it opened. A confirmed one is not covered here:
 * the worker takes the tab to the block page (src/block.html). A likely one is a guess, so the page stays as it is,
 * with whatever was typed in it, and Continue anyway only takes the warning away.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

  // The worker flagged this page (background.js onNavigate). Kept only here, for as long as the page is open, so a
  // private window keeps nothing anywhere else.
  let flagged = false;

  // The worker's words (lib/say.js, the block page's own), drawn once per page.
  let warned = false;
  function warn(msg) {
    if (warned) return;
    warned = true;
    flagged = true;
    const said = msg.said;
    const send = (m) => Promise.resolve(ext.runtime.sendMessage(m)).catch(() => null);
    const mask = /^(onyx|(scam|virus|malware)-(red|orange|yellow))$/.test(String(said.mask)) ? said.mask : 'scam-orange';
    globalThis.SentinelAlarm.show({
      accent: '#f08a24',
      mask: ext.runtime.getURL(`src/masks/${mask}.webp`),
      title: said.title,
      chip: msg.host,
      lead: said.line,
      steps: said.reason ? [said.reason] : [],
      buttons: [{ text: said.action.text, kind: 'go', on: () => (said.action.kind === 'real' ? send({ type: 'real-site' }) : globalThis.SentinelAlarm.leave()) }],
      fold: {
        summary: 'Why Sentinel warned you',
        link: msg.recover ? { href: msg.recover, text: 'Already typed something there? Open the recovery guide' } : null,
        buttons: [{ text: 'Continue anyway', kind: 'quiet', on: (ev, ctl) => { ctl.close(); send({ type: 'warn-pass' }); } }]
      }
    });
  }

  // Before you pay: a shop's checkout whose address is young or unknown. A quiet note in the corner, never a block.
  let paid = false;
  function payNote(text) {
    if (paid) return;
    paid = true;
    globalThis.SentinelAlarm.show({
      small: true,
      accent: 'calm',
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
      accent: 'calm',
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
      return;
    }
    if (sender.id === ext.runtime.id && msg && msg.type === 'sentinel:warn' && msg.said && typeof msg.said.title === 'string') {
      if (document.documentElement) warn(msg);
      else document.addEventListener('DOMContentLoaded', () => warn(msg), { once: true });
    }
  });
})();
