/**
 * Spot the scam, a practice inbox (practice.html). Twelve made-up messages, some scams and some real; the person
 * sorts each one, then sees the clues marked where they are in the message. Nothing is stored or sent: the answers
 * live in this page until it is closed, so it works on the static site with no account.
 *
 * Every message was written for this page. Brands appear only as a scam would name them; the real messages come
 * from made-up places. Phone numbers are from the ranges kept for drama (UK 07700 900xxx, US 555-01xx).
 *
 * A clue is marked in the text as {{key:the words}}, and explained in `clues[key]`.
 */
(() => {
  'use strict';

  const MESSAGES = [
    {
      id: 'parcel', kind: 'text', scam: true,
      from: '{{number:+44 7700 900412}}',
      body: 'Royal Mail: your parcel is held at our depot because of an {{fee:unpaid shipping fee of £1.45}}. {{rush:Pay within 12 hours}} or it will be returned to the sender: {{link:royalmail-redelivery-uk.top/pay}}',
      clues: {
        number: { label: 'An ordinary mobile number', why: 'A delivery company texts from its own short name or number, not a personal mobile.' },
        fee: { label: 'A tiny fee', why: 'The amount is small so you pay without thinking. What they want is your card number.' },
        rush: { label: 'A deadline', why: 'A countdown is there to stop you checking first.' },
        link: { label: 'Not the company\'s address', why: 'The name is in there, but the address really belongs to royalmail-redelivery-uk.top, a site anyone could buy.' }
      }
    },
    {
      id: 'library', kind: 'email', scam: false,
      from: 'Northfield Library', address: '{{sender:notices@northfieldlibrary.org}}',
      subject: 'Two books due on Friday',
      body: 'Hello Sam,\nTwo books on your card are due back on Friday 17 October. {{own:You can renew them in the library app or at the front desk}}.\n{{nothing:There is nothing to pay.}}\nNorthfield Library',
      clues: {
        sender: { label: 'The address matches the name', why: 'The sender\'s address is the library\'s own, the same as on every earlier reminder.' },
        own: { label: 'It sends you to places you already use', why: 'No link to tap: it points to the app and the desk you know.' },
        nothing: { label: 'Nothing is asked of you', why: 'No payment, no password, no hurry beyond a normal due date.' }
      }
    },
    {
      id: 'signin', kind: 'email', scam: true,
      from: 'Microsoft Account Team', address: '{{sender:security-alert@msft-account-verify.com}}',
      subject: 'Unusual sign-in activity',
      body: 'We detected a sign-in to your account from a new device.\n{{threat:Your account will be closed in 24 hours}} unless you confirm it is yours.\n[ {{button:Verify now}} ]\nThe button opens {{link:login-microsoftonline.account-check.ru}}',
      clues: {
        sender: { label: 'The sender is not the company', why: 'The name says Microsoft, but the address belongs to msft-account-verify.com.' },
        threat: { label: 'A threat with a deadline', why: 'Real companies do not close your account in a day for one sign-in.' },
        button: { label: 'A button to sign in', why: 'A real alert says to open the app or type the address yourself. A button is how they get your password.' },
        link: { label: 'The button\'s real address', why: 'What matters is the end of the address: account-check.ru. That is not Microsoft.' }
      }
    },
    {
      id: 'code', kind: 'text', scam: false,
      context: 'You have just asked to sign in to your energy account.',
      from: '{{short:Brightwater}}',
      body: 'Your Brightwater sign-in code is 482913. {{never:We will never call you to ask for it.}} If you did not ask for this code, you can ignore this text.',
      clues: {
        short: { label: 'Sent from the company\'s name', why: 'The text comes from the same sender name as the codes before it.' },
        never: { label: 'It tells you to keep the code', why: 'It came because you asked for it, and nobody else needs it. A code you did not ask for is the one to worry about.' }
      }
    },
    {
      id: 'reported', kind: 'dm', scam: true,
      from: 'jayden', address: '@jaydenplays_',
      body: 'hey sorry i think i {{story:accidentally reported your account}}, it says it is flagged now\n{{staff:talk to the Discord staff, their name is @Discord Safety Team}}, they can fix it\n{{rush:add them quick before your account gets banned}}',
      clues: {
        story: { label: 'A made-up problem', why: 'Reports do not work like this, and nobody can get you banned by mistake in one click.' },
        staff: { label: 'Staff in a direct message', why: 'Discord staff do not message you to sort out reports. This "staff" account is the scammer, and will ask for your password or a code.' },
        rush: { label: 'Hurry', why: 'The rush is there so you do not stop and ask someone.' }
      }
    },
    {
      id: 'giftcards', kind: 'email', scam: true,
      from: 'Dana Whitlock, Director', address: '{{sender:dana.whitlock.office@gmail.com}}',
      subject: 'Quick favour',
      body: 'Are you at your desk? {{busy:I am in meetings all day and cannot take calls.}}\nI need you to {{cards:buy five $100 Apple gift cards for client gifts, scratch them and send me photos of the codes}}.\n{{secret:Keep this between us for now, it is a surprise.}}',
      clues: {
        sender: { label: 'A personal address', why: 'A director writes from the work address, not a free one with "office" added.' },
        busy: { label: 'They cannot be reached', why: 'Being unable to talk stops you checking with a quick call.' },
        cards: { label: 'Gift card codes', why: 'Once someone has the codes, the money is gone. No real job is paid for with gift card photos.' },
        secret: { label: 'Keep it secret', why: 'Secrecy keeps you from asking a colleague, who would spot it at once.' }
      }
    },
    {
      id: 'dentist', kind: 'text', scam: false,
      from: '{{known:Elm St Dental}}',
      body: 'Hi Sam, a reminder of your appointment at Elm Street Dental on Tue 14 Oct at 9:40. {{reply:Reply C to confirm, or call the practice to change it.}}',
      clues: {
        known: { label: 'A place you know', why: 'You booked this appointment, and the details match.' },
        reply: { label: 'No link, nothing to pay', why: 'It only asks you to confirm, and to call the practice you already know if anything changes.' }
      }
    },
    {
      id: 'refund', kind: 'email', scam: true,
      from: 'HMRC', address: '{{sender:refunds@gov-refund-claim.com}}',
      subject: 'You are owed a tax refund',
      body: 'You are eligible for a tax refund of £326.18.\n{{card:To receive it, enter your card number and security code}} {{rush:within 48 hours}}.\n{{link:gov-refund-claim.com/hmrc}}',
      clues: {
        sender: { label: 'Not a government address', why: 'A tax office writes from its government address, not gov-refund-claim.com.' },
        card: { label: 'A refund that needs your card', why: 'Money coming to you never needs your card\'s security code.' },
        rush: { label: 'A deadline', why: 'A real refund does not vanish in two days.' },
        link: { label: 'A look-alike address', why: '"gov" at the start of a name means nothing. Anyone can buy that address.' }
      }
    },
    {
      id: 'newnumber', kind: 'text', scam: true,
      from: '+44 7700 900836',
      body: '{{new:Hi Mum, this is my new number, my phone broke.}} {{money:Can you send £640 for my rent today?}} I will pay you back on Friday. {{call:Cannot talk, the screen is cracked.}}',
      clues: {
        new: { label: 'A new number', why: 'Anyone can say they are your child. Call the old number to check.' },
        money: { label: 'Money, today', why: 'The ask comes in the first message, with a reason to send it straight away.' },
        call: { label: 'No way to talk', why: 'A real voice would give it away, so there is always a reason they cannot call.' }
      }
    },
    {
      id: 'shipped', kind: 'email', scam: false,
      context: 'You ordered a book from this shop on Monday.',
      from: 'Larkspur Books', address: '{{sender:orders@larkspurbooks.co.uk}}',
      subject: 'Your order 10482 is on its way',
      body: 'Hello Sam,\n{{order:Your order 10482, The Garden Year, left our shop today.}} It should reach you on Thursday.\n{{own:You can follow it any time by signing in on our site.}}\nLarkspur Books',
      clues: {
        sender: { label: 'The shop\'s own address', why: 'It comes from the same shop you ordered from.' },
        order: { label: 'Details only the shop has', why: 'The order number and the book match what you bought.' },
        own: { label: 'No link needed', why: 'It does not ask you to tap anything or pay again. You can check on the site yourself.' }
      }
    },
    {
      id: 'invoice', kind: 'email', scam: true,
      from: 'PayPal Billing', address: '{{sender:billing.dept4471@outlook.com}}',
      subject: 'Payment received: invoice INV-88213',
      body: '{{buy:Your payment of $499.99 for Norton 360 Total Protection was successful.}}\nIf you did not authorise this payment, {{phone:call our billing desk on +1 (555) 0143}} {{rush:within 24 hours}} to cancel it.',
      clues: {
        sender: { label: 'A free email address', why: 'PayPal does not send invoices from an Outlook address.' },
        buy: { label: 'Something you never bought', why: 'The worry is the point: it makes you want to call at once.' },
        phone: { label: 'A number to call', why: 'The person on that line is the scammer. Check your account in the real app, or call the number on your card.' },
        rush: { label: 'A deadline', why: 'A real charge can be disputed for weeks, not just a day.' }
      }
    },
    {
      id: 'map', kind: 'dm', scam: false,
      context: 'Alex is a friend you play with every week.',
      from: 'Alex', address: '@alexbuilds',
      body: 'found that map we talked about!! {{place:it is pinned in #maps on our server}}\n{{rush:no rush, see you Saturday}}',
      clues: {
        place: { label: 'Somewhere you already go', why: 'It points to your own server, with no file to download and nothing to sign in to.' },
        rush: { label: 'No pressure', why: 'Nothing is asked, and there is no hurry.' }
      }
    }
  ];

  const KINDS = { email: 'An email', text: 'A text message', dm: 'A Discord message' };
  const MARK = /\{\{(\w+):([^}]+)\}\}/g;

  /** One field of a message as plain pieces and marked pieces, in order: [{ text }, { text, clue }]. */
  function parse(str) {
    const out = [];
    let at = 0;
    for (const m of String(str || '').matchAll(MARK)) {
      if (m.index > at) out.push({ text: str.slice(at, m.index) });
      out.push({ text: m[2], clue: m[1] });
      at = m.index + m[0].length;
    }
    if (at < String(str || '').length) out.push({ text: str.slice(at) });
    return out;
  }

  /** The message's clue keys in the order they first appear when read top to bottom; their number is index + 1. */
  function clueOrder(msg) {
    const keys = [];
    for (const field of [msg.from, msg.address, msg.subject, msg.body]) {
      for (const p of parse(field)) if (p.clue && !keys.includes(p.clue)) keys.push(p.clue);
    }
    return keys;
  }

  /** How the sorting went: answers is { id: 'scam' | 'real' }. Only answered messages count as missed. */
  function score(answers, messages = MESSAGES) {
    const answered = messages.filter((m) => answers[m.id]);
    const right = answered.filter((m) => (answers[m.id] === 'scam') === m.scam);
    return { right: right.length, total: messages.length, missed: answered.filter((m) => !right.includes(m)).map((m) => m.id) };
  }

  /** The closing words. Never a grade: a missed one is a clue learned. */
  function closing(right, total) {
    if (right === total) return 'Every one. Those are the clues Sentinel looks for in every message and link.';
    if (right >= total - 2) return 'Nearly all of them. The ones that got past you are the ones scammers work hardest on.';
    return 'Scams are made to look real, and these were written to be tricky. Each clue you have seen makes the next one easier to spot.';
  }

  if (typeof module === 'object' && module.exports) module.exports = { MESSAGES, KINDS, parse, clueOrder, score, closing };
  if (typeof document === 'undefined') return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mount(root) {
    const stage = root.querySelector('[data-practice-stage]');
    const count = root.querySelector('[data-practice-count]');
    const dots = root.querySelector('[data-practice-dots]');
    let round = 0;
    let answers = {};

    // The next message starts where the reader's eyes go back to: the top of the inbox, if it has scrolled up under the header.
    // Through Site.scrollTo, so Lenis (motion.js) never loses track of where the page is.
    const toTop = () => {
      const top = root.getBoundingClientRect().top;
      const margin = parseFloat(getComputedStyle(root).scrollMarginTop) || 0;   // clear of the fixed header
      if (top >= margin) return;
      const at = top + scrollY - margin;
      if (window.Site && Site.scrollTo) Site.scrollTo(at, false); else scrollTo(0, at);
    };
    // The static export has no /download route, only its file.
    const getHref = window.SENTINEL_STATIC ? 'download.html' : '/download';

    function paintTop() {
      count.textContent = round < MESSAGES.length ? `Message ${round + 1} of ${MESSAGES.length}` : 'Your inbox, sorted';
      dots.innerHTML = MESSAGES.map((m, i) => {
        const a = answers[m.id];
        return `<i class="${a ? ((a === 'scam') === m.scam ? 'is-right' : 'is-missed') : i === round ? 'is-current' : ''}"></i>`;
      }).join('');
    }

    // Marks are drawn from the start, plain until the answer shows them, so the message does not move when it does.
    function field(str, order) {
      return parse(str).map((p) => {
        if (!p.clue) return esc(p.text);
        const n = order.indexOf(p.clue) + 1;
        return `<span class="pmark" data-clue="${n}">${esc(p.text)}<span class="pmark__n" aria-hidden="true">${n}</span><span class="sr-only pmark__sr"> (clue ${n})</span></span>`;
      }).join('');
    }

    function show(focus) {
      paintTop();
      const m = MESSAGES[round];
      const order = clueOrder(m);
      const body = m.body.split('\n').map((line) => `<p>${field(line, order)}</p>`).join('');
      const head = m.kind === 'email'
        ? `<div class="pmsg__meta"><span class="pmsg__from"><b>${field(m.from, order)}</b> &lt;${field(m.address, order)}&gt;</span><span class="pmsg__subject">${field(m.subject, order)}</span></div>`
        : m.kind === 'dm'
          ? `<div class="pmsg__meta pmsg__meta--dm"><span class="pmsg__avatar" aria-hidden="true">${esc(m.from[0].toUpperCase())}</span><span><b>${field(m.from, order)}</b> <span class="muted">${field(m.address, order)}</span></span></div>`
          : `<div class="pmsg__meta"><span class="pmsg__from">From <b>${field(m.from, order)}</b></span></div>`;
      stage.innerHTML = `
        <article class="pmsg pmsg--${m.kind}" aria-labelledby="pmsg-h">
          <h2 class="pmsg__h" id="pmsg-h" tabindex="-1"><span class="sr-only">Message ${round + 1} of ${MESSAGES.length}: </span>${KINDS[m.kind]}</h2>
          ${m.context ? `<p class="pmsg__context">${esc(m.context)}</p>` : ''}
          <div class="pmsg__card">${head}<div class="pmsg__body">${body}</div></div>
        </article>
        <div class="practice__ask" role="group" aria-labelledby="practice-q">
          <p id="practice-q">Scam or real?</p>
          <div class="practice__picks">
            <button type="button" class="btn practice__pick" data-pick="scam">Scam</button>
            <button type="button" class="btn practice__pick" data-pick="real">Real</button>
          </div>
        </div>
        <div class="practice__out" data-practice-out></div>`;
      stage.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.pick)));
      if (focus) { stage.querySelector('#pmsg-h').focus({ preventScroll: true }); toTop(); }
    }

    function pick(choice) {
      const m = MESSAGES[round];
      if (answers[m.id]) return;
      answers[m.id] = choice;
      const right = (choice === 'scam') === m.scam;
      const order = clueOrder(m);
      stage.querySelector('.pmsg').classList.add('is-marked', m.scam ? 'is-scam' : 'is-real');
      stage.querySelectorAll('[data-pick]').forEach((b) => {
        b.disabled = true;
        if (b.dataset.pick === choice) b.classList.add('is-picked');
        b.setAttribute('aria-pressed', String(b.dataset.pick === choice));
      });
      const last = round === MESSAGES.length - 1;
      const said = choice === 'scam' ? 'a scam' : 'real';
      const truth = m.scam ? 'a scam' : 'real';
      stage.querySelector('[data-practice-out]').innerHTML = `
        <div class="practice__verdict ${right ? 'is-right' : 'is-missed'}">
          <h3 tabindex="-1" data-practice-verdict>${right ? `Yes, this one is ${truth}.` : `You said ${said}. This one is ${truth}.`}</h3>
          <p>${m.scam ? 'What gives it away, marked in the message:' : 'What shows it is real, marked in the message:'}</p>
          <ol class="practice__clues">${order.map((k) => `<li><b>${esc(m.clues[k].label)}.</b> ${esc(m.clues[k].why)}</li>`).join('')}</ol>
          <button type="button" class="btn btn--gold" data-practice-next>${last ? 'See how you did' : 'Next message'}</button>
        </div>`;
      stage.querySelector('[data-practice-next]').addEventListener('click', () => { round++; round < MESSAGES.length ? show(true) : finish(); });
      paintTop();
      stage.querySelector('[data-practice-verdict]').focus({ preventScroll: true });
    }

    function finish() {
      round = MESSAGES.length;
      paintTop();
      const s = score(answers);
      const missed = MESSAGES.filter((m) => s.missed.includes(m.id));
      stage.innerHTML = `
        <div class="practice__end">
          <h2 tabindex="-1" data-practice-end>You sorted ${s.right} of ${s.total} the way the clues point.</h2>
          <p>${closing(s.right, s.total)}</p>
          ${missed.length ? `<h3>Worth a second look</h3><ul class="practice__missed">${missed.map((m) => `<li><b>${esc(m.subject || KINDS[m.kind])}</b>: ${m.scam ? 'a scam' : 'real'}. ${esc(m.clues[clueOrder(m)[0]].why)}</li>`).join('')}</ul>` : ''}
          <h3>The clues that came up most</h3>
          <ul class="practice__rules">
            <li>A deadline, a threat or a secret.</li>
            <li>Being asked for a password, a code, a card number or gift cards.</li>
            <li>A sender or link whose real address is not the company&rsquo;s own.</li>
            <li>A number to call that came in the message. Use the one on your card or the company&rsquo;s own site.</li>
          </ul>
          <div class="practice__again">
            <button type="button" class="btn" data-practice-again>Sort them again</button>
            <a class="btn btn--gold" href="${getHref}">Get Sentinel free</a>
          </div>
        </div>`;
      stage.querySelector('[data-practice-again]').addEventListener('click', () => { round = 0; answers = {}; show(true); });
      stage.querySelector('[data-practice-end]').focus({ preventScroll: true });
      toTop();
    }

    show(false);
  }

  const root = document.querySelector('[data-practice]');
  if (root) mount(root);
})();
