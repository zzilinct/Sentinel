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
const CREDENTIAL_ASK = /(verify your (account|identity)|confirm your (password|account|details)|update your (payment|billing)|log ?in to (restore|avoid|keep)|re-?enter your|validate your (account|mailbox)|mailbox (is )?(full|quota))/i;
const MONEY_ASK = /(gift cards?|wire transfer|bitcoin|usdt|crypto(currency)? wallet|western union|moneygram|processing fee|release (the|your) funds|inheritance|beneficiary|lottery)/i;
const GENERIC_GREETING = /^(\s*)(dear (customer|user|client|member|account holder|valued customer|sir\/madam|friend)|hello (customer|user)|dear [a-z0-9._%+-]+@)/i;
const THREAT = /(legal action|arrest|police|lawsuit|will be (closed|terminated|deleted)|permanently (disabled|deleted)|report you)/i;
const QR = /(scan (the|this) qr|qr code (below|attached))/i;
const ARCHIVE_PASSWORD = /(password|pwd|pass)\s*[:=]\s*\S{3,}/i;

function parseAddress(raw) {
  const s = String(raw || '').trim();
  const m = /^(.*?)<\s*([^>]+)\s*>$/.exec(s);
  const name = (m ? m[1] : '').replace(/^["'\s]+|["'\s]+$/g, '');
  const address = (m ? m[2] : s).toLowerCase();
  const domain = address.includes('@') ? address.split('@').pop() : '';
  return { name, address, domain };
}

function brandIn(text) {
  const lower = String(text || '').toLowerCase();
  const words = new Set(lower.split(/[^a-z0-9]+/));
  return L.PROTECTED_BRANDS.find((b) => (b.token.length >= 5 ? lower.includes(b.token) : words.has(b.token))) || null;
}

/**
 * @param {object} mail
 * @returns {{checks: object[], links: string[], sender: object}}
 */
function analyzeEmail(mail) {
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
  const claimed = brandIn(from.name) || brandIn(subject);

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
    return replyTo.domain !== from.domain ? fail(22, `Replies are redirected to ${replyTo.address}`) : pass('Same domain');
  })());

  add('E04', 'scam', 'A company is not writing from a free mailbox', (() => {
    if (!L.FREE_MAIL_PROVIDERS.has(from.domain)) return pass('Not a free mailbox');
    return claimed || /bank|support|security|billing|invoice|account/i.test(from.name)
      ? fail(26, `"${from.name}" writing from a free ${from.domain} address`) : pass('Personal mailbox');
  })());

  add('E05', 'scam', 'Subject is not built to rush you', URGENT_SUBJECT.test(subject) ? warn(10, `"${subject.slice(0, 80)}"`) : pass('Calm subject'));
  add('E06', 'scam', 'Does not ask you to confirm login or payment details', CREDENTIAL_ASK.test(body) ? fail(24, 'Asks you to verify or re-enter account details') : pass('No credential request'));
  add('E07', 'scam', 'Does not ask for untraceable payment', MONEY_ASK.test(body) || MONEY_ASK.test(subject) ? fail(26, 'Mentions gift cards, crypto, wire transfers or release fees') : pass('No payment demand'));
  add('E08', 'scam', 'Addresses you personally', GENERIC_GREETING.test(body) ? warn(6, 'Generic greeting') : pass('No generic greeting'));
  add('E09', 'scam', 'No threats of closure or legal action', THREAT.test(body) ? warn(12, 'Threatens consequences if you do not act') : pass('No threats'));

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
  add('E12', 'scam', 'No QR code phishing lure', QR.test(body) ? warn(14, 'Asks you to scan a QR code - a way to move you off a protected computer') : pass('None'));

  const risky = attachments.filter((n) => { const x = n.toLowerCase().split('.'); return x.length > 1 && (L.EXECUTABLE_EXT.has(x.pop()) ); });
  add('E13', 'virus', 'No program attachments', risky.length ? fail(45, `Attached program: ${risky[0]}`) : pass(attachments.length ? `${attachments.length} attachment(s), none programs` : 'No attachments'));

  const doubled = attachments.filter((n) => { const x = n.toLowerCase().split('.'); return x.length > 2 && L.DOC_EXT.has(x[x.length - 2]) && (L.EXECUTABLE_EXT.has(x[x.length - 1]) || L.ARCHIVE_EXT.has(x[x.length - 1])); });
  add('E14', 'virus', 'No disguised attachment names', doubled.length ? fail(50, `"${doubled[0]}" hides its real type`) : pass('Honest names'));

  const macro = attachments.filter((n) => L.MACRO_DOC_EXT.has(n.toLowerCase().split('.').pop()));
  const html = attachments.filter((n) => /\.(html?|shtml|svg)$/i.test(n));
  add('E15', 'malware', 'No macro documents or HTML attachments', macro.length
    ? fail(34, `Macro-enabled document: ${macro[0]}`)
    : html.length ? fail(30, `HTML/SVG attachment ${html[0]} - often a hidden login page`) : pass('None'));

  const archived = attachments.some((n) => L.ARCHIVE_EXT.has(n.toLowerCase().split('.').pop()));
  add('E16', 'malware', 'No password-protected archive trick', archived && ARCHIVE_PASSWORD.test(body)
    ? fail(40, 'Sends an archive together with its password - used to hide malware from scanners') : pass('None'));

  add('E17', 'scam', 'Invoice lure does not pair with a risky attachment',
    /invoice|receipt|payment advice|remittance|purchase order/i.test(subject + ' ' + body) && (risky.length || macro.length || html.length || archived)
      ? fail(20, 'Invoice-themed message with a risky attachment') : pass('No invoice lure'));

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
