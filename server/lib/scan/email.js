'use strict';
/**
 * Email checklist. Works on what a mail client shows: sender, reply-to,
 * subject, body text, links and attachment names. Link targets go through the
 * full URL pipeline separately; this module covers the message itself.
 */
const L = require('./lists');
const { analyze, brandInfo, hostWords } = require('./url');

const fail = (points, detail) => ({ status: 'fail', points, detail });
const warn = (points, detail) => ({ status: 'warn', points, detail });
const pass = (detail, points = 0) => ({ status: 'pass', points, detail });
const skip = (detail) => ({ status: 'skip', points: 0, detail });

const URGENT_SUBJECT = /(urgent|immediately|action required|final notice|suspended|locked|verify|unusual (sign-?in|activity)|payment (failed|declined)|overdue|expires? today|last chance|security alert|confirm your)/i;
const CREDENTIAL_ASK = /(verify your (account|identity)|confirm your (online )?(banking )?(password|account|details|information)|update your (payment|billing)|log ?in to (restore|avoid|keep)|re-?enter your|validate your (account|mailbox)|mailbox (is )?(full|quota))/i;
// A request to pay in a way that cannot be undone, not the words alone: a Coinbase price alert says "bitcoin", an
// insurance letter says "beneficiary", a store sells gift cards.
// Not a receipt ("your purchase of an Apple Gift Card") or a gift someone sent ("redeem your gift card code").
const MONEY_ASK = /((pay|send|buy|deposit|transfer)\b.{0,40}\b(gift ?cards?|bitcoin|btc|usdt|ethereum|crypto(currency)?|western union|moneygram|wire transfer)|gift ?cards?\b.{0,40}\b(scratch|photos?|pictures?)|\b(send|share|text|email|read)\b[^.]{0,40}\b(gift ?card|card) (codes?|pins?|numbers?)|(processing|release|clearance|unlock|handling) fee|release (the|your) funds|inheritance (funds|claim|transfer)|next of kin|lottery (win|winner|prize)|you have won)/i;
const GENERIC_GREETING = /^(\s*)(dear (customer|user|client|member|account holder|valued customer|sir\/madam|friend)|hello (customer|user)|dear [a-z0-9._%+-]+@)/i;
const THREAT = /(legal action against you|arrest warrant|lawsuit against you|report you to|(account|mailbox|profile|card|subscription|access)\b.{0,60}\b(will be|to be|is being) (closed|terminated|suspended|deleted|disabled|locked)|permanently (disabled|deleted|locked))/i;
const QR = /(scan (the|this) qr|qr code (below|attached))/i;
// Told to pay WITH gift cards, crypto or a wire transfer (not a receipt for buying a gift card): "pay the $299 fee with
// Google Play gift cards", "send 0.1 BTC", "send us the codes".
const PAY_UNTRACEABLY = /\b(pay|send|transfer|deposit)\b[^.!?]{0,60}\b(with|in|using|via|by)\b[^.!?]{0,30}\b(gift ?cards?|google play|itunes|steam cards?|bitcoin|btc|ethereum|crypto(currency)?|usdt|wire transfer|western union|moneygram)\b|\bsend\b[^!?]{0,15}?\b\d+(\.\d+)?\s*(btc|eth|usdt|bitcoin)\b|\b(send|share|give)\b[^.!?]{0,30}\b(card )?(codes|pins)\b/i;
// A sender presenting as a company, an agency, support or a prize desk.
const AUTHORITY = /\b(irs|internal revenue|tax (refund|office|department)|social security|medicare|government|federal|police|sheriff|court|customs|support( team)?|security (team|department|center)|help ?desk|billing (team|department)|account (team|services)|lottery|giveaway|prize|claims? department)\b/i;
// A fee to release a parcel. USPS never emails or texts asking for one; other couriers do bill customs duties.
const PARCEL_FEE = /\b(re-?delivery|redeliver|delivery|shipping|postage|customs|parcel|package)\b[^.!?]{0,60}\b(fee|charge)\b|\b(fee|charge)\b[^.!?]{0,60}\b(parcel|package|redelivery|delivery)\b/i;
const COURIER = /\b(ups|fedex|dhl|royal mail|canada post|auspost|evri|hermes|courier|postal|post office|delivery)\b/i;
// A number to call about a charge, a refund, a virus or a cut-off: the callback scam ("your Norton renewal of $399 was
// charged, call +1-8xx to cancel"). Real companies send you to your account, not to a phone number, for these.
const PHONE = /(\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const CALLBACK_REASON = /\b(refund|cancel|renew(al|ed)?|auto-?renew|charged|unauthori[sz]ed|dispute|infected|virus|trojan|spyware|hacked|disconnect(ed|ion)?|shut ?off|suspend(ed)?|locked)\b/i;
// "Reply with your Social Security number and bank account": nobody legitimate asks for these in a reply.
const SENSITIVE_REPLY = /\b(reply|send|email|text)\b[^.!?]{0,40}\b(social security|ssn|bank (details|account|information)|account number|routing number|copy of your (id|passport|driver'?s licen[cs]e)|passport|password|pin)\b/i;
// The boss who is "in a meeting" and needs gift cards bought, or a confidential wire sent today (business email compromise).
const FAVOR = /\b(gift ?cards?)\b[\s\S]{0,160}\b(client|asap|meeting|can'?t talk|quick(ly)?|favou?r|today|how many)\b|\b(wire|bank) transfer\b[\s\S]{0,160}\b(confidential|don'?t discuss|new vendor|today|urgent(ly)?|bank details)\b/i;
// Money for a stranger's journey, or a fortune waiting to be claimed.
const STRANGER_MONEY = /\b(help|lend|send|need)\b[^.!?]{0,40}\b(small amount|money|funds)\b[^.!?]{0,40}\b(flight|ticket|visa|hospital|customs|travel)\b|\b(estate|inheritance)\b[\s\S]{0,200}\b(unclaimed|sum of|million)\b|\bunclaimed\b[\s\S]{0,200}\b(estate|inheritance|next of kin)\b/i;
// Unpaid tolls and traffic fines demanded by email: toll agencies and courts write from their own or .gov addresses.
const TOLL_FINE = /\b(unpaid|outstanding|overdue)\b[^.!?]{0,30}\btolls?\b|\btoll (balance|notice|violation|invoice)\b|\btraffic (violation|citation|ticket|fine)\b|\b(dmv|motor vehicles?)\b[^.!?]{0,60}\b(fine|citation|fee|suspend)/i;
const OFFICIAL_NAME =/\b(bank|support|security|billing|invoice|account|hr|human resources|recruit(ment|er|ing)?|careers?|payroll|windows|defender|microsoft|apple|amazon|irs|revenue|power|utility|electric|water|gas company|dept|department|office|police|court|customs)\b/i;
const ARCHIVE_PASSWORD =/(password|pwd|pass)\s*[:=]\s*\S{3,}/i;

function parseAddress(raw) {
  const s = String(raw || '').trim();
  // Only a name, no address (what an inbox list shows: "PayPal Support Team"). It used to be taken for an address,
  // leaving the name empty, so a preview's sender never counted as claiming a brand.
  if (!s.includes('@') && !s.includes('<')) return { name: s.replace(/^["'\s]+|["'\s]+$/g, ''), address: '', domain: '' };
  const m = /^(.*?)<\s*([^>]+)\s*>$/.exec(s);
  const name = (m ? m[1] : '').replace(/^["'\s]+|["'\s]+$/g, '');
  const address = (m ? m[2] : s).toLowerCase();
  const domain = address.includes('@') ? address.split('@').pop() : '';
  return { name, address, domain };
}

/**
 * A brand named in a sender name or subject: as a word, or at the start of one ("PayPalSupport"), never inside
 * another word ("purchase" is not Chase, "pineapple" is not Apple). In a subject the name must also be written as a
 * name, capitalised: "Weekly market outlook" is about markets, "Your Outlook storage is full" is about Outlook.
 */
function brandIn(text, { asName = false } = {}) {
  const raw = String(text || '');
  const single = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  // Names written as several words ("Bank of America", "Wells Fargo") are compared joined up, as the brand is listed.
  const words = [...single];
  for (let i = 0; i < single.length; i++) for (let n = 2; n <= 3 && i + n <= single.length; n++) words.push(single.slice(i, i + n).join(''));
  return L.PROTECTED_BRANDS.find((b) => words.some((w) => {
    const lower = w.toLowerCase();
    const hit = lower === b.token || (b.token.length >= 5 && lower.startsWith(b.token));
    return hit && (!asName || /^[A-Z0-9]/.test(w));
  })) || null;
}

/**
 * @param {object} mail
 * @param {{preview?: boolean}} [how] preview: what an inbox list shows (sender name, subject, a line of text), with
 *   no sender address and no links. Checks that need those are skipped, not guessed.
 * @returns {{checks: object[], links: string[], sender: object}}
 */
function analyzeEmail(mail, how = {}) {
  const from = parseAddress(mail.from || (mail.fromName ? `${mail.fromName} <${mail.fromAddress || ''}>` : mail.fromAddress));
  const replyTo = mail.replyTo ? parseAddress(mail.replyTo) : null;
  const subject = String(mail.subject || '').slice(0, 500);
  const body = String(mail.body || '').slice(0, 20000);
  const links = (Array.isArray(mail.links) ? mail.links : []).slice(0, 60).filter(l => l && typeof l === 'object');
  // The API and mailbox previews may provide plain text without parsed anchors.
  for (let href of body.match(/https?:\/\/[^\s<>"']+/gi) || []) {
    href = href.replace(/[.,;!?]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']']]) {
      while (href.endsWith(close) && href.split(close).length > href.split(open).length) href = href.slice(0, -1);
    }
    links.push({ href, text: '' });
  }
  const targets = [...new Set(links.map(l => analyze(String(l.href || ''))?.url).filter(Boolean))];
  const attachments = (Array.isArray(mail.attachments) ? mail.attachments : []).map(String).slice(0, 30);
  const checks = [];
  const add = (id, threat, title, result) => checks.push({ id, threat, group: 'Email', title, ...result });

  const senderUrl = from.domain ? analyze(`https://${from.domain}`) : null;
  const senderBrand = senderUrl ? brandInfo(senderUrl) : { official: null };
  // A company's own address naming another company in the subject ("Receipt for your payment to Spotify" from
  // paypal.com) is not claiming to be it: only the sender's name counts then.
  const claimed = brandIn(from.name) || (senderBrand.official ? null : brandIn(subject, { asName: true }));

  add('E01', 'scam', 'Sender name matches the sending domain', (() => {
    if (!claimed) return pass('Sender does not claim a brand');
    if (!from.domain) return skip('No sender address');
    const official = claimed.domains.some((d) => from.domain === d || from.domain.endsWith('.' + d));
    return official ? pass(`Really from ${from.domain}`) : fail(38, `Claims to be ${claimed.token} but was sent from ${from.domain}`);
  })());

  add('E02', 'scam', 'Sending domain is not a brand look-alike', (() => {
    if (!senderUrl) return skip('No sender domain');
    if (senderBrand.official) return pass('Official brand domain');
    if (senderBrand.lookalike) return fail(44, `${from.domain} imitates ${senderBrand.lookalike.domains[0]}`);
    if (senderBrand.inDomain) return fail(34, `${from.domain} borrows the ${senderBrand.inDomain.token} name`);
    if (senderBrand.inSubdomain) return fail(34, `${from.domain} plants ${senderBrand.inSubdomain.token} in a subdomain`);
    return pass('No look-alike');
  })());

  add('E03', 'scam', 'Replies go back to the sender', (() => {
    if (!replyTo || !replyTo.domain) return skip('No separate reply-to');
    // The same company's own addresses (news@email.nytimes.com replying to help@nytimes.com) are one sender.
    const site = (d) => (analyze(`https://${d}`) || {}).registrable || d;
    return site(replyTo.domain) !== site(from.domain) ? fail(22, `Replies are redirected to ${replyTo.address}`) : pass('Same organisation');
  })());

  add('E04', 'scam', 'A company is not writing from a free mailbox', (() => {
    if (!L.FREE_MAIL_PROVIDERS.has(from.domain)) return pass('Not a free mailbox');
    return claimed || OFFICIAL_NAME.test(from.name) || AUTHORITY.test(from.name)
      ? fail(26, `"${from.name}" writing from a free ${from.domain} address`) : pass('Personal mailbox');
  })());

  // Sent from the brand's own domain (as the mail provider delivered it): "verify", "security alert", "confirm
  // your account" are how Google, Canva or a bank write to their own users. Those words say nothing more there.
  const fromOfficial = Boolean(from.domain && (senderBrand.official || (claimed && claimed.domains.some((d) => from.domain === d || from.domain.endsWith('.' + d)))));
  const wording = (check) => (fromOfficial && check.status !== 'pass' ? pass(`Sent from ${from.domain}: ${check.detail}`) : check);
  add('E05', 'scam', 'Subject is not built to rush you', wording(URGENT_SUBJECT.test(subject) ? warn(10, `"${subject.slice(0, 80)}"`) : pass('Calm subject')));
  add('E06', 'scam', 'Does not ask you to confirm login or payment details', wording(CREDENTIAL_ASK.test(subject + ' ' + body)
    // A preview has no sender address to hold the request against: noted, never decisive on its own.
    ? (how.preview ? warn(12, 'Asks you to verify or re-enter account details') : fail(24, 'Asks you to verify or re-enter account details'))
    : pass('No credential request')));
  // Gift cards, crypto, wire transfers, "release fees": the one request a real company never makes by email. Weighted to
  // mark on its own, even in an inbox preview.
  add('E07', 'scam', 'Does not ask for untraceable payment', MONEY_ASK.test(body) || MONEY_ASK.test(subject) ? fail(44, 'Asks for payment in gift cards, crypto, a wire transfer or a release fee') : pass('No payment demand'));
  add('E08', 'scam', 'Addresses you personally', wording(GENERIC_GREETING.test(body) ? warn(6, 'Generic greeting') : pass('No generic greeting')));
  add('E09', 'scam', 'No threats of closure or legal action', wording(THREAT.test(subject + ' ' + body) ? warn(12, 'Threatens your account or legal consequences if you do not act') : pass('No threats')));

  const mismatched = links.filter((l) => {
    const shown = /(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}/i.exec(String(l.text || ''));
    if (!shown) return false;
    const a = analyze(shown[0]);
    const b = analyze(String(l.href || ''));
    return a && b && a.registrable !== b.registrable;
  });
  add('E10', 'scam', 'Links go where they say they go', mismatched.length
    ? fail(30, `Link text shows ${String(mismatched[0].text).slice(0, 40)} but opens ${(analyze(mismatched[0].href) || {}).host}`)
    : pass(links.length ? `${links.length} link(s) checked` : 'No links'));

  const shortLinks = links.filter((l) => { const a = analyze(String(l.href || '')); return a && L.URL_SHORTENERS.has(a.registrable); });
  add('E11', 'scam', 'Links are not disguised with shorteners', shortLinks.length ? warn(12, `${shortLinks.length} shortened link(s)`) : pass('None'));
  add('E12', 'scam', 'No QR code phishing lure', QR.test(body) ? warn(14, 'Asks you to scan a QR code: a way to move you off a protected computer') : pass('None'));

  const risky = attachments.filter((n) => { const x = n.toLowerCase().split('.'); return x.length > 1 && (L.EXECUTABLE_EXT.has(x.pop()) ); });
  add('E13', 'virus', 'No program attachments', risky.length ? fail(45, `Attached program: ${risky[0]}`) : pass(attachments.length ? `${attachments.length} attachment(s), none programs` : 'No attachments'));

  const doubled = attachments.filter((n) => { const x = n.toLowerCase().split('.'); return x.length > 2 && L.DOC_EXT.has(x[x.length - 2]) && (L.EXECUTABLE_EXT.has(x[x.length - 1]) || L.ARCHIVE_EXT.has(x[x.length - 1])); });
  add('E14', 'virus', 'No disguised attachment names', doubled.length ? fail(50, `"${doubled[0]}" hides its real type`) : pass('Honest names'));

  const macro = attachments.filter((n) => L.MACRO_DOC_EXT.has(n.toLowerCase().split('.').pop()));
  const html = attachments.filter((n) => /\.(html?|shtml|svg)$/i.test(n));
  add('E15', 'malware', 'No macro-enabled documents', macro.length ? fail(34, `Macro-enabled document: ${macro[0]}`) : pass('None'));
  // A web page sent as a file opens a sign-in form from your own computer, where no address bar can give it away.
  add('E27', 'scam', 'No web page sent as an attachment', html.length ? fail(34, `HTML/SVG attachment ${html[0]}: often a hidden login page`) : pass('None'));

  const archived = attachments.some((n) => L.ARCHIVE_EXT.has(n.toLowerCase().split('.').pop()));
  add('E16', 'malware', 'No password-protected archive trick', archived && ARCHIVE_PASSWORD.test(body)
    ? fail(40, 'Sends an archive together with its password: used to hide malware from scanners') : pass('None'));

  add('E17', 'scam', 'Invoice lure does not pair with a risky attachment',
    /invoice|receipt|payment advice|remittance|purchase order/i.test(subject + ' ' + body) && (risky.length || macro.length || html.length || archived)
      ? fail(38, 'Invoice-themed message with a risky attachment') : pass('No invoice lure'));

  // What the message asks you to do, whoever sent it: a scam needs no link when it can get you to call, reply or pay.
  // Not softened for a company's own address: scammers send real PayPal invoices that carry their phone number.
  const text = `${subject} ${body}`;
  add('E21', 'scam', 'Does not push you to call a number about a charge', (() => {
    if (!PHONE.test(text) || !/\bcall\b|\bphone\b|toll.?free/i.test(text) || !CALLBACK_REASON.test(text)) return pass('No callback request');
    // "Your computer is infected, call us": no real company or antivirus sends that, from any address.
    if (/\b(infected|virus|trojan|spyware|hacked)\b/i.test(text)) return fail(44, 'Says your computer is infected and asks you to phone a number: the tech-support scam');
    // Banks write "if you did not make this charge, call us": from their own address that is a real alert. Only an
    // invoice or money request sent through it (scammers send real PayPal invoices carrying their number) counts.
    if (fromOfficial) return /\binvoice\b|money request|payment request/i.test(text) ? fail(44, `An invoice sent through ${from.domain} that asks you to phone a number to cancel or get a refund: the callback scam`) : pass(`Sent from ${from.domain}`);
    if (how.preview) return warn(14, 'Asks you to phone a number about a charge or refund');
    return fail(44, 'Asks you to phone a number about a charge, refund or cut-off: the callback scam');
  })());
  add('E22', 'scam', 'Does not ask for private details by reply', SENSITIVE_REPLY.test(text)
    ? fail(44, 'Asks you to send your ID, bank details, Social Security number or password') : pass('No request for private details'));
  add('E23', 'scam', 'Not an urgent favour with gift cards or a wire', FAVOR.test(text)
    ? fail(44, 'An urgent, private favour involving gift cards or a wire transfer: how impostors of a boss or colleague work') : pass('No favour request'));
  add('E25', 'scam', 'No toll or fine demanded from an unofficial address', (() => {
    if (!TOLL_FINE.test(text) || !/\bpay|payment|settle\b/i.test(text)) return pass('No toll or fine demand');
    const gov = /\.gov(\.[a-z]{2})?$|\.us$/.test(from.domain || '');
    if (fromOfficial || gov) return pass(`Sent from ${from.domain}`);
    return fail(44, `Demands an unpaid toll or fine, but writes from ${from.domain || 'an unknown address'}: toll agencies and courts use their own addresses`);
  })());
  add('E24', 'scam', 'No stranger asking for money or offering a fortune', STRANGER_MONEY.test(text)
    ? fail(44, 'Asks for money for travel, or offers an unclaimed fortune') : pass('None'));

  // What no real company or agency does: an inbox preview has no sender address, but "Apple Support" or "IRS Tax
  // Refund Department" telling you to pay in gift cards or crypto needs none.
  const presentsAs = claimed ? `${claimed.token} (as "${from.name || subject.slice(0, 40)}")` : (AUTHORITY.test(from.name) || AUTHORITY.test(subject)) ? `"${from.name || subject.slice(0, 40)}"` : null;
  add('E19', 'scam', 'Nobody official asks for untraceable payment', wording(PAY_UNTRACEABLY.test(subject + ' ' + body) && presentsAs
    ? fail(40, `Presents as ${presentsAs} and asks to be paid in gift cards, crypto or a wire transfer: no real company or agency does`)
    : pass('No official-looking payment demand')));

  add('E20', 'scam', 'No fee to release a parcel', wording((() => {
    const text = subject + ' ' + body;
    if (!PARCEL_FEE.test(text) || !/\b(pay|settle|payment|required|due)\b/i.test(text)) return pass('No parcel fee');
    const usps = (claimed && claimed.token === 'usps') || /\b(usps|postal service)\b/i.test(from.name + ' ' + subject);
    if (usps) return fail(70, 'Claims to be USPS and asks for a delivery fee: USPS never emails or texts to charge one');
    return COURIER.test(from.name + ' ' + subject) ? warn(18, 'Asks for a fee to release a parcel') : pass('No courier fee');
  })()));

  add('E18', 'scam', 'Sender domain is not freshly invented',
    senderUrl && hostWords(senderUrl.sld).size >= 3 && /-/.test(senderUrl.sld) && !senderBrand.official
      ? warn(8, `${from.domain} is a stitched-together multi-word domain`) : pass('Ordinary sender domain'));

  return {
    checks,
    sender: { name: from.name, address: from.address, domain: from.domain },
    links: targets.slice(0, 60),
    linksTruncated: targets.length > 60 || (Array.isArray(mail.links) && mail.links.length > 60) || mail.linksTruncated === true,
    senderUrl: senderUrl ? senderUrl.url : null
  };
}

module.exports = { analyzeEmail };
