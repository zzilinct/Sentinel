/**
 * Spot the scam, a practice inbox (practice.html). Ten messages are dealt from a larger pool. The person opens each,
 * can tap the sender or a link to see the real address behind it, then keeps it or reports it and names what gave it
 * away. Nothing is stored or sent: the answers live in this page until it is closed.
 *
 * Every message is judged on three things only: the sender, the link and the ask. A message is a scam exactly when one
 * of those three is bad (`isScam`), so the rules the page teaches cannot fail on its own examples.
 *
 * Most messages have a twin that reads the same in the list, one real and one a scam. Remembering "the parcel one was
 * real" is worth nothing on the next deal: only checking is.
 *
 * Made up: real brands appear only as a scam would name them, every real message comes from a made-up place, and phone
 * numbers are from the ranges kept for drama (UK 07700 900xxx, US 555-01xx). In a body, [[words]] is the link and
 * {{words}} is the ask. Links are never links: they are buttons that show where the address goes.
 */
(() => {
  'use strict';

  const NAME_COPIED = 'A name on a text can be copied by anyone, so it proves nothing either way.';
  const TEXT_NAME = 'Names on texts can be copied';
  const NOT_SAVED = 'not saved in your phone';

  const POOL = [
    { id: 'parcel-real', pair: 'parcel', kind: 'text', from: 'MarlowePost', addr: TEXT_NAME, due: true,
      context: 'You are waiting for a parcel from Marlowe Post.',
      body: 'Marlowe Post: your parcel comes tomorrow, 2pm to 4pm. {{Pick a safe place or a new day by 6pm tonight}}: [[marlowepost.co.uk/p/7Q4K2]]',
      sender: { why: NAME_COPIED },
      link: { to: 'marlowepost.co.uk/p/7Q4K2', root: 'marlowepost.co.uk', why: 'The address ends in the company\'s own name.' },
      ask: { why: 'Choosing a delivery day costs nothing. It wants no card and no password.' } },
    { id: 'parcel-scam', pair: 'parcel', kind: 'text', from: 'MarlowePost', addr: TEXT_NAME, due: true,
      context: 'You are waiting for a parcel from Marlowe Post.',
      body: 'Marlowe Post: your parcel comes tomorrow, 2pm to 4pm. {{Pay the £1.45 delivery fee by 6pm tonight}}: [[marlowepost.delivery-fee.top/p/7Q4K2]]',
      sender: { why: NAME_COPIED },
      link: { bad: true, to: 'marlowepost.delivery-fee.top/p/7Q4K2', root: 'delivery-fee.top', why: 'The name is at the front, but the address really ends in delivery-fee.top. Anyone can buy that.' },
      ask: { bad: true, why: 'The fee is tiny so you pay without thinking. What they want is your card number.' } },

    { id: 'bank-real', pair: 'bank', kind: 'text', from: 'ThornburyBk', addr: TEXT_NAME,
      context: 'You bank with Thornbury Bank.',
      body: 'Thornbury Bank: did you just spend £84.20 at Harlow Tools? If not, {{open the Thornbury app and tap Freeze card}}. We never ask for codes.',
      sender: { why: NAME_COPIED },
      ask: { why: 'It sends you to the app you already have, not to a number or a page it chose.' } },
    { id: 'bank-scam', pair: 'bank', kind: 'text', from: 'ThornburyBk', addr: TEXT_NAME,
      context: 'You bank with Thornbury Bank.',
      body: 'Thornbury Bank: did you just spend £84.20 at Harlow Tools? If not, {{call our fraud team on +44 7700 900836 and read out the code we send you}}.',
      sender: { why: NAME_COPIED },
      ask: { bad: true, why: 'A bank never needs your code read out. Call the number on your card instead.' } },

    { id: 'supplier-real', pair: 'supplier', kind: 'email', from: 'Priya Nair', addr: 'priya@oaklinesupplies.co.uk', root: 'oaklinesupplies.co.uk', due: true,
      context: 'You pay suppliers at work. Priya at Oakline Supplies is someone you know.', subject: 'Re: Invoice 3381',
      body: 'Thanks for this, all received.\n{{Invoice 3381 is due on Friday, to the usual account.}}\nThe PDF is on our portal: [[portal.oaklinesupplies.co.uk/3381]]',
      sender: { why: 'The same address as every earlier email from Priya.' },
      link: { to: 'portal.oaklinesupplies.co.uk/3381', root: 'oaklinesupplies.co.uk', why: 'It ends in the company\'s own address.' },
      ask: { why: 'The usual payment to the usual account. Nothing has changed.' } },
    { id: 'supplier-scam', pair: 'supplier', kind: 'email', from: 'Priya Nair', addr: 'priya@oaklinesupplies.co.uk', root: 'oaklinesupplies.co.uk',
      context: 'You pay suppliers at work. Priya at Oakline Supplies is someone you know.', subject: 'Re: Invoice 3381',
      body: 'Thanks for this, all received.\n{{Our bank has changed, so please send this and future payments to the new account in the attachment.}}\nKind regards, Priya',
      sender: { why: 'The address really is Priya\'s. Mailboxes get broken into, so a right address is not enough on its own.' },
      ask: { bad: true, why: 'New bank details by email is how invoices get stolen. Call Priya on the number you already have.' } },

    { id: 'signin-real', pair: 'signin', kind: 'email', from: 'Fernhill Mail', addr: 'no-reply@accounts.fernhillmail.net', root: 'fernhillmail.net',
      context: 'Fernhill Mail is your email provider.', subject: 'New sign-in on your account',
      body: 'We saw a new sign-in from Chrome on Windows.\nIf this was you, there is nothing to do. {{If it was not, change your password.}}\n[[Review this sign-in]]',
      sender: { why: 'The address ends in fernhillmail.net, the provider\'s own.' },
      link: { to: 'accounts.fernhillmail.net/security', root: 'fernhillmail.net', why: 'The button goes to the provider\'s own address.' },
      ask: { why: 'If it was you, nothing is asked. There is no threat and no countdown.' } },
    { id: 'signin-scam', pair: 'signin', kind: 'email', from: 'Fernhill Mail', addr: 'security@fernhill-mail-verify.com', root: 'fernhill-mail-verify.com', due: true,
      context: 'Fernhill Mail is your email provider.', subject: 'New sign-in on your account',
      body: 'We saw a new sign-in from Chrome on Windows.\n{{Confirm your password within 24 hours or your account closes.}}\n[[Review this sign-in]]',
      sender: { bad: true, why: 'The name says Fernhill, but the address belongs to fernhill-mail-verify.com.' },
      link: { bad: true, to: 'fernhillmail.account-check.ru/login', root: 'account-check.ru', why: 'What counts is the end of the address, account-check.ru. That is not Fernhill.' },
      ask: { bad: true, why: 'Your password on a page a message sent you to is what they are after.' } },

    { id: 'lantern-real', pair: 'lantern', kind: 'email', from: 'Lantern TV', addr: 'billing@lanterntv.com', root: 'lanterntv.com', due: true,
      context: 'You pay for Lantern TV each month.', subject: 'Your payment did not go through',
      body: 'Your last payment was declined. {{Update your card by Friday}} to keep watching.\n[[Update payment]]',
      sender: { why: 'The same lanterntv.com address as your monthly receipts.' },
      link: { to: 'lanterntv.com/account/billing', root: 'lanterntv.com', why: 'The button goes to the site you already use.' },
      ask: { why: 'A real deadline for a real bill. You could also sign in yourself and check, and it would say the same.' } },
    { id: 'lantern-scam', pair: 'lantern', kind: 'email', from: 'Lantern TV', addr: 'billing@lantern-tv-help.com', root: 'lantern-tv-help.com', due: true,
      context: 'You pay for Lantern TV each month.', subject: 'Your payment did not go through',
      body: 'Your last payment was declined. {{Update your card by Friday}} to keep watching.\n[[Update payment]]',
      sender: { bad: true, why: 'Same name and same words, but the address is lantern-tv-help.com, not lanterntv.com.' },
      link: { bad: true, to: 'lanterntv.payfix.click/account', root: 'payfix.click', why: 'It really ends in payfix.click. Sign in to Lantern yourself instead.' },
      ask: { why: 'The words are the same as a real reminder, which is why you have to check where they came from.' } },

    { id: 'library-real', pair: 'library', kind: 'email', from: 'Northfield Library', addr: 'notices@northfieldlibrary.org', root: 'northfieldlibrary.org', due: true,
      context: 'You have a card at Northfield Library.', subject: 'Two books due back',
      body: 'Hello Sam,\nTwo books on your card are due back on Friday. {{Renew them here or at the front desk.}}\n[[northfieldlibrary.org/renew]]',
      sender: { why: 'The library\'s own address, as on every earlier reminder.' },
      link: { to: 'northfieldlibrary.org/renew', root: 'northfieldlibrary.org', why: 'It ends in the library\'s own address.' },
      ask: { why: 'A normal due date, and you can do it in person too.' } },
    { id: 'library-scam', pair: 'library', kind: 'email', from: 'Northfield Library', addr: 'notices@northfield-library-fines.com', root: 'northfield-library-fines.com', due: true,
      context: 'You have a card at Northfield Library.', subject: 'Two books due back',
      body: 'Hello Sam,\nTwo books on your card are overdue. {{Pay the £6.40 fine by Friday to keep your card.}}\n[[northfield-library-fines.com/pay]]',
      sender: { bad: true, why: 'The address is northfield-library-fines.com, not the library\'s own.' },
      link: { bad: true, to: 'northfield-library-fines.com/pay', root: 'northfield-library-fines.com', why: 'A look-alike site. The real one ends in northfieldlibrary.org.' },
      ask: { why: 'A small fine is believable. That is why the address matters more than the amount.' } },

    { id: 'code-real', pair: 'code', kind: 'text', from: 'Brightwater', addr: TEXT_NAME, due: true,
      context: 'You have just asked to sign in to your energy account.',
      body: 'Brightwater: your sign-in code is 482913. It expires in 10 minutes. {{Do not share it with anyone, not even us.}}',
      sender: { why: NAME_COPIED },
      ask: { why: 'You asked for this code, and it tells you to keep it. A deadline on a code is normal.' } },
    { id: 'code-scam', pair: 'code', kind: 'text', from: 'Brightwater', addr: TEXT_NAME, due: true,
      context: 'You have just asked to sign in to your energy account.',
      body: 'Brightwater: your sign-in code is 482913. It expires in 10 minutes. {{Our adviser will call you, so please read it out to them.}}',
      sender: { why: NAME_COPIED },
      ask: { bad: true, why: 'A code is for you alone. Whoever hears it can get into your account.' } },

    { id: 'desk-real', pair: 'desk', kind: 'email', from: 'Dana Whitlock', addr: 'dana.whitlock@hollisandco.co.uk', root: 'hollisandco.co.uk',
      context: 'Dana is your manager at Hollis and Co.', subject: 'Quick favour',
      body: 'Are you at your desk? I am in meetings all day.\n{{Could you book room 4 for the client on Thursday?}}\nThanks, Dana',
      sender: { why: 'Dana\'s work address, the one she always uses.' },
      ask: { why: 'An ordinary job, and you could ask her about it in person.' } },
    { id: 'desk-scam', pair: 'desk', kind: 'email', from: 'Dana Whitlock', addr: 'dana.whitlock.office@gmail.com', root: 'gmail.com',
      context: 'Dana is your manager at Hollis and Co.', subject: 'Quick favour',
      body: 'Are you at your desk? I am in meetings all day.\n{{Please buy five $100 gift cards for a client and send me photos of the codes. Keep this between us.}}',
      sender: { bad: true, why: 'A free gmail.com address, not her work one.' },
      ask: { bad: true, why: 'Once someone has gift card codes, the money is gone. Secrecy stops you asking a colleague.' } },

    { id: 'map-real', pair: 'map', kind: 'dm', from: 'Alex', addr: '@alexbuilds, in your server for two years',
      context: 'Alex is a friend you play with every week.',
      body: 'hey check out this map i made!! {{it is pinned in #maps on our server}}, no rush, see you saturday',
      sender: { why: 'The account you have played with for years.' },
      ask: { why: 'It points to your own server, with nothing to download and nothing to sign in to.' } },
    { id: 'map-scam', pair: 'map', kind: 'dm', from: 'Alex', addr: '@alexbuilds_, joined this week, no shared servers',
      context: 'Alex is a friend you play with every week.',
      body: 'hey check out this map i made!! {{you just sign in with Discord to get it}}\n[[discord-maps.gift/alex]]',
      sender: { bad: true, why: 'A look-alike account with one extra mark in the name, and it is new.' },
      link: { bad: true, to: 'discord-maps.gift/alex', root: 'discord-maps.gift', why: 'Not Discord. A sign-in page here hands over your account.' },
      ask: { bad: true, why: 'A map never needs your password.' } },

    { id: 'number-real', pair: 'number', kind: 'text', from: '+44 7700 900518', addr: `+44 7700 900518, ${NOT_SAVED}`,
      context: 'Ella, your daughter, said at lunch that her phone had broken.',
      body: 'Hi Mum, this is my new number, my phone broke. {{Save this one for now.}} See you on Sunday x',
      sender: { why: 'An unknown number proves nothing, but she told you about this in person, and nothing hangs on it.' },
      ask: { why: 'It wants nothing from you. Saving a number costs nothing.' } },
    { id: 'number-scam', pair: 'number', kind: 'text', from: '+44 7700 900518', addr: `+44 7700 900518, ${NOT_SAVED}`,
      context: 'Ella, your daughter, lives away from home.',
      body: 'Hi Mum, this is my new number, my phone broke. {{Can you send £640 for my rent? Cannot talk, the screen is cracked.}}',
      sender: { bad: true, why: 'Anyone can say they are your child. Call her old number to check.' },
      ask: { bad: true, why: 'Money in the first message, with a reason you cannot hear her voice.' } },

    { id: 'refund-real', pair: 'refund', kind: 'email', from: 'Harcourt Council', addr: 'payments@harcourt.gov.uk', root: 'harcourt.gov.uk',
      context: 'You pay council tax to Harcourt Council.', subject: 'You are owed a refund',
      body: 'You paid £326.18 too much last year.\n{{It will go back to your usual account in five working days. There is nothing you need to do.}}',
      sender: { why: 'A real council address, ending in gov.uk.' },
      ask: { why: 'It asks for nothing at all. Money coming to you never needs your card details.' } },
    { id: 'refund-scam', pair: 'refund', kind: 'email', from: 'Harcourt Council', addr: 'refunds@gov-refund-claim.com', root: 'gov-refund-claim.com', due: true,
      context: 'You pay council tax to Harcourt Council.', subject: 'You are owed a refund',
      body: 'You paid £326.18 too much last year.\n{{To get it back, enter your card number and security code within 48 hours.}}\n[[gov-refund-claim.com/harcourt]]',
      sender: { bad: true, why: '"gov" at the start of a name means nothing. Anyone can buy that address.' },
      link: { bad: true, to: 'gov-refund-claim.com/harcourt', root: 'gov-refund-claim.com', why: 'Not a government address, which would end in gov.uk.' },
      ask: { bad: true, why: 'A refund never needs your security code.' } },

    { id: 'order-real', pair: 'order', kind: 'email', from: 'Larkspur Books', addr: 'orders@larkspurbooks.co.uk', root: 'larkspurbooks.co.uk',
      context: 'You ordered a book from Larkspur on Monday.', subject: 'About your order 10482',
      body: 'Hello Sam,\nThanks for your order.\n{{Your book left our shop today and comes on Thursday.}}\nFollow it here: [[larkspurbooks.co.uk/orders/10482]]',
      sender: { why: 'The shop you ordered from, at its own address.' },
      link: { to: 'larkspurbooks.co.uk/orders/10482', root: 'larkspurbooks.co.uk', why: 'It ends in the shop\'s own address.' },
      ask: { why: 'Nothing is asked. It only tells you what you expected to hear.' } },
    { id: 'order-scam', pair: 'order', kind: 'email', from: 'Larkspur Books', addr: 'larkspur.orders4471@outlook.com', root: 'outlook.com', due: true,
      context: 'You ordered a book from Larkspur on Monday.', subject: 'About your order 10482',
      body: 'Hello Sam,\nThanks for your order.\nYou were charged £499.99 for 40 copies. {{To cancel, call our billing desk on +1 (555) 0143 within 24 hours.}}',
      sender: { bad: true, why: 'A shop does not bill you from a free outlook.com address.' },
      ask: { bad: true, why: 'The fright makes you call. The person on that line is the scammer. Check your own bank app.' } },

    { id: 'dentist-real', pair: 'dentist', kind: 'text', from: 'ElmStDental', addr: TEXT_NAME, due: true,
      context: 'You booked a check-up at Elm Street Dental.',
      body: 'Hi Sam, your check-up at Elm St Dental is Tue at 9:40. {{Reply C to confirm by 5pm Monday, or call the practice to change it.}}',
      sender: { why: NAME_COPIED },
      ask: { why: 'You booked this, and all it wants is one letter back.' } },
    { id: 'dentist-scam', pair: 'dentist', kind: 'text', from: 'ElmStDental', addr: TEXT_NAME, due: true,
      context: 'You booked a check-up at Elm Street Dental.',
      body: 'Hi Sam, your check-up at Elm St Dental is Tue at 9:40. {{Pay a £20 deposit by 5pm Monday to keep it}}: [[elmst-dental-booking.top/pay]]',
      sender: { why: NAME_COPIED },
      link: { bad: true, to: 'elmst-dental-booking.top/pay', root: 'elmst-dental-booking.top', why: 'A .top address the practice has never used. Call the number you already have.' },
      ask: { why: 'A deposit is possible, so the ask alone would not tell you. The link does.' } },

    { id: 'school-real', pair: 'school', kind: 'email', from: 'Greenway Primary', addr: 'office@greenwayprimary.sch.uk', root: 'greenwayprimary.sch.uk', due: true,
      context: 'Your son is in Year 5 at Greenway Primary.', subject: 'Year 5 museum trip',
      body: 'Dear parents,\n{{The £12 for the museum trip is due by Friday.}} Pay on the school site:\n[[greenwayprimary.sch.uk/trips]]',
      sender: { why: 'The school\'s own address, ending in sch.uk.' },
      link: { to: 'greenwayprimary.sch.uk/trips', root: 'greenwayprimary.sch.uk', why: 'It stays on the school\'s own site.' },
      ask: { why: 'A real deadline for a trip you have heard about. Nothing odd is wanted.' } },
    { id: 'school-scam', pair: 'school', kind: 'email', from: 'Greenway Primary', addr: 'office@greenway-primary-pay.com', root: 'greenway-primary-pay.com', due: true,
      context: 'Your son is in Year 5 at Greenway Primary.', subject: 'Year 5 museum trip',
      body: 'Dear parents,\n{{The £12 for the museum trip is due by Friday.}} Pay on the school site:\n[[greenway-primary-pay.com/trips]]',
      sender: { bad: true, why: 'Word for word what the school might send, but the address is not the school\'s.' },
      link: { bad: true, to: 'greenway-primary-pay.com/trips', root: 'greenway-primary-pay.com', why: 'A look-alike. Ask the school office if you are not sure.' },
      ask: { why: 'The ask is ordinary. That is what makes this one convincing.' } },

    { id: 'reported', pair: 'reported', kind: 'dm', from: 'jayden', addr: '@jaydenplays_, no shared servers',
      body: 'hey sorry i think i accidentally reported your account, it says it is flagged now\n{{talk to the Discord staff, their name is @Discord Safety Team, they can fix it}}',
      sender: { bad: true, why: 'A stranger with no servers in common, and a story that does not work: one click cannot get you banned.' },
      ask: { bad: true, why: 'Discord staff do not sort things out by message. That "staff" account is the scammer, and will want your password.' } },
    { id: 'wrongnumber', pair: 'wrongnumber', kind: 'text', from: '+44 7700 900293', addr: `+44 7700 900293, ${NOT_SAVED}`,
      body: 'Hi, is this Mark? {{Are we still on for golf on Saturday?}} Lovely to chat the other night',
      sender: { bad: true, why: 'A stranger who has "the wrong number" and stays friendly. Weeks later comes an investment.' },
      ask: { bad: true, why: 'There is nothing in it yet, on purpose. All it wants is for you to reply. Do not.' } },
    { id: 'norton', pair: 'norton', kind: 'email', from: 'PayPal Billing', addr: 'billing.dept4471@outlook.com', root: 'outlook.com', due: true,
      subject: 'Payment received: INV-88213',
      body: 'Your payment of $499.99 for Norton 360 was successful.\n{{If you did not authorise this, call our desk on +1 (555) 0143 within 24 hours.}}',
      sender: { bad: true, why: 'PayPal does not write from a free outlook.com address.' },
      ask: { bad: true, why: 'They want you to ring them. Check your account in the real app, or use the number on your card.' } }
  ];

  const KINDS = { email: 'Email', text: 'Text', dm: 'Discord' };
  const TELLS = ['sender', 'link', 'ask'];
  const LABEL = { sender: 'The sender', link: 'The link', ask: 'What it asks for' };
  const DRAW = 10;
  const LINK = /\[\[([^\]]+)\]\]/;

  const isScam = (m) => TELLS.some((k) => m[k] && m[k].bad);
  const isQuiet = (m) => isScam(m) && !m.link && !m.due;

  /** A body as pieces, in order: [{ text }, { text, ask: true }, { text, link: true }]. */
  function parse(str) {
    const out = [];
    let at = 0;
    for (const p of String(str || '').matchAll(/\{\{([^}]+)\}\}|\[\[([^\]]+)\]\]/g)) {
      if (p.index > at) out.push({ text: str.slice(at, p.index) });
      out.push(p[1] ? { text: p[1], ask: true } : { text: p[2], link: true });
      at = p.index + p[0].length;
    }
    if (at < String(str || '').length) out.push({ text: str.slice(at) });
    return out;
  }

  const plain = (m) => parse(m.body).map((p) => p.text).join('').replace(/\n/g, ' ');
  /** What the list shows: short enough that twins read the same. */
  const preview = (m) => `${plain(m).slice(0, 30).trim()}...`;

  function shuffle(list, rng) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /** A deal is only fair if a link or a deadline cannot sort it: real ones that have them, scams that have neither. */
  function fair(deck) {
    const scams = deck.filter(isScam).length;
    return deck.length === DRAW && scams >= 4 && scams <= 6
      && deck.filter((m) => !isScam(m) && (m.link || m.due)).length >= 3
      && [2, 3].includes(deck.filter(isQuiet).length);   // at most 3, so the next deal has some left
  }

  /** Ten messages, no two from one twin pair, none from `seen` (the last deal) while the pool allows. */
  function draw(rng = Math.random, seen = new Set()) {
    for (const pool of [POOL.filter((m) => !seen.has(m.id)), POOL]) {
      for (let tries = 0; tries < 200; tries++) {
        const pairs = new Set();
        const deck = shuffle(pool, rng).filter((m) => !pairs.has(m.pair) && pairs.add(m.pair)).slice(0, DRAW);
        if (fair(deck)) return deck;
      }
    }
    return shuffle(POOL, rng).slice(0, DRAW);   // never reached with this pool: a test walks thousands of deals
  }

  /** The verdict on one message. `choice` is 'fine', 'unsure', or the tell the person named. */
  function judge(m, choice) {
    const scam = isScam(m);
    const reported = choice !== 'fine';
    const bad = TELLS.filter((k) => m[k] && m[k].bad);
    return { scam, reported, right: reported === scam, named: reported && bad.includes(choice), main: bad[0] || null };
  }

  /** The heading and one line for a verdict. Never a telling-off: a miss is a clue learned. */
  function words(m, choice, looked) {
    const o = judge(m, choice);
    if (o.scam && !o.reported) return { h: 'This one got past you.', p: `It is a scam. ${LABEL[o.main]} gave it away.` };
    if (o.named) return { h: 'Caught it.', p: `It is a scam, and you named a sign that gives it away: ${LABEL[choice].toLowerCase()}.` };
    if (o.scam) {
      return { h: 'Right to report it.', p: choice === 'unsure' ? `Trust that feeling. What gave it away was ${LABEL[o.main].toLowerCase()}.` : `It is a scam, but not because of ${LABEL[choice].toLowerCase()}. Look at ${LABEL[o.main].toLowerCase()}.` };
    }
    if (o.reported) return { h: 'This one is real.', p: 'A false alarm costs little, but real messages carry links and deadlines too. Checking tells them apart.' };
    const checked = looked.sender && (!m.link || looked.link);
    return checked ? { h: 'Yes, this one is real.', p: 'You checked before you trusted it. That is the whole habit.' }
      : { h: 'Yes, this one is real.', p: `You did not check ${looked.sender ? 'the link' : 'the sender'} first, though. A scam can read word for word the same.` };
  }

  /**
   * After the first pass, one new message for each kind of miss (never the same message again), at most three. If they
   * would all be scams or all be real, the list would give the answer away, so one of the other sort joins them.
   */
  function secondLook(log, rng = Math.random) {
    const used = new Set(log.map((e) => e.m.pair));
    const take = (test) => {
      const m = shuffle(POOL, rng).find((x) => !used.has(x.pair) && test(x));
      if (m) used.add(m.pair);
      return m;
    };
    const misses = log.filter((e) => !judge(e.m, e.choice).right);
    const out = [];
    for (const key of new Set(misses.map((e) => judge(e.m, e.choice).main))) {
      // The same trick in new clothes: any scam where that same thing is bad, not only one where it is the first sign.
      const m = take((x) => (key ? Boolean(x[key] && x[key].bad) : !isScam(x) && (x.link || x.due)));
      if (m) out.push(m);
    }
    const picks = out.slice(0, 3);
    if (picks.length && picks.every(isScam)) { const m = take((x) => !isScam(x)); if (m) picks.push(m); }
    else if (picks.length && !picks.some(isScam)) { const m = take(isQuiet); if (m) picks.push(m); }
    return picks;
  }

  const ADVICE = {
    sender: 'Work on the sender. Before you trust a name, tap it and read the address behind it.',
    link: 'Work on the link. Read the end of the address, just before the first single slash. That part is who really owns it.',
    ask: 'Work on the ask. Even from the right address, a code, gift cards, new bank details or sudden money means stop and check another way.',
    alarm: 'Real messages got reported. A link or a deadline proves nothing either way, so check the address before you decide.',
    none: 'Nothing got past you in this inbox. The next one is dealt from different messages.'
  };

  /** What the end of a run says. Counts only the first pass, and only what actually happened. */
  function summary(log) {
    const first = log.filter((e) => !e.second);
    const again = log.filter((e) => e.second);
    const scams = first.filter((e) => isScam(e.m));
    const reals = first.filter((e) => !isScam(e.m));
    const by = {};
    for (const k of TELLS) {
      const these = scams.filter((e) => judge(e.m, 'fine').main === k);
      by[k] = { total: these.length, spotted: these.filter((e) => judge(e.m, e.choice).named).length };
    }
    const hasLink = first.filter((e) => e.m.link);
    const s = {
      scams: scams.length, caught: scams.filter((e) => judge(e.m, e.choice).reported).length,
      reals: reals.length, kept: reals.filter((e) => e.choice === 'fine').length,
      by, looked: {
        sender: { done: first.filter((e) => e.looked.sender).length, total: first.length },
        link: { done: hasLink.filter((e) => e.looked.link).length, total: hasLink.length }
      },
      again: { right: again.filter((e) => judge(e.m, e.choice).right).length, total: again.length }
    };
    const weakest = TELLS.map((k) => [k, by[k].total - by[k].spotted]).sort((a, b) => b[1] - a[1])[0];
    s.work = weakest[1] > 0 ? weakest[0] : s.kept < s.reals ? 'alarm' : 'none';
    s.advice = ADVICE[s.work];
    return s;
  }

  if (typeof module === 'object' && module.exports) module.exports = { POOL, KINDS, TELLS, DRAW, ADVICE, isScam, isQuiet, parse, plain, preview, draw, fair, judge, words, secondLook, summary };
  if (typeof document === 'undefined') return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TIMES = ['09:41', '09:12', '08:30', '07:55', 'Yesterday', 'Yesterday', 'Yesterday', 'Mon', 'Mon', 'Sun', 'Sun', 'Sat', 'Sat'];
  const IDLE = 'Tap the sender or a link to see the real address';

  /** An address with the part that decides who owns it picked out. */
  function address(text, root) {
    const at = root ? text.lastIndexOf(root) : -1;
    return at < 0 ? esc(text) : `${esc(text.slice(0, at))}<b>${esc(root)}</b>${esc(text.slice(at + root.length))}`;
  }

  function mount(root) {
    const tray = root.querySelector('[data-tray]');
    const list = root.querySelector('[data-list]');
    const count = root.querySelector('[data-count]');
    const fill = root.querySelector('[data-fill]');
    const done = root.querySelector('[data-done]');
    const sheet = root.querySelector('[data-sheet]');
    const stage = root.querySelector('[data-stage]');
    const getHref = window.SENTINEL_STATIC ? 'download.html' : '/download';
    const mask = (name) => (window.SentinelMasks ? window.SentinelMasks.svg(name) : '');
    const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

    let seen = new Set();
    let deck = [];
    let log = new Map();
    let looked = {};
    let added = false;
    let current = null;

    const left = () => deck.filter((m) => !log.has(m.id));

    function paintList() {
      const rows = deck.map((m, i) => {
        const e = log.get(m.id);
        const state = !e ? '' : judge(m, e.choice).right ? (e.choice === 'fine' ? 'Kept' : 'Reported') : (e.choice === 'fine' ? 'Kept, a scam' : 'Reported, real');
        const unread = !e && !looked[m.id];
        return `<li style="--i:${i}"><button type="button" class="prow${unread ? ' is-unread' : ''}${e ? ' is-done' : ''}" data-open="${m.id}">
          <span class="prow__dot" aria-hidden="true"></span>
          <span class="prow__from">${unread ? '<span class="sr-only">Unread. </span>' : ''}${esc(m.from)}</span>
          <span class="prow__when">${esc(KINDS[m.kind])}, ${esc(TIMES[i] || 'Sat')}</span>
          <span class="prow__line"><b>${esc(m.subject || '')}</b> ${esc(preview(m))}</span>
          ${state ? `<span class="prow__state${judge(m, e.choice).right ? '' : ' is-missed'}">${state}</span>` : ''}
        </button></li>`;
      }).join('');
      list.innerHTML = rows;
      const n = left().length;
      count.textContent = n ? `${n} to sort` : 'All sorted';
      fill.style.transform = `scaleX(${deck.length ? 1 - n / deck.length : 0})`;
    }

    // `value` is markup already escaped by address(); `note` is plain words, for a text whose sender cannot be looked up.
    function isle(label, value, note) {
      return `<div class="pisle__pill${value || note ? ' is-open' : ''}"><span>${esc(label)}</span>${value ? `<code>${value}</code>` : note ? `<em>${esc(note)}</em>` : ''}</div>`;
    }

    function card(m) {
      const body = m.body.split('\n').map((line) => `<p>${parse(line).map((p) => {
        if (p.link) return `<button type="button" class="plink" data-peek="link">${esc(p.text)}</button>`;
        return p.ask ? `<span class="pask">${esc(p.text)}</span>` : esc(p.text);
      }).join('')}</p>`).join('');
      const place = deck.indexOf(m) + 1;
      return `<div class="pcard-wrap" data-card data-id="${m.id}">
        <article class="pcard pcard--${m.kind}" aria-labelledby="pcard-h">
          <div class="pcard__top">
            <button type="button" class="pback" data-back>Inbox</button>
            <span class="mono">${place} of ${deck.length}</span>
          </div>
          ${m.context ? `<p class="pcard__context">${esc(m.context)}</p>` : ''}
          <button type="button" class="pfrom" data-peek="sender">
            <span class="pfrom__face" aria-hidden="true">${esc(m.from.replace(/^\+.*/, '#')[0].toUpperCase())}</span>
            <span class="pfrom__who"><b>${esc(m.from)}</b><small>${esc(KINDS[m.kind])}, ${esc(TIMES[place - 1] || 'Sat')}</small></span>
            <span class="pfrom__see">See sender</span>
          </button>
          <div class="pisle" data-isle role="status">${isle(IDLE)}</div>
          <h2 class="pcard__subject" id="pcard-h" tabindex="-1">${esc(m.subject || `${KINDS[m.kind]} from ${m.from}`)}</h2>
          <div class="pcard__body">${body}</div>
          <div class="pact" data-actions>
            <div class="pact__row">
              <button type="button" class="btn pact__btn" data-fine>Looks fine</button>
              <button type="button" class="btn pact__btn pact__btn--report" data-report aria-expanded="false" aria-controls="pwhy">Report</button>
            </div>
            <div class="pwhy" id="pwhy" role="group" aria-labelledby="pwhy-h" hidden>
              <p id="pwhy-h">What gave it away?</p>
              ${TELLS.filter((k) => k !== 'link' || m.link).map((k) => `<button type="button" class="pwhy__opt" data-why="${k}">${LABEL[k]}</button>`).join('')}
              <button type="button" class="pwhy__opt pwhy__opt--plain" data-why="unsure">I cannot say, it just feels off</button>
            </div>
          </div>
        </article>
      </div>`;
    }

    /** Lays the new card over the last one, which stays underneath until it is covered. */
    function layCard(m) {
      const under = stage.querySelector('[data-card]');
      stage.insertAdjacentHTML('beforeend', card(m));
      const top = stage.lastElementChild;
      stage.classList.toggle('has-more', left().length > 1);
      sheet.scrollTop = 0;
      if (!under) return top;
      under.inert = true;
      under.classList.add('is-under');
      sheet.classList.add('is-moving');
      const clear = () => { under.remove(); sheet.classList.remove('is-moving'); };
      if (still()) clear(); else { top.addEventListener('animationend', clear, { once: true }); setTimeout(clear, 900); }
      return top;
    }

    function open(id, push) {
      const m = deck.find((x) => x.id === id);
      if (!m) return;
      list.classList.remove('is-dealt');   // the rows are redrawn below, and the deal plays once
      current = m;
      looked[id] = looked[id] || { sender: false, link: false };
      const replacing = sheet.open;
      if (!replacing) stage.innerHTML = '';
      const top = layCard(m);
      if (log.has(id)) showVerdict(m, top, false);
      if (!replacing) sheet.showModal();
      if (push) history[replacing ? 'replaceState' : 'pushState']({ pm: id }, '');
      paintList();
      (top.querySelector('[data-verdict]') || top.querySelector('#pcard-h')).focus({ preventScroll: true });
    }

    function peek(which) {
      const m = current;
      const host = stage.querySelector('[data-card]:last-child');
      looked[m.id][which] = true;
      host.querySelector('[data-isle]').innerHTML = which === 'sender'
        ? (m.addr === TEXT_NAME ? isle('Sender', null, NAME_COPIED) : isle('Real sender', address(m.addr, m.root)))
        : isle('This link really goes to', address(m.link.to, m.link.root));
    }

    function answer(choice) {
      const m = current;
      if (log.has(m.id)) return;   // a double press (the buttons go at once, so this is a second line)
      log.set(m.id, { m, choice, looked: looked[m.id], second: Boolean(m.second) });
      if (!left().length && !added) {
        added = true;
        const more = secondLook([...log.values()]);
        more.forEach((x) => seen.add(x.id));
        deck.push(...more.map((x) => ({ ...x, second: true })));
      }
      paintList();
      showVerdict(m, stage.querySelector('[data-card]:last-child'), true);
    }

    function showVerdict(m, top, fresh) {
      const e = log.get(m.id);
      const said = words(m, e.choice, e.looked);
      const o = judge(m, e.choice);
      const actions = top.querySelector('[data-actions]');
      if (actions) actions.remove();
      top.classList.add('is-answered');
      top.querySelectorAll('.pask').forEach((a) => a.classList.toggle('is-bad', Boolean(m.ask.bad)));
      top.querySelectorAll('.plink').forEach((a) => a.classList.toggle('is-bad', Boolean(m.link && m.link.bad)));
      const row = (k) => {
        const t = m[k];
        const where = k === 'link' ? address(t.to, t.root) : k === 'sender' && m.addr !== TEXT_NAME ? address(m.addr, m.root) : '';
        const state = t.bad ? 'The giveaway' : t.why === NAME_COPIED ? 'Proves nothing' : 'Fine';
        return `<div class="${t.bad ? 'is-bad' : 'is-fine'}"><dt>${LABEL[k]}<span>${state}</span></dt><dd>${where ? `<code>${where}</code>` : ''}${esc(t.why)}</dd></div>`;
      };
      const rest = left();
      const label = !rest.length ? 'See how you did' : rest.every((x) => x.second) && !m.second ? 'Take a second look' : 'Next message';
      top.insertAdjacentHTML('beforeend', `
        <section class="pverdict${fresh ? ' is-fresh' : ''}${o.right ? '' : ' is-missed'}" aria-labelledby="pverdict-h">
          <span class="pseal" aria-hidden="true">${mask(o.scam ? 'scam' : 'logo')}</span>
          <h3 id="pverdict-h" tabindex="-1" data-verdict>${esc(said.h)}</h3>
          <p>${esc(said.p)}</p>
          <dl class="ptells">${TELLS.filter((k) => m[k]).map(row).join('')}</dl>
          <button type="button" class="btn btn--gold" data-next>${label}</button>
        </section>`);
      if (!fresh) return;
      const v = top.querySelector('.pverdict');
      const h = top.querySelector('[data-verdict]');
      h.focus({ preventScroll: true });
      const over = v.getBoundingClientRect().bottom - sheet.clientHeight + 16;
      if (over > 0) sheet.scrollTo({ top: sheet.scrollTop + over, behavior: still() ? 'auto' : 'smooth' });
    }

    function next() {
      const m = left()[0];
      if (m) open(m.id, true); else { sheet.close(); finish(); }
    }

    function ledger(k, s) {
      const b = s.by[k];
      const pct = b.total ? Math.round((b.spotted / b.total) * 100) : 0;
      const look = k === 'ask' ? 'Read it to the end every time.' : `You checked it on ${s.looked[k].done} of ${s.looked[k].total} messages.`;
      return `<li><span class="pledger__name">${LABEL[k]}</span>
        <span class="pledger__count">${b.total ? `Named ${b.spotted} of ${b.total}` : 'Not the giveaway this time'}</span>
        <span class="pledger__bar" aria-hidden="true"><i style="transform:scaleX(${pct / 100})"></i></span>
        <span class="pledger__look">${look}</span></li>`;
    }

    function finish() {
      const s = summary([...log.values()]);
      tray.hidden = true;
      done.hidden = false;
      done.innerHTML = `
        <div class="pdone">
          <span class="pseal" aria-hidden="true">${mask('logo')}</span>
          <h2 tabindex="-1" data-end>You reported ${s.caught} of ${s.scams} scams and left ${s.kept} of ${s.reals} real messages alone.</h2>
          <p class="pdone__work">${esc(s.advice)}</p>
          ${s.again.total ? `<p>Second look: ${s.again.right} of ${s.again.total} sorted the right way.</p>` : ''}
          <ul class="pledger">${['sender', 'link', 'ask'].map((k) => ledger(k, s)).join('')}</ul>
          <h3>Three questions for any message</h3>
          <ol class="prules">
            <li><b>Who really sent it?</b> Read the address behind the name. A name on a text can be copied, so it proves nothing.</li>
            <li><b>Where does the link really go?</b> Press and hold it, and read the end of the address.</li>
            <li><b>What does it want?</b> If it wants a code, gift cards, new bank details or money, stop. Check another way: the app, the number on your card, or a call to the person.</li>
          </ol>
          <p>A link, a deadline or a polite tone proves nothing on its own. You saw all three on both sides.</p>
          <div class="pdone__go">
            <button type="button" class="btn" data-deal>Deal a new inbox</button>
            <a class="btn btn--gold" href="${getHref}">Get Sentinel free</a>
          </div>
        </div>`;
      done.querySelector('[data-end]').focus({ preventScroll: true });
      const at = root.getBoundingClientRect().top + scrollY - 96;
      if (window.Site && Site.scrollTo) Site.scrollTo(at, false); else scrollTo(0, at);
    }

    function deal(again) {
      deck = draw(Math.random, seen).map((m) => ({ ...m }));
      seen = new Set(deck.map((m) => m.id));
      log = new Map();
      looked = {};
      added = false;
      current = null;
      tray.hidden = false;
      done.hidden = true;
      done.innerHTML = '';
      list.classList.toggle('is-dealt', again);
      paintList();
      if (again) list.querySelector('button').focus({ preventScroll: true });
    }

    list.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) open(b.dataset.open, true); });

    // A card that scrolled under the pile can take focus from the keyboard: bring it back out from under the others.
    list.addEventListener('focusin', (e) => {
      const li = e.target.closest('li');
      const pile = parseFloat(getComputedStyle(list).getPropertyValue('--pile')) || 88;
      const at = list.getBoundingClientRect().top + scrollY + [...list.children].indexOf(li) * (li.offsetHeight - 10);
      if (at - scrollY < pile && window.Site && Site.scrollTo) Site.scrollTo(at - pile, false);
    });

    stage.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.peek) peek(t.dataset.peek);
      else if (t.matches('[data-back]')) sheet.close();
      else if (t.matches('[data-fine]')) answer('fine');
      else if (t.dataset.why) answer(t.dataset.why);
      else if (t.matches('[data-next]')) next();
      else if (t.matches('[data-report]')) {
        const box = stage.querySelector('[data-card]:last-child .pwhy');
        box.hidden = !box.hidden;
        t.setAttribute('aria-expanded', String(!box.hidden));
        if (!box.hidden) { box.scrollIntoView({ block: 'nearest' }); box.querySelector('button').focus({ preventScroll: true }); }
      }
    });

    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });   // a press outside the card

    sheet.addEventListener('close', () => {
      if (history.state && history.state.pm) history.back();
      const row = current && list.querySelector(`[data-open="${current.id}"]`);
      if (row && !tray.hidden) row.focus({ preventScroll: true });
    });

    // The back button closes the message, and forward opens it again.
    addEventListener('popstate', (e) => {
      const id = e.state && e.state.pm;
      if (!id && sheet.open) sheet.close();
      else if (id && !sheet.open && !tray.hidden) open(id, false);
    });

    done.addEventListener('click', (e) => { if (e.target.closest('[data-deal]')) deal(true); });

    deal(false);
  }

  const root = document.querySelector('[data-practice]');
  if (root) mount(root);
})();
