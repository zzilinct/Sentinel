/**
 * "Is this call a scam?": while someone is on the phone, they tick what the caller is asking for and who the caller
 * says they are, and get one answer at once: hang up, or it is probably fine, with the one reason that decides it and
 * what to do next. Worked out here in the page (app.js, /app/call); nothing ticked is sent anywhere or kept.
 *
 *   SentinelCallCheck.judge(asks, who) -> null | { verdict: 'hangup' | 'fine', reason, next, happened }
 */
(() => {
  'use strict';

  // What the caller asks for or says. Each one on its own is reason to hang up; the first ticked, in this order,
  // gives the reason. `happened` is what to tick in the recovery guide if it was already done.
  const ASKS = [
    { id: 'remote', label: 'Install an app or let them onto your computer or phone', reason: 'They want to get onto your computer. A real company never calls you to do that.', happened: 'remote' },
    { id: 'code', label: 'Read out a code sent to your phone', reason: 'They want the code sent to your phone. That code is the key to your account, and nobody real ever asks for it.', happened: 'code' },
    { id: 'safeaccount', label: 'Move your money to a "safe account"', reason: 'They want your money moved to a "safe account". There is no such thing: that account is theirs.', happened: 'bank' },
    { id: 'giftcards', label: 'Pay with gift cards', reason: 'They want to be paid in gift cards. No bank, company or office takes gift cards as payment.', happened: 'giftcard' },
    { id: 'crypto', label: 'Pay in crypto or at a Bitcoin machine', reason: 'They want crypto. Once it is sent it cannot be taken back, which is why scammers ask for it.', happened: 'crypto' },
    { id: 'refund', label: 'A refund went wrong and you must pay back the extra', reason: 'A refund that "went wrong" is a known trick: the extra money was never sent, it is your own money moved around.', happened: 'bank' },
    { id: 'arrest', label: 'You will be arrested, fined or sued', reason: 'They are threatening you. Real police and tax offices do not call to demand payment or threaten arrest.' },
    { id: 'secret', label: 'Keep this secret, even from your bank or family', reason: 'They told you to keep it secret. Only scammers need you not to ask anyone.' }
  ];

  // Who the caller says they are: this decides what to do next.
  const WHO = [
    { id: 'bank', label: 'Your bank', next: 'Hang up, then call your bank on the number on the back of your card.' },
    { id: 'microsoft', label: 'Microsoft or tech support', next: 'Hang up. Do not install anything they ask for, and do not call a number they gave you.' },
    { id: 'police', label: 'The police', next: 'Hang up. If you are worried, call your local police yourself on their non-emergency number.' },
    { id: 'tax', label: 'The tax office', next: 'Hang up, then call the tax office on the number on its own website or on a letter you already have.' },
    { id: 'family', label: 'A grandchild or family member', next: 'Hang up, then call them back on the number you already have for them.' },
    { id: 'delivery', label: 'A delivery company', next: 'Hang up, then check your parcel on the delivery company\'s own website or app.' }
  ];
  const NEXT = 'Hang up. If it might be real, call back on a number you find yourself, never one the caller gave you.';

  // Said with who they claim to be, some asks have a sharper reason.
  const SHARPER = {
    'code:bank': 'Your bank never asks for a code it sent you. Whoever asks for it is trying to get into your account.',
    'safeaccount:bank': 'Your bank never asks you to move money to keep it safe. The "safe account" is the scammer\'s.',
    'safeaccount:police': 'The police never ask you to move money. The "safe account" is the scammer\'s.',
    'giftcards:tax': 'No tax office takes gift cards. Only scammers ask for them.',
    'arrest:tax': 'A real tax office writes to you first and never threatens arrest on the phone.',
    'remote:bank': 'Your bank never asks to get onto your computer.',
    'secret:family': 'A real family member in trouble would not mind you checking with the family. Scammers do.'
  };

  function judge(asks = [], who = []) {
    const a = ASKS.filter((x) => asks.includes(x.id));
    const w = WHO.filter((x) => who.includes(x.id));
    if (!a.length && !w.length) return null;
    const next = w.length ? w[0].next : NEXT;
    const happened = [...new Set(a.map((x) => x.happened).filter(Boolean))];
    if (a.length) {
      const sharp = w.map((x) => SHARPER[`${a[0].id}:${x.id}`]).find(Boolean);
      return { verdict: 'hangup', reason: sharp || a[0].reason, next, happened };
    }
    // Microsoft does not call people about their computer, whatever else is said.
    if (who.includes('microsoft')) return { verdict: 'hangup', reason: 'Microsoft and other tech companies never call you out of the blue about your computer.', next: WHO.find((x) => x.id === 'microsoft').next, happened };
    return {
      verdict: 'fine',
      reason: 'Nothing they have said so far is a scam sign. If they ask for any of the things above, tick it, and hang up.',
      next: `Still unsure? ${next} A real caller will not mind.`,
      happened
    };
  }

  const api = { ASKS, WHO, judge };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.SentinelCallCheck = api;
})();
