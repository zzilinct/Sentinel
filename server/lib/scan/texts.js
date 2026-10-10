'use strict';
/**
 * Text messages, as Phone Link shows them on a Windows computer. Many scams arrive by text: unpaid tolls, parcel
 * fees, "Hi Mum, this is my new number", task jobs, "your account is locked, verify here". This judges one message
 * on the computer it is on (desktop/src/chatwatch.js loads this file directly): no message is sent anywhere, stored,
 * or logged. Links in a message are returned so the app can check their addresses the way it checks copied links.
 *
 * A text is read like a short email with no sender address: the email rules for payment demands, callbacks, tolls,
 * parcel fees, task jobs and requests for private details all apply (server/lib/scan/email.js), and a few tricks
 * that only texts use are added here. Wording alone stays careful: one urgent word is never enough.
 */
const { analyzeEmail } = require('./email');

// "Hi Mum, this is my new number": a child or relative on a "new phone" who soon needs money.
const NEW_NUMBER = /\b(new (number|phone|mobile|cell)|lost my phone|(broke|dropped|smashed) my phone|my (old )?phone (broke|is broken|is dead|died|got stolen)|this is my number now|save (this|my) (new )?number)\b/i;
const FAMILY = /\b(hi|hey|hello|hiya)\s+(mum|mom|mam|mommy|mummy|dad|daddy|papa|grandma|grandpa|nan|nana|auntie|aunt|uncle)\b|\b(it'?s|its|this is) (me|your (son|daughter|kid|child|grandson|granddaughter))\b/i;
// A currency sign has no word edge before it, so it sits outside the \b group.
const MONEY_NEED = /\b(send|transfer|pay|lend|borrow|need)\b[^.!?]{0,50}(\b(money|cash|bill|rent|payment|funds)\b|[$£€])|\b(bank details|account number|sort code)\b/i;
// "Is this Linda?" from a stranger: how investment ("pig butchering") scams open a conversation.
const WRONG_NUMBER = /^\s*([Hh]i|[Hh]ello|[Hh]ey|[Gg]ood (morning|afternoon|evening))?[\s,!.]*([Ii]s this|[Aa]re you|[Ii]s that)\s+(mr\.?|mrs\.?|ms\.?|miss\s+)?[A-Z][a-z]{2,15}( [A-Z][a-z]{2,15})?\s*\??\s*$/;
// The trick that turns on a link Apple or Google disabled for an unknown sender. "Reply Y to activate text alerts" is
// how real sign-ups read, so it takes the link itself, or reopening the message, not just "activate".
const REPLY_TO_LINK = /\breply\b[^.!?]{0,20}["'(]?\b(y|yes|1)\b["')]?[^.!?]{0,80}\b(link|reopen|re-open|open (this|the) (message|text|sms) again|exit)\b/i;
// A parcel held for an address that needs "updating" through a link: the redelivery scam without a fee.
const PARCEL_ADDRESS = /\b(package|parcel|shipment|delivery|item)\b[^]{0,100}\b(could ?n[o']?t|unable to|can ?n[o']?t|failed to|was not|has not been)\b[^]{0,40}\bdeliver[^]{0,120}\b(update|confirm|verify|correct)\b[^.!?]{0,20}\b(address|details|information)\b/i;
// An account, card or access said to be in trouble.
const ACCOUNT_TROUBLE = /\b(account|card|access|apple ?id|profile|payment)\b[^.!?]{0,50}\b(locked|suspended|on hold|restricted|disabled|deactivated|blocked|compromised|unusual|suspicious)\b/i;

/** Who a text is from, as Phone Link shows it: a saved contact's name, a number, a short code, or an email address. */
function senderKind(from) {
  const s = String(from || '').trim();
  if (!s) return 'unknown';
  if (/@/.test(s)) return 'email';
  const digits = s.replace(/[\s().+-]/g, '');
  if (/^\d{4,6}$/.test(digits)) return 'shortcode';
  if (/^\d{7,15}$/.test(digits)) return 'number';
  return 'contact';
}

const ADVICE = {
  danger: 'Do not tap the link, reply, call the number or pay. If it says it is from a company or an agency, open its app or type its address yourself. If you already did, call your bank or card issuer now.',
  warn: 'Do not tap the link or reply until you are sure who sent it. A company or an agency can be reached through its own app or website, not through a text.',
  family: 'Call them on the number you already have for them before you send anything. Family on a "new number" who soon need money is a well known text scam.',
  stranger: 'If you do not know them, do not reply. A friendly chat that starts with a wrong number often turns into an investment pitch.'
};

/**
 * One text message: is it a scam, and which links in it should be checked?
 * @param {{ from?: string, text: string }} m
 * @returns {{ flag: null | { level: 'warn'|'danger', family: 'scam', title: string, detail: string, advice: string }, links: string[] }}
 */
function judgeText(m) {
  const text = String((m && m.text) || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  const from = String((m && m.from) || '').trim().slice(0, 80);
  if (!text) return { flag: null, links: [] };
  const kind = senderKind(from);
  const known = kind === 'contact';

  // Texts carry bare addresses ("usps-redelivery.top/x"): those are links too.
  const bare = (text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,24}\/[^\s]*/gi) || []).filter((u) => !/^https?:/i.test(u)).map((u) => `https://${u}`);
  const mail = analyzeEmail({ fromName: known ? from : '', subject: text.slice(0, 160), body: `${text} ${bare.join(' ')}` });
  const links = mail.links.slice(0, 10);

  const found = [];   // { points, detail }
  for (const c of mail.checks) {
    if (c.threat !== 'scam' || (c.status !== 'fail' && c.status !== 'warn')) continue;
    let points = c.points;
    // A short code is a business's own sending number: its "call us about this charge" and "confirm your card" texts are
    // how real bank alerts read. Noted, never decisive.
    // Toll agencies text balances from their own short codes too.
    if (kind === 'shortcode' && (c.id === 'E21' || c.id === 'E06' || c.id === 'E09' || c.id === 'E25')) points = Math.min(points, 10);
    // The email rule speaks of a sender's address: a text has a number.
    const detail = c.id === 'E25' ? `Demands an unpaid toll or fine by text from ${kind === 'number' || kind === 'shortcode' ? 'a phone number' : from || 'an unknown sender'}: toll agencies and courts ask you to pay on their own website or app` : c.detail;
    found.push({ points, fail: c.status === 'fail', detail });
  }
  if (REPLY_TO_LINK.test(text)) found.push({ points: 44, fail: true, detail: 'Asks you to reply so a blocked link starts working: the phone hides links from unknown senders for a reason' });
  if (PARCEL_ADDRESS.test(text) && links.length) found.push({ points: 40, fail: true, detail: 'Says a parcel could not be delivered and sends you to a link to update your address: the redelivery scam' });
  if (ACCOUNT_TROUBLE.test(text) && links.length && !known) found.push({ points: 30, fail: true, detail: 'Says your account or card is in trouble and sends you to a link' });

  // `words`: judged on what the message says to do, which no link check can make safer.
  let special = null;
  if (NEW_NUMBER.test(text) && (FAMILY.test(text) || MONEY_NEED.test(text))) {
    const money = MONEY_NEED.test(text);
    special = {
      words: true, level: money ? 'danger' : 'warn', title: 'Someone may be pretending to be family',
      detail: money ? 'Says they are family on a new number and asks for money.' : 'Says they are family on a new number.',
      advice: ADVICE.family
    };
  } else if (!known && kind !== 'shortcode' && WRONG_NUMBER.test(text)) {
    special = { words: true, level: 'warn', title: 'A stranger starting a conversation', detail: 'A message meant for someone else, sent to you. Many investment and romance scams start this way.', advice: ADVICE.stranger };
  }

  const strongest = found.reduce((a, b) => (b.fail && b.points > (a ? a.points : 0) ? b : a), null);
  const total = found.reduce((a, b) => a + b.points, 0);
  const level = strongest && strongest.points >= 40 ? 'danger' : (strongest && strongest.points >= 24) || total >= 30 ? 'warn' : null;
  let flag = null;
  if (level) {
    const top = (strongest || found.slice().sort((a, b) => b.points - a.points)[0]).detail;
    flag = { level, family: 'scam', title: level === 'danger' ? 'This text looks like a scam' : 'This text may be a scam', detail: `${top}.`.replace(/\.\.$/, '.'), advice: ADVICE[level] };
  }
  if (special && (!flag || (special.level === 'danger' && flag.level !== 'danger'))) flag = { family: 'scam', ...special };
  return { flag, links };
}

/**
 * A text's flag after its links were checked: a link the threat lists or the rules call dangerous makes the text
 * dangerous too, with the link's own reason. When every link is one Sentinel knows to be the real site (its trusted
 * list), a warning that came from the wording is lowered one step: a real toll agency or bank texting a link to its own
 * site. `verdicts`: what /api/v1/live/batch returned for the text's links.
 */
function withLinks(result, verdicts) {
  const all = Object.values(verdicts || {});
  let worst = null;
  for (const v of all) {
    const badge = v && v.overall && v.overall.badge;
    if (badge !== 'red' && badge !== 'orange') continue;
    if (!worst || (badge === 'red' && worst.badge !== 'red')) worst = { badge, v };
  }
  if (!worst) {
    const f = result.flag;
    const real = all.length > 0 && all.length >= result.links.length && all.every((v) => v && v.knowledge && v.knowledge.trusted === true);
    if (!f || f.words || !real) return f;
    return f.level === 'danger' ? { ...f, level: 'warn', title: 'This text may be a scam', advice: ADVICE.warn } : null;
  }
  const level = worst.badge === 'red' ? 'danger' : 'warn';
  if (result.flag && (result.flag.level === 'danger' || level === 'warn')) return result.flag;
  const reason = (worst.v.reasons && worst.v.reasons[0] && worst.v.reasons[0].text) || worst.v.overall.label || 'Flagged by Sentinel';
  return { level, family: 'scam', title: level === 'danger' ? 'This text links to a dangerous site' : 'This text links to a risky site', detail: `${worst.v.host || 'The link'}: ${reason}`, advice: ADVICE[level] };
}

module.exports = { judgeText, withLinks, senderKind, WRONG_NUMBER };
