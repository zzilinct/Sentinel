'use strict';
// "Check something on screen": what was read in the box the person drew, judged (desktop/src/snip.js). The window and
// the screen copy need a real desktop: scripts/desktop-e2e.ps1 proves those.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../desktop/scripts/sync-shared.js');
const snip = require('../desktop/src/snip.js');
const { judge } = snip;

const SCAM = 'USPS: Your package is on hold due to an unpaid redelivery fee of $1.99. Pay at https://usps-redeliver.top/pay\nQuestions? Call +1 (876) 555-0142';
const QR_LINK = 'https://paypa1-secure-login.com/account';
const red = (host, reason) => ({ ok: true, host, overall: { badge: 'red', label: 'Phishing' }, reasons: [{ text: reason }] });
const clean = (host, trusted) => ({ ok: true, host, overall: { badge: null, label: 'No threats found' }, reasons: [], knowledge: { trusted } });

test('a scam text with a link, a callback number and a QR code: every part is a finding', () => {
  const r = judge(SCAM, [QR_LINK]);
  assert.equal(r.level, 'danger');
  assert.equal(r.title, 'This looks like a scam');
  assert.deepEqual(r.links, ['https://usps-redeliver.top/pay', QR_LINK]);
  assert.equal(r.pending, true);
  const kinds = r.findings.map((f) => `${f.kind}:${f.level}`);
  assert.ok(kinds.includes('message:danger'), kinds.join());
  assert.ok(kinds.includes('phone:danger'), kinds.join());
  assert.ok(r.findings.find((f) => f.kind === 'phone').title.includes('876'));
  assert.equal(r.findings.filter((f) => f.kind === 'link' && f.level === 'pending').length, 2);
  assert.match(r.findings.find((f) => f.title.includes('paypa1')).title, /^The QR code leads to/);
  assert.ok(r.advice);

  const checked = judge(SCAM, [QR_LINK], { [QR_LINK]: red('paypa1-secure-login.com', 'Listed as phishing'), 'https://usps-redeliver.top/pay': clean('usps-redeliver.top', false) });
  assert.equal(checked.pending, false);
  const qr = checked.findings.find((f) => f.title.includes('paypa1'));
  assert.equal(qr.level, 'danger');
  assert.equal(qr.title, 'The QR code leads to a dangerous site: paypa1-secure-login.com');
  assert.equal(qr.detail, 'Listed as phishing');
});

test('nothing read: says so, and suggests a larger box', () => {
  assert.equal(judge('', []).level, 'empty');
  assert.equal(judge('  \n ', [null]).level, 'empty');
});

test('an ordinary message with a phone number is not a scam, and the number is only noted', () => {
  const r = judge('Dentist reminder: your appointment is tomorrow at 3pm. To change it, call 555-201-3344.', []);
  assert.equal(r.level, 'safe');
  assert.equal(r.title, 'Nothing dangerous found');
  assert.deepEqual(r.findings.map((f) => `${f.kind}:${f.level}`), ['phone:info']);
});

test('a phone number in a message that looks like a scam: do not call it', () => {
  const r = judge('Your Norton subscription renewed for $399.99. If you did not authorize this charge call 1-888-555-0123 to cancel', []);
  assert.equal(r.level, 'danger');
  assert.equal(r.findings.find((f) => f.kind === 'phone').level, 'warn');
});

test('a bare run of digits is a phone number only next to phone words', () => {
  assert.deepEqual(snip._test.phoneNumbers('Order 2125550199 shipped'), []);
  assert.deepEqual(snip._test.phoneNumbers('Call 2125550199 now'), ['2125550199']);
});

test('QR codes that are not links are explained: a sign-in code is dangerous', () => {
  const r = judge('', ['https://discord.com/ra/abc123']);
  assert.equal(r.level, 'danger');
  assert.equal(r.findings[0].kind, 'qr');
  assert.match(r.findings[0].title, /Discord sign-in code/);
  assert.deepEqual(r.links, []);
});

test('a warning from the wording is lowered when every link is the real site', () => {
  const text = 'E-ZPass: you have an unpaid toll balance of $6.99. Pay now at https://www.e-zpassny.com/pay';
  const before = judge(text, []);
  assert.ok(before.level === 'danger' || before.level === 'warn', before.level);
  const after = judge(text, [], { 'https://www.e-zpassny.com/pay': clean('www.e-zpassny.com', true) });
  assert.ok(after.level === 'warn' || after.level === 'safe');
  assert.notEqual(after.findings.find((f) => f.kind === 'message')?.level, 'danger');
});

test('links that could not be checked say why', () => {
  const r = judge('See https://example.com/a', [], {}, "Sentinel's scanner could not be reached");
  const f = r.findings.find((x) => x.kind === 'link');
  assert.equal(f.level, 'info');
  assert.match(f.detail, /^Not checked: Sentinel's scanner could not be reached\.$/);
  assert.equal(r.pending, false);
});

test('pixels for the QR reader are RGBA', () => {
  const image = { getSize: () => ({ width: 1, height: 1 }), toBitmap: () => Buffer.from([1, 2, 3, 255]) };
  const px = snip._test.rgba(image);
  assert.deepEqual([...px.data], process.platform === 'win32' ? [3, 2, 1, 255] : [1, 2, 3, 255]);
});

test('the shortcut is not Ctrl+Shift+S by default, and every choice has words', () => {
  assert.notEqual(snip.DEFAULT_KEY, 'Control+Shift+S');
  assert.ok(snip.KEYS[snip.DEFAULT_KEY]);
  for (const label of Object.values(snip.KEYS)) assert.doesNotMatch(label, /—/);
});
