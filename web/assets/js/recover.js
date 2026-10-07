/**
 * "I think I've been scammed": the person ticks what happened, and gets one ordered list of what to do, most urgent
 * first, with where to report it for their country. Everything stays in this browser: what was ticked and which steps
 * are done are kept in local storage (sentinel:recover) and never sent anywhere, so the page works on the static site
 * with no account. No phone numbers of our own: where a call is right, it is to the number on the person's card or the
 * company's own site, as in "What to do now" (ui.js).
 */
(() => {
  'use strict';

  // What can have happened. The ids are what is stored.
  const SITUATIONS = [
    { id: 'card', label: 'I gave my card details' },
    { id: 'bank', label: 'I sent money: a bank transfer, wire, Zelle, PayPal or Cash App' },
    { id: 'giftcard', label: 'I paid with gift cards' },
    { id: 'crypto', label: 'I sent crypto, or typed my wallet\'s recovery phrase' },
    { id: 'password', label: 'I typed a password into a site that was not real' },
    { id: 'code', label: 'I gave someone a sign-in code from a text or email' },
    { id: 'remote', label: 'I let someone connect to my computer' },
    { id: 'file', label: 'I opened a file or installed something they sent' },
    { id: 'identity', label: 'I gave my ID number (Social Security, National Insurance, SIN, TFN or passport)' }
  ];

  // The steps other places give too come from steps.js, so the shield, the results and this guide never disagree.
  const T = (typeof SentinelSteps !== 'undefined' ? SentinelSteps : require('./steps.js')).text;

  // when: 0 right now, 1 today, 2 this week. A step with no `for` is for everyone.
  const STEPS = [
    { id: 'stop', when: 0, text: 'Stop all contact. Do not reply, call back or pay anything more, whatever they say will happen.' },
    { id: 'offline', when: 0, for: ['remote', 'file'], text: T.offline },
    { id: 'remote-off', when: 0, for: ['remote'], text: T['remote-off'] },
    { id: 'card', when: 0, for: ['card'], text: 'Call the number on the back of your card. Say the details were stolen, ask them to block the card and send a new one, and ask about any payments you did not make.' },
    { id: 'bank', when: 0, for: ['bank'], text: 'Call your bank or payment app, using the number on your card or in the real app. Say you were scammed and ask them to stop or recall the payment. Call now: a payment is easier to stop before it settles.' },
    { id: 'giftcard', when: 0, for: ['giftcard'], text: 'Contact the company that issued the gift cards, using the number on the card or its own site. Give them the card numbers and ask them to freeze what is left. Keep the cards and receipts.' },
    { id: 'crypto-move', when: 0, for: ['crypto'], text: 'Gave a recovery phrase? Make a new wallet with a new phrase and move what is left there now. The old wallet is not safe any more.' },
    { id: 'crypto-revoke', when: 1, for: ['crypto'], text: 'Signed an approval on a site? Revoke it from your wallet. Sent crypto from an exchange? Report the transfer to that exchange through its own site.' },
    { id: 'password', when: 0, for: ['password', 'code'], text: T.password },
    { id: 'sessions', when: 1, for: ['password', 'code', 'remote'], text: 'In that account\'s security settings, sign out every other device, and remove any recovery email, phone number or mail forwarding you do not recognise.' },
    { id: 'twostep', when: 1, for: ['password', 'code'], text: T.twostep },
    { id: 'scan', when: 1, for: ['remote', 'file'], text: `${T.scan} Sentinel can check the file they sent too.` },
    { id: 'other-device', when: 1, for: ['remote', 'file'], text: T['other-device'] },
    { id: 'identity', when: 1, for: ['identity'], text: 'Ask for a fraud alert or a credit freeze, so nobody can open accounts or borrow in your name. Where to do that is in the reporting list below.' },
    { id: 'statements', when: 1, for: ['card', 'bank', 'identity'], text: 'Read your statements for the last few weeks and the next few months, and report anything you do not recognise.' },
    { id: 'notes', when: 1, text: 'Write down what happened while you remember it: dates, amounts, names, phone numbers, website addresses and how you paid. Keep screenshots, emails and receipts.' },
    { id: 'report', when: 2, text: 'Report it. It helps stop the same people reaching someone else, and your bank may ask for the report.' },
    { id: 'recovery-scam', when: 2, text: 'Watch for a second scam: anyone who offers to get your money back for a fee, or claims to be from the police or a bank and asks for more, is a scammer too.' },
    { id: 'talk', when: 2, text: 'Tell someone you trust. This is not your fault: scammers do this all day, and they are good at it.' }
  ];

  const WHEN = ['Right now', 'Today', 'This week'];

  // Official, free places to report, by country. Only addresses the services publish themselves.
  const REPORT = {
    us: { name: 'United States', places: [
      ['Report fraud to the FTC', 'https://reportfraud.ftc.gov/'],
      ['IdentityTheft.gov, if your identity or ID number was used', 'https://www.identitytheft.gov/'],
      ['FBI Internet Crime Complaint Center (IC3)', 'https://www.ic3.gov/'],
      ['Free credit freezes: start at the FTC\'s guide', 'https://consumer.ftc.gov/articles/what-know-about-credit-freezes-fraud-alerts']
    ] },
    uk: { name: 'United Kingdom', places: [
      ['Action Fraud (England, Wales and Northern Ireland)', 'https://www.actionfraud.police.uk/'],
      ['Police Scotland: call 101', 'https://www.scotland.police.uk/'],
      ['Forward scam texts to 7726, free', 'https://www.ncsc.gov.uk/collection/phishing-scams'],
      ['Cifas Protective Registration, if your identity was used', 'https://www.cifas.org.uk/pr']
    ] },
    ca: { name: 'Canada', places: [
      ['Canadian Anti-Fraud Centre', 'https://antifraudcentre-centreantifraude.ca/'],
      ['Your local police, for an incident number your bank may ask for', null]
    ] },
    au: { name: 'Australia', places: [
      ['Scamwatch', 'https://www.scamwatch.gov.au/'],
      ['ReportCyber, at the Australian Cyber Security Centre', 'https://www.cyber.gov.au/'],
      ['IDCARE, free help if your identity was used', 'https://www.idcare.org/']
    ] },
    other: { name: 'Somewhere else', places: [
      ['Your bank or card issuer, using the number on your card', null],
      ['Your local police, for a report your bank may ask for', null]
    ] }
  };

  /** The steps for what was ticked, in order of urgency, each once. */
  function plan(picked) {
    const set = new Set(picked || []);
    if (!set.size) return [];
    return STEPS.filter((s) => !s.for || s.for.some((id) => set.has(id)))
      .map((s, i) => ({ s, i })).sort((a, b) => a.s.when - b.s.when || a.i - b.i).map(({ s }) => s);
  }

  /** A first guess at the country, from the browser's language ("en-GB"). */
  function countryFor(lang) {
    const region = (/-([a-z]{2})\b/i.exec(String(lang || '')) || [])[1];
    const r = region ? region.toLowerCase() : '';
    if (r === 'gb') return 'uk';
    if (r) return REPORT[r] && r !== 'other' ? r : 'other';
    return /^en\b/i.test(String(lang || '')) ? 'us' : 'other';
  }

  if (typeof module === 'object' && module.exports) module.exports = { SITUATIONS, STEPS, REPORT, plan, countryFor };
  if (typeof document === 'undefined') return;

  const root = document.querySelector('[data-recover]');
  if (!root) return;
  const KEY = 'sentinel:recover';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  const state = {
    picked: Array.isArray(saved.picked) ? saved.picked : [],
    done: Array.isArray(saved.done) ? saved.done : [],
    country: REPORT[saved.country] ? saved.country : countryFor(navigator.language)
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private window: still works, just not remembered */ } };

  const picks = root.querySelector('[data-recover-picks]');
  const out = root.querySelector('[data-recover-plan]');
  const country = root.querySelector('[data-recover-country]');

  picks.innerHTML = SITUATIONS.map((s) => `<label class="recover__pick"><input type="checkbox" value="${s.id}"${state.picked.includes(s.id) ? ' checked' : ''}><span>${esc(s.label)}</span></label>`).join('');
  country.innerHTML = Object.entries(REPORT).map(([id, c]) => `<option value="${id}"${id === state.country ? ' selected' : ''}>${esc(c.name)}</option>`).join('');

  function draw() {
    const steps = plan(state.picked);
    if (!steps.length) {
      out.innerHTML = '<p class="recover__empty">Tick what happened above, and your steps appear here, most urgent first.</p>';
      return;
    }
    const done = steps.filter((s) => state.done.includes(s.id)).length;
    const groups = WHEN.map((title, w) => {
      const items = steps.filter((s) => s.when === w);
      if (!items.length) return '';
      return `<h3>${title}</h3><ol class="recover__steps">${items.map((s) => `<li><label><input type="checkbox" data-step="${s.id}"${state.done.includes(s.id) ? ' checked' : ''}><span>${esc(s.text)}</span></label>${s.id === 'report' ? reportList() : ''}</li>`).join('')}</ol>`;
    }).join('');
    out.innerHTML = `<p class="recover__progress" aria-live="polite">${done} of ${steps.length} done</p>${groups}`;
  }

  function reportList() {
    const c = REPORT[state.country];
    return `<ul class="recover__report">${c.places.map(([label, url]) => `<li>${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label)}</li>`).join('')}</ul>`;
  }

  picks.addEventListener('change', () => {
    state.picked = [...picks.querySelectorAll('input:checked')].map((i) => i.value);
    save(); draw();
  });
  out.addEventListener('change', (ev) => {
    const id = ev.target.dataset && ev.target.dataset.step;
    if (!id) return;
    state.done = ev.target.checked ? [...new Set([...state.done, id])] : state.done.filter((d) => d !== id);
    save(); draw();
  });
  country.addEventListener('change', () => { state.country = country.value; save(); draw(); });
  root.querySelector('[data-recover-print]').addEventListener('click', () => window.print());
  root.querySelector('[data-recover-reset]').addEventListener('click', () => {
    state.picked = []; state.done = [];
    try { localStorage.removeItem(KEY); } catch { /* nothing kept */ }
    picks.querySelectorAll('input').forEach((i) => { i.checked = false; });
    draw();
  });
  draw();
})();
