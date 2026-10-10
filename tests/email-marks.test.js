'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeEmail, markHost } = require('../server/lib/scan/email');

// Each finding says where it is in the email (field, start, end), so the app can mark it in the text itself.
const marked = (mail, id) => {
  const c = analyzeEmail(mail).checks.find((x) => x.id === id);
  assert.ok(c, `${id} ran`);
  assert.ok(c.status === 'fail' || c.status === 'warn', `${id} found something: ${c.status} ${c.detail}`);
  assert.ok(c.marks && c.marks.length, `${id} says where`);
  const fields = { from: mail.from, replyTo: mail.replyTo, subject: mail.subject, body: mail.body, attachments: (mail.attachments || []).join(', ') };
  return c.marks.map((m) => { assert.ok(m.end > m.start && m.start >= 0, `${id} span ${m.start}-${m.end}`); return [m.field, fields[m.field].slice(m.start, m.end)]; });
};

const SCAM = {
  from: 'PayPal Security <alerts.paypal.security@gmail.com>',
  replyTo: '  recovery@paypal-account-verify.com ',
  subject: 'URGENT: Your account has been suspended',
  body: 'Dear customer,\n\nWe detected unusual activity. Verify your account within 24 hours or your account will be permanently disabled.\n'
    + 'Sign in at www.paypal.com <https://paypal-account-verify.com/login> to keep access.\n'
    + 'To avoid closure, pay the $200 release fee with Google Play gift cards and send us the codes.',
  attachments: ['notes.txt', 'Account_Statement.pdf.exe']
};

test('the urgent line is marked in the subject', () => {
  assert.deepEqual(marked(SCAM, 'E05'), [['subject', 'URGENT']]);
});

test('the sender name that is not the address is marked on the name', () => {
  assert.deepEqual(marked(SCAM, 'E01'), [['from', 'PayPal Security']]);
  assert.deepEqual(marked(SCAM, 'E04'), [['from', 'gmail.com']]);
});

test('a reply-to that differs is marked, without the spaces round it', () => {
  assert.deepEqual(marked(SCAM, 'E03'), [['replyTo', 'recovery@paypal-account-verify.com']]);
});

test('a link whose words and address differ is marked from its words to its address', () => {
  assert.deepEqual(marked(SCAM, 'E10'), [['body', 'www.paypal.com <https://paypal-account-verify.com/login']]);
});

test('the gift card ask, the request for details and the greeting are marked in the body', () => {
  const [[field, text]] = marked(SCAM, 'E07');
  assert.equal(field, 'body');
  assert.match(text, /gift cards/);
  assert.deepEqual(marked(SCAM, 'E06'), [['body', 'Verify your account']]);
  assert.deepEqual(marked(SCAM, 'E08'), [['body', 'Dear customer']]);
  assert.match(marked(SCAM, 'E09')[0][1], /permanently disabled/);
});

test('a program attachment is marked where it sits among the attachment names', () => {
  assert.deepEqual(marked(SCAM, 'E13'), [['attachments', 'Account_Statement.pdf.exe']]);
  assert.deepEqual(marked(SCAM, 'E14'), [['attachments', 'Account_Statement.pdf.exe']]);
});

test('a shortened link given separately is found in the body by its address', () => {
  const mail = { from: 'Friend <a@example.org>', subject: 'look', body: 'see this: bit.ly/3xYz ok', links: [{ href: 'https://bit.ly/3xYz', text: '' }] };
  assert.deepEqual(marked(mail, 'E11'), [['body', 'bit.ly/3xYz']]);
});

test('passed checks carry no marks, and a clean email has none at all', () => {
  const clean = analyzeEmail({ from: 'GitHub <noreply@github.com>', subject: 'Your weekly digest', body: 'Hi Ada, here is what is trending. https://github.com/trending' });
  assert.equal(clean.checks.filter((c) => c.marks).length, 0);
  const scam = analyzeEmail(SCAM);
  for (const c of scam.checks) if (c.marks) assert.ok(c.status === 'fail' || c.status === 'warn', c.id);
});

test('a plain-text link with its words before it now counts as a mismatched link', () => {
  const c = analyzeEmail({ from: 'x <a@example.org>', subject: 'hi', body: 'Open paypal.com (https://evil.example/login) now' }).checks.find((x) => x.id === 'E10');
  assert.equal(c.status, 'fail');
  const same = analyzeEmail({ from: 'x <a@example.org>', subject: 'hi', body: 'Open github.com (https://github.com/login) now' }).checks.find((x) => x.id === 'E10');
  assert.equal(same.status, 'pass');
});

test('markHost marks the whole address in the body, or the sender, or nothing', () => {
  const mail = { from: 'Bank <a@bad-bank.example>', body: 'Go to <https://login.bad-bank.example/x?y=1> today' };
  const [b] = markHost(mail, 'login.bad-bank.example');
  assert.equal(mail.body.slice(b.start, b.end), 'https://login.bad-bank.example/x?y=1');
  const [f] = markHost({ from: mail.from, body: 'nothing' }, 'bad-bank.example');
  assert.deepEqual([f.field, mail.from.slice(f.start, f.end)], ['from', 'bad-bank.example']);
  assert.deepEqual(markHost(mail, 'elsewhere.example'), []);
  assert.deepEqual(markHost(mail, ''), []);
});
