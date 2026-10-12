'use strict';
/**
 * Who really sent an email, from the headers pasted with it. The receiving mail service (Gmail, Outlook) checks every
 * message it takes in and writes what it found at the top (Authentication-Results); Received-SPF, DKIM-Signature and
 * Return-Path fill gaps. Only the pasted text is read: nothing is looked up.
 */
const { analyze } = require('./url');

/** The headers in pasted text, folded lines joined: [[lower-case name, value]], in order. */
function readHeaders(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (cur && /^[ \t]/.test(line)) { cur[1] += ` ${line.trim()}`; continue; }
    const m = /^([A-Za-z0-9-]+)[ \t]*:[ \t]*(.*)$/.exec(line);
    cur = m ? [m[1].toLowerCase(), m[2].trim()] : null;
    if (cur) out.push(cur);
  }
  return out;
}

const site = (d) => (analyze(`https://${d}`) || {}).registrable || d;

// Mail services that send only for a From address or domain the sender proved is theirs: a club's newsletter through
// Mailchimp, a school app through Amazon SES, a small business on Google Workspace or Microsoft 365 that never set up
// its own signature. Passed for one of these only, the mail is not a forgery, it just does not prove more.
const SERVICES = ['mcsv.net', 'mailchimpapp.net', 'rsgsv.net', 'mandrillapp.com', 'sendgrid.net', 'amazonses.com', 'mailgun.org',
  'sparkpostmail.com', 'mtasv.net', 'mailjet.com', 'sendinblue.com', 'brevosend.com', 'klaviyomail.com', 'createsend.com',
  'ccsend.com', 'hubspotemail.net', 'mktomail.com', 'exacttarget.com', 'gappssmtp.com', 'onmicrosoft.com'];
const serviceOf = (d) => SERVICES.find((s) => d === s || d.endsWith(`.${s}`));
/** The domain in an address or a bare domain: "<bounce@mailer.example.ru>" is mailer.example.ru. */
const domainOf = (s) => String(s || '').replace(/[<>"\s]/g, '').split('@').pop().toLowerCase().replace(/\.$/, '');

/** One Authentication-Results value: { dmarc: { result, domain }, spf: { result, domain }, dkim: [{ result, domain }] }. */
function readResults(value) {
  const out = { dmarc: null, spf: null, dkim: [] };
  // Comments in brackets ("(google.com: domain of ...)") say nothing the results do not.
  for (const part of String(value).replace(/\([^()]*\)/g, ' ').split(';')) {
    const m = /^\s*(dmarc|spf|dkim)\s*=\s*([a-z]+)/i.exec(part);
    if (!m) continue;
    const prop = (name) => { const p = new RegExp(`\\b${name.replace('.', '\\.')}\\s*=\\s*"?([^\\s;"]+)`, 'i').exec(part); return p ? domainOf(p[1]) : ''; };
    const r = { result: m[2].toLowerCase(), domain: '' };
    const kind = m[1].toLowerCase();
    if (kind === 'dmarc') { r.domain = prop('header.from'); out.dmarc = out.dmarc || r; }
    if (kind === 'spf') { r.domain = prop('smtp.mailfrom') || prop('smtp.helo'); out.spf = out.spf || r; }
    if (kind === 'dkim') { r.domain = prop('header.d') || prop('header.i'); out.dkim.push(r); }
  }
  return out;
}

/**
 * Whether the message really came from the domain in its From line.
 * @returns {null|{status: 'really'|'not'|'unknown', domain: string, cameFrom: string, checksFailed: boolean, text: string}}
 *   null when no header that proves anything was pasted.
 */
function senderProof(headers, fromDomain) {
  const h = readHeaders(headers);
  const all = (name) => h.filter(([k]) => k === name).map(([, v]) => v);
  const ar = all('authentication-results');
  const spfHeader = all('received-spf');
  if (!ar.length && !spfHeader.length) return null;
  const domain = String(fromDomain || '').toLowerCase();
  if (!domain) return null;
  // The topmost is written by the service that received the message for you; any below it came with the message,
  // and a scammer can write those.
  const res = ar.length ? readResults(ar[0]) : { dmarc: null, spf: null, dkim: [] };
  if (!res.spf && spfHeader.length) {
    const v = spfHeader[0];
    const env = /envelope-from\s*=\s*"?([^\s;"]+)/i.exec(v) || /domain of\s+(\S+)/i.exec(v);
    res.spf = { result: (/^\s*([a-z]+)/i.exec(v) || [, ''])[1].toLowerCase(), domain: env ? domainOf(env[1]) : '' };
  }
  // A passed DKIM result that does not name its domain: the signature's own d= says whose it is.
  const signed = all('dkim-signature').map((v) => (/\bd\s*=\s*([^\s;]+)/i.exec(v) || [])[1]).filter(Boolean).map(domainOf);
  res.dkim.forEach((k, i) => { if (!k.domain) k.domain = signed[i] || signed[0] || ''; });
  const returnPath = domainOf(all('return-path')[0] || '');
  if (res.spf && !res.spf.domain) res.spf.domain = returnPath;

  const mine = (d) => Boolean(d) && site(d) === site(domain);
  const passed = [...res.dkim, res.spf].filter((r) => r && r.result === 'pass' && r.domain);
  const proof = (status, cameFrom = '', checksFailed = false, via = '') => ({ status, domain, cameFrom, checksFailed,
    text: status === 'really' ? `Really sent by ${domain}`
      : via ? `Sent for ${domain} through ${via}`
      : status === 'unknown' ? `The headers do not prove whether ${domain} sent it`
        : cameFrom ? `Not sent by ${domain}: it came from ${cameFrom}` : `Not sent by ${domain}: it failed the checks ${domain} set up` });

  if ((res.dmarc && res.dmarc.result === 'pass' && (!res.dmarc.domain || mine(res.dmarc.domain))) || passed.some((r) => mine(r.domain))) return proof('really');
  const elsewhere = [...passed.map((r) => r.domain), returnPath].find((d) => d && !mine(d)) || '';
  const failed = (res.dmarc && /^(fail|reject|quarantine)$/.test(res.dmarc.result))
    || [...res.dkim, res.spf].some((r) => r && /^(fail|softfail)$/.test(r.result) && mine(r.domain));
  // A mailing list the reader joined, passed for the list's own domain. Its footer breaks the author's signature, so
  // DMARC fails, and a domain whose owner asked for nothing to be done about that (p=none) is not forged by it.
  const list = domainOf((/<([^>]+)>/.exec(all('list-id')[0] || '') || [])[1] || '');
  const viaList = list && passed.find((r) => site(r.domain) === site(list));
  const lax = /\bdmarc\s*=\s*fail\s*\(\s*p\s*=\s*none\b/i.test(ar[0] || '') && ![...res.dkim, res.spf].some((r) => r && /^(fail|softfail)$/.test(r.result) && mine(r.domain));
  if (failed && !(lax && viaList)) return proof('not', elsewhere, true);
  if (viaList) return proof('unknown', viaList.domain, false, `the mailing list ${viaList.domain}`);
  if (passed.length && passed.every((r) => serviceOf(r.domain))) return proof('unknown', serviceOf(passed[0].domain), false, `the mail service ${serviceOf(passed[0].domain)}`);
  // Passed for another domain only: the message proves where it came from, and that is not here.
  if (passed.length) return proof('not', elsewhere);
  return proof('unknown');
}

module.exports = { readHeaders, senderProof };
