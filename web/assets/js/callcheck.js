/**
 * "Is this call a scam?" (/call): open to anyone, with no account, because a person on the phone with a scammer cannot
 * stop to sign in. They say who called who, who the caller claims to be and what they hear, and the answer changes at
 * once. A checklist can prove danger but never safety: nobody can see who is on the line, so there is no "fine" here.
 * There are three answers, and the page opens on one of them, because "give them nothing yet" is true of every call
 * before anything is known. Worked out here in the page. Ticks stay in this tab (sessionStorage), so going to the
 * recovery guide and back loses nothing, and leave with it; nothing is sent.
 *
 *   judge({ rang, who, asks }) -> { verdict: 'hangup' | 'callback' | 'hold', big, reason, next, happened }
 */
(() => {
  'use strict';

  // Who started the call. Only a number the person chose themselves says anything good about the call.
  const RANG = [
    { id: 'them', label: 'They called me' },
    { id: 'link', label: 'I called a number from a text or ad' },
    { id: 'self', label: 'I called the number on my card or letter' }
  ];

  // Who the caller says they are. `doubt` is why a call out of the blue from them is itself the warning. `call` is
  // who to call back, once it is safe to: a scammer can keep a landline connected after you put the phone down.
  const callBack = (who) => `Hang up. They can hold the line open, so wait a few minutes or use another phone. Then ${who}.`;
  const WHO = [
    { id: 'bank', label: 'Your bank', doubt: 'Anyone can say they are your bank, and the name on your screen can be faked.', call: 'call the number on the back of your card' },
    { id: 'police', label: 'The police', doubt: 'Anyone can say they are the police, and a real officer will let you check.', call: 'call your local police on their non-emergency number' },
    { id: 'tax', label: 'The tax office', doubt: 'Anyone can say they are the tax office, and a real one will let you check.', call: 'call the number on its website or a letter' },
    { id: 'microsoft', label: 'Tech support', next: 'Hang up. Do not install anything they ask for, and do not call a number they gave you.' },
    { id: 'family', label: 'Family', doubt: 'A voice and a number can both be copied, and a real relative will not mind.', call: 'call them on the number you already have' },
    { id: 'delivery', label: 'Delivery', ordinary: 'A real driver may call about a door or a time. A driver never needs a code or a payment.', next: 'Hang up, then check your parcel on the company\'s own site or app.', calm: 'Check your parcel on the company\'s own site or app, not through a link they send.' },
    { id: 'other', label: 'Someone else' }
  ];

  // What the caller asks for or says, in the fewest words that are still clear. Each one on its own is reason to hang
  // up; the first ticked, in this order, gives the reason. `happened` is what to tick in the recovery guide if it was
  // already done. `yours` marks what can be ordinary on a call the person started themselves, to a number they found.
  const ASKS = [
    { id: 'remote', label: 'Install an app', reason: 'They want to get onto your computer or phone. A real company never calls you to do that.', happened: 'remote' },
    { id: 'code', label: 'A code from a text', reason: 'They want the code sent to your phone. That code is the key to your account, and nobody real ever asks for it.', happened: 'code' },
    { id: 'pin', label: 'PIN or password', reason: 'They want your PIN or password. Nobody real ever needs it, not even your bank.', happened: 'password' },
    { id: 'safeaccount', label: 'A "safe account"', reason: 'They want your money moved to a "safe account". There is no such thing: that account is theirs.', happened: 'bank' },
    { id: 'giftcards', label: 'Gift cards', reason: 'They want to be paid in gift cards. No bank, company or office takes gift cards as payment.', happened: 'giftcard' },
    { id: 'crypto', label: 'Crypto or Bitcoin', reason: 'They want crypto. Once it is sent it cannot be taken back, which is why scammers ask for it.', happened: 'crypto' },
    { id: 'refund', label: 'Pay back a refund', reason: 'A refund that "went wrong" is a known trick: the extra money was never sent, it is your own money moved around.', happened: 'bank' },
    { id: 'card', label: 'Card or bank details', reason: 'They want your card or bank details. Give those only on a call you started, to a number you found.', happened: 'card', yours: true },
    { id: 'arrest', label: 'Arrest or a fine', reason: 'They are threatening you. Real police and tax offices do not call to demand payment or threaten arrest.' },
    { id: 'secret', label: 'Keep it secret', reason: 'They told you to keep it secret. Only scammers need you not to ask anyone.' },
    { id: 'hurry', label: 'Hurry, stay on the line', reason: 'They are rushing you and keeping you on the line, so you cannot check. A real caller will let you call back.', yours: true }
  ];
  const NEXT = callBack('call a number you find yourself, never one they gave you');

  // Said with who they claim to be, some asks have a sharper reason.
  const SHARPER = {
    'code:bank': 'Your bank never asks for a code it sent you. Whoever asks for it is trying to get into your account.',
    'pin:bank': 'Your bank never asks for your PIN or password. Whoever asks for it is trying to get into your account.',
    'safeaccount:bank': 'Your bank never asks you to move money to keep it safe. The "safe account" is the scammer\'s.',
    'safeaccount:police': 'The police never ask you to move money. The "safe account" is the scammer\'s.',
    'giftcards:tax': 'No tax office takes gift cards. Only scammers ask for them.',
    'arrest:tax': 'A real tax office writes to you first and never threatens arrest on the phone.',
    'remote:bank': 'Your bank never asks to get onto your computer.',
    'secret:family': 'A real family member in trouble would not mind you checking with the family. Scammers do.'
  };

  const HANG_UP = 'Hang up now.';
  const CALL_BACK = 'Hang up and call back.';
  const HOLD = 'Give them nothing yet.';

  function judge({ rang, who, asks = [] } = {}) {
    const self = rang === 'self';
    const w = WHO.find((x) => x.id === who);
    const a = ASKS.filter((x) => asks.includes(x.id) && !(self && x.yours));
    const next = !w ? NEXT : w.next || (w.call ? callBack(w.call) : NEXT);
    const happened = [...new Set(a.map((x) => x.happened).filter(Boolean))];

    if (a.length) return { verdict: 'hangup', big: HANG_UP, reason: (w && SHARPER[`${a[0].id}:${w.id}`]) || a[0].reason, next, happened };
    if (self) {
      return {
        verdict: 'hold',
        big: 'You chose the number.',
        reason: 'That is the safer way round, but Sentinel cannot see who is on the line.',
        next: 'Give card details only for something you chose to pay for. Never read out a code or your PIN.',
        happened
      };
    }
    if (rang === 'link') return { verdict: 'callback', big: CALL_BACK, reason: 'That number came from the message, so it may reach whoever sent it.', next, happened };
    // Microsoft does not call people about their computer, whatever else is said.
    if (who === 'microsoft') return { verdict: 'hangup', big: HANG_UP, reason: 'Microsoft and other tech companies never call you out of the blue about your computer.', next, happened };
    if (w && w.doubt) return { verdict: 'callback', big: CALL_BACK, reason: `A call you did not expect proves nothing. ${w.doubt}`, next, happened };
    if (w && w.ordinary) return { verdict: 'hold', big: HOLD, reason: w.ordinary, next: w.calm, happened };
    if (rang || w) return { verdict: 'hold', big: HOLD, reason: 'You cannot see who is really calling. Tick what you hear and this answer changes.', next: 'You are allowed to hang up and call back on a number you find. A real caller will not mind.', happened };
    return { verdict: 'hold', big: HOLD, reason: 'Anyone can fake a name or a number on a call. Tick what you hear and this answer changes.', next: 'You are allowed to hang up. A real caller will not mind.', happened };
  }

  const KEY = 'sentinel:call';
  const SEAL = { hangup: 'red', callback: 'orange', hold: 'yellow' };
  const SPRING = { duration: 460, easing: 'cubic-bezier(.3, 1.18, .5, 1)' };

  function mount(root) {
    const group = (heading, name, type, list, kind) => `
      <fieldset class="call__group">
        <legend><h2>${heading}</h2></legend>
        <div class="call__picks call__picks--${kind}">${list.map((x) => `<label class="call__pick"><input type="${type}" name="${name}" value="${x.id}"><i class="call__tick call__tick--${type}" aria-hidden="true"></i><span>${x.label}</span></label>`).join('')}</div>
      </fieldset>`;
    root.innerHTML = `
      <div class="call__answer" data-call-answer aria-live="polite" aria-atomic="true">
        <i class="call__plate"></i>
        <div class="call__body">
          <span class="call__mark"></span>
          <p class="call__verdict"></p>
          <p class="call__reason"></p>
          <p class="call__next"></p>
          <p class="call__more" hidden>Already did it? <a href="/recover">Open the recovery guide</a>.</p>
        </div>
      </div>
      <div class="call__asks">
        ${group('Who called who?', 'rang', 'radio', RANG, 'list')}
        ${group('Who do they say they are?', 'who', 'radio', WHO, 'chips')}
        ${group('What do you hear?', 'ask', 'checkbox', ASKS, 'chips')}
        <button type="reset" class="btn btn--ghost btn--sm">Start over</button>
      </div>`;
    const out = root.querySelector('[data-call-answer]');
    const plate = out.querySelector('.call__plate');
    const body = out.querySelector('.call__body');
    const put = (sel, text) => { const n = out.querySelector(sel); if (n.textContent !== text) n.textContent = text; };

    const draw = () => {
      const ticked = new FormData(root);
      const asks = ticked.getAll('ask');
      const r = judge({ rang: ticked.get('rang'), who: ticked.get('who'), asks });
      try { sessionStorage.setItem(KEY, JSON.stringify({ rang: ticked.get('rang'), who: ticked.get('who'), asks })); } catch { /* a private window: still works, just not remembered */ }
      const was = out.dataset.verdict;
      const from = plate.offsetHeight;      // mid-spring when pressed twice: the next spring starts from where it is
      const before = out.offsetHeight;
      out.dataset.verdict = r.verdict;
      // In the Windows app, only that the answer became "Hang up" goes to the app (an hour's pay pause sign, paypause.js).
      if (r.verdict === 'hangup' && was && was !== 'hangup' && window.sentinelDesktop && window.sentinelDesktop.callHangUp) window.sentinelDesktop.callHangUp().catch(() => {});
      if (r.verdict !== was) out.querySelector('.call__mark').innerHTML = window.SentinelMasks.mark('scam', SEAL[r.verdict]);
      put('.call__verdict', r.big);
      put('.call__reason', r.reason);
      put('.call__next', r.next);
      const more = out.querySelector('.call__more');
      more.hidden = !r.happened.length;
      if (r.happened.length) more.querySelector('a').setAttribute('href', `/recover?happened=${r.happened.join(',')}`);
      if (!was) return;
      const to = out.offsetHeight;
      // The answer sits above the boxes on a phone: when it changes height, the box under the finger stays where it is.
      if (to !== before && matchMedia('(max-width: 999px)').matches && scrollY > 0 && out.getBoundingClientRect().top < 40) scrollBy({ top: to - before, behavior: 'instant' });
      if (to === from || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      // The plate behind the words springs to the new height, both ways. Only it moves, so nothing else is laid out again.
      for (const a of [...plate.getAnimations(), ...body.getAnimations()]) a.cancel();
      plate.animate({ height: [`${from}px`, `${to}px`] }, SPRING);
      if (to > from) body.animate({ clipPath: [`inset(0 0 ${to - from}px 0)`, 'inset(0 0 -24px 0)'] }, SPRING);
    };

    let kept = {};
    try { kept = JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { /* nothing kept */ }
    for (const input of root.querySelectorAll('input')) {
      input.checked = input.name === 'ask' ? (kept.asks || []).includes(input.value) : kept[input.name] === input.value;
    }
    root.addEventListener('change', draw);
    root.addEventListener('reset', () => setTimeout(draw));
    root.addEventListener('submit', (ev) => ev.preventDefault());
    draw();
  }

  if (typeof module === 'object' && module.exports) module.exports = { RANG, WHO, ASKS, judge };
  else mount(document.querySelector('[data-call]'));
})();
