/**
 * "Is this call a scam?": while someone is on the phone, they say who called who, who the caller claims to be and what
 * the caller wants, and the answer changes at once. A checklist can prove danger but never safety: nobody can see who
 * is on the line, so there is no "fine" here. There are three answers, and the page opens on one of them, because
 * "give them nothing yet" is true of every call before anything is known. Worked out here in the page (app.js,
 * /app/call); nothing ticked is sent anywhere or kept.
 *
 *   SentinelCallCheck.judge({ rang, who, asks }) -> { verdict: 'hangup' | 'callback' | 'hold', big, reason, next, happened }
 */
(() => {
  'use strict';

  // Who started the call. Only a number the person chose themselves says anything good about the call.
  const RANG = [
    { id: 'them', label: 'They called me' },
    { id: 'link', label: 'I called a number from a text, email, pop-up or ad' },
    { id: 'self', label: 'I called a number from my card, a letter or their own site' }
  ];

  // Who the caller says they are. `doubt` is why a call out of the blue from them is itself the warning; without one,
  // an unexpected call from them can be ordinary. `next` is what to do, and decides the words after any "Hang up".
  const WHO = [
    { id: 'bank', label: 'Your bank', doubt: 'Anyone can say they are your bank, and the name on your screen can be faked.', next: 'Hang up, then call your bank on the number on the back of your card.' },
    { id: 'police', label: 'The police', doubt: 'Anyone can say they are the police, and a real officer will let you check.', next: 'Hang up. If you are worried, call your local police yourself on their non-emergency number.' },
    { id: 'tax', label: 'The tax office', doubt: 'Anyone can say they are the tax office, and a real one will let you check.', next: 'Hang up, then call the tax office on the number on its own website or on a letter you already have.' },
    { id: 'microsoft', label: 'Tech support', next: 'Hang up. Do not install anything they ask for, and do not call a number they gave you.' },
    { id: 'family', label: 'Family', doubt: 'A voice and a number can both be copied, and a real relative will not mind.', next: 'Hang up, then call them back on the number you already have for them.' },
    { id: 'delivery', label: 'A delivery company', ordinary: 'A real driver may call about a door or a time. A driver never needs a code or a payment.', next: 'Hang up, then check your parcel on the delivery company\'s own website or app.', calm: 'Check your parcel on the delivery company\'s own website or app, not through a link they send.' },
    { id: 'other', label: 'Someone else' }
  ];

  // What the caller asks for or says. Each one on its own is reason to hang up; the first ticked, in this order, gives
  // the reason. `happened` is what to tick in the recovery guide if it was already done. `yours` marks what can be
  // ordinary on a call the person started themselves, to a number they found.
  const ASKS = [
    { id: 'remote', label: 'Install an app or get onto your device', reason: 'They want to get onto your computer or phone. A real company never calls you to do that.', happened: 'remote' },
    { id: 'code', label: 'Read out a code sent to your phone', reason: 'They want the code sent to your phone. That code is the key to your account, and nobody real ever asks for it.', happened: 'code' },
    { id: 'pin', label: 'Your PIN or password', reason: 'They want your PIN or password. Nobody real ever needs it, not even your bank.', happened: 'password' },
    { id: 'safeaccount', label: 'Move money to a "safe account"', reason: 'They want your money moved to a "safe account". There is no such thing: that account is theirs.', happened: 'bank' },
    { id: 'giftcards', label: 'Pay with gift cards', reason: 'They want to be paid in gift cards. No bank, company or office takes gift cards as payment.', happened: 'giftcard' },
    { id: 'crypto', label: 'Pay in crypto or at a Bitcoin machine', reason: 'They want crypto. Once it is sent it cannot be taken back, which is why scammers ask for it.', happened: 'crypto' },
    { id: 'refund', label: 'Pay back a refund that went wrong', reason: 'A refund that "went wrong" is a known trick: the extra money was never sent, it is your own money moved around.', happened: 'bank' },
    { id: 'card', label: 'Your card number or bank details', reason: 'They want your card or bank details. Give those only on a call you started, to a number you found.', happened: 'card', yours: true },
    { id: 'arrest', label: 'You will be arrested, fined or sued', reason: 'They are threatening you. Real police and tax offices do not call to demand payment or threaten arrest.' },
    { id: 'secret', label: 'Keep this secret from bank or family', reason: 'They told you to keep it secret. Only scammers need you not to ask anyone.' },
    { id: 'hurry', label: 'Hurry, or do not hang up', reason: 'They are rushing you and keeping you on the line, so you cannot check. A real caller will let you call back.', yours: true }
  ];
  const NEXT = 'Hang up. If it might be real, call back on a number you find yourself, never one the caller gave you.';

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
    const next = w && w.next ? w.next : NEXT;
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
    if (rang === 'link') return { verdict: 'callback', big: CALL_BACK, reason: 'That number came from the message, so it may reach whoever sent it.', next: w && w.next ? w.next : 'Hang up. Find the number yourself, on your card, a letter or their own website.', happened };
    // Microsoft does not call people about their computer, whatever else is said.
    if (who === 'microsoft') return { verdict: 'hangup', big: HANG_UP, reason: 'Microsoft and other tech companies never call you out of the blue about your computer.', next, happened };
    if (w && w.doubt) return { verdict: 'callback', big: CALL_BACK, reason: `A call you did not expect proves nothing. ${w.doubt}`, next, happened };
    if (w && w.ordinary) return { verdict: 'hold', big: HOLD, reason: w.ordinary, next: w.calm, happened };
    if (rang || w) return { verdict: 'hold', big: HOLD, reason: 'You cannot see who is really calling. Tick what they ask for and this answer changes.', next: 'You are allowed to hang up and call back on a number you find. A real caller will not mind.', happened };
    return { verdict: 'hold', big: HOLD, reason: 'Anyone can fake a name or a number on a call. Tick what you hear and this answer changes.', next: 'You are allowed to hang up. A real caller will not mind.', happened };
  }

  const api = { RANG, WHO, ASKS, judge };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.SentinelCallCheck = api;
})();
