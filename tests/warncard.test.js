'use strict';
/**
 * Warn a friend (web/assets/js/warncard.js): every word on the card is written so no app can make it a link again.
 * The picture itself is checked in a real browser by scripts/verify-web.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../web/assets/js/warncard.js');

const ADDRESSES = [
  'https://paypa1-secure-login.com/account/verify?email=alex@example.com#step2',
  'http://usps-redeliver.top/pay',
  'HTTPS://WWW.Example.CO.UK/login',
  'www.amaz0n-refund.net/claim',
  'ezpass-toll-pay.com/x',
  'https://paypal.com@evil-host.top/',
  'http://192.168.10.20:8080/admin',
  'https://xn--pypal-4ve.com/',
  'https://pаypal.com/',
  'support@paypa1-help.com',
  'ftp://files.scam-host.ru/a.exe',
  'example。com and example．com'
];

test('defang breaks every address, and linkable no longer finds one', () => {
  for (const a of ADDRESSES) {
    assert.ok(W.linkable(a), `the test needs ${a} to be linkable before`);
    const d = W.defang(a);
    assert.ok(!W.linkable(d), `${a} -> ${d}`);
  }
  assert.equal(W.defang('https://paypa1-secure-login.com/account'), 'hxxps://paypa1-secure-login[.]com/account');
  assert.equal(W.defang('support@paypa1-help.com'), 'support[@]paypa1-help[.]com');
  assert.equal(W.defang('A fee of $1.99, e.g. now. Pay today.'), 'A fee of $1[.]99, e.g. now. Pay today.');
});

test('the link on the card shows where it leads, without the query or the person\'s own details', () => {
  assert.equal(W.shortLink('https://paypa1-secure-login.com/account/verify?email=alex@example.com#x'), 'hxxps://paypa1-secure-login[.]com/account/verify');
  assert.equal(W.shortLink('https://paypal.com@evil-host.top/'), 'hxxps://evil-host[.]top', 'the real host, not the decoy before the @');
  assert.equal(W.shortLink('ezpass-toll-pay.com/x'), 'hxxps://ezpass-toll-pay[.]com/x');
  assert.ok(W.shortLink(`https://a.top/${'x'.repeat(200)}`).length < 80);
});

test('every word on a card from a link, an email, a text and a QR code is safe to share', () => {
  const cards = [
    W.fromVerdict({ kind: 'url', url: 'https://paypa1-secure-login.com/login?u=me@example.com', reasons: [{ text: 'paypa1-secure-login.com is on a threat list.' }, { text: 'Looks like paypal.com.' }] },
      { tone: 'red', threat: 'scam', title: 'This is a confirmed scam' }),
    W.fromVerdict({ kind: 'email', sender: { address: 'service@paypa1-help.com' }, links: [{ url: 'https://ok.example.org/', overall: { badge: null } }, { url: 'http://bad.top/x', overall: { badge: 'red' } }], reasons: [{ text: 'The sender is not paypal.com.' }] },
      { tone: 'orange', threat: 'scam', title: 'This is likely a scam' }),
    W.fromText({ flag: { title: 'An unpaid toll text', detail: 'Toll agencies do not text links like usps-pay.top.' }, links: [{ url: 'https://ezpass-toll-pay.com/x', badge: null }] }, '+1 415 555 0199', 'orange'),
    W.fromQr({ tone: 'red', title: 'A sign-in code', detail: 'It signs a phone in to your account at web.whatsapp.com.' })
  ];
  assert.equal(cards[1].link, 'http://bad.top/x', 'an email card carries its flagged link');
  assert.equal(W.words(cards[0]).what, 'Do not open this link or type anything on it.');
  assert.equal(W.words(cards[2]).what, 'A text message with this link. Do not open it, reply or pay.');
  for (const c of cards) {
    const w = W.words(c);
    const all = [w.label, w.title, w.what, w.link, w.from, w.why, ...w.tells, w.foot, W.text(c)].filter(Boolean);
    for (const s of all) {
      assert.ok(!W.linkable(s), s);
      assert.ok(!s.includes('—'), `no em dash: ${s}`);
    }
    assert.ok(!/me@example|u=me/.test(W.text(c)), 'never the query');
  }
});
