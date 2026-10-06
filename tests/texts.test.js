'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { judgeText, withLinks, senderKind } = require('../server/lib/scan/texts');

// Texts people really get from businesses, friends and family: none of them may be flagged.
const ORDINARY = [
  ['72166', 'Your Chase verification code is 123456. Do not share it with anyone.'],
  ['Amazon', 'Amazon: your package was delivered. Track at https://www.amazon.com/progress'],
  ['Mom', 'can you pick me up at 5'],
  ['227898', 'Chase Fraud Alert: Did you attempt a $52.10 purchase at Target? Reply YES or NO. STOP to end'],
  ['+1 555 201 3344', 'Reminder: your appointment with Dr Smith is tomorrow at 3pm. Reply C to confirm'],
  ['Dave', 'hey are we still on for dinner? call me at 555-201-3344'],
  ['Sarah', 'Is this Mike?'],
  ['+1 917 555 0101', 'Hi, this is Sarah from Dr Lee\'s office, can you call us back about Tuesday?'],
  ['DoorDash', 'Your DoorDash order is on the way'],
  ['+44 7700 900123', 'Your table for 4 at 7pm is confirmed. Reply CANCEL to cancel']
];

// Scam texts, and the level each must get.
const SCAMS = [
  ['usps fee', '+1 (415) 555-0199', 'USPS: Your package is on hold due to an unpaid redelivery fee of $1.99. Pay at https://usps-redeliver.top/pay', 'danger'],
  ['toll', '+1 (415) 555-0199', 'Final notice: you have an unpaid toll balance of $6.99. Pay now at https://ezpass-toll-pay.com to avoid fees', 'danger'],
  ['new number, money', '+44 7700 900123', 'Hi Mum, this is my new number, my phone broke. Can you send me money for a bill today?', 'danger'],
  ['new number', '+44 7700 900123', 'Hi mum its me, lost my phone, this is my new number', 'warn'],
  ['wrong number', '+1 917 555 0101', 'Hello, is this Jessica?', 'warn'],
  ['callback', '+1 917 555 0101', 'Your Norton subscription renewed for $399.99. If you did not authorize this charge call 1-888-555-0123 to cancel', 'danger'],
  ['task job', '+1 917 555 0101', 'Earn $300-$800 daily rating products from home. Message me on WhatsApp', 'danger'],
  ['locked account', '+1 917 555 0101', 'Your Apple ID has been locked due to suspicious activity. Verify at http://apple-id-verify.co', 'warn'],
  ['reply Y', '+1 917 555 0101', 'Please reply Y, then exit the message and reopen it to activate the link', 'danger'],
  ['parcel address', '+1 917 555 0101', 'Your package could not be delivered due to an incomplete address. Please update your address at https://pkg-track-help.com', 'danger']
];

test('ordinary texts are left alone', () => {
  for (const [from, text] of ORDINARY) assert.equal(judgeText({ from, text }).flag, null, `${from}: ${text}`);
});

test('scam texts are flagged at their level, with plain words and no em dashes', () => {
  for (const [name, from, text, level] of SCAMS) {
    const { flag } = judgeText({ from, text });
    assert.ok(flag, name);
    assert.equal(flag.level, level, name);
    for (const s of [flag.title, flag.detail, flag.advice]) assert.doesNotMatch(s, /—/, name);
  }
});

test('links in a text are returned for checking, bare addresses included', () => {
  assert.deepEqual(judgeText({ from: '+1 415 555 0199', text: 'Pay your toll at ezpass-pay.top/x today' }).links, ['https://ezpass-pay.top/x']);
  assert.deepEqual(judgeText({ from: 'Mom', text: 'dinner at 6' }).links, []);
});

test('who a text is from', () => {
  assert.equal(senderKind('72166'), 'shortcode');
  assert.equal(senderKind('+1 (415) 555-0199'), 'number');
  assert.equal(senderKind('Mom'), 'contact');
  assert.equal(senderKind('alerts@example.com'), 'email');
});

test('a dangerous link makes a quiet text dangerous; a clear link changes nothing', () => {
  const r = judgeText({ from: '+1 415 555 0199', text: 'Your order is ready, details at https://shop-orders.top/a' });
  assert.equal(r.flag, null);
  assert.equal(withLinks(r, { 'https://shop-orders.top/a': { host: 'shop-orders.top', overall: { badge: null } } }), null);
  const red = withLinks(r, { 'https://shop-orders.top/a': { host: 'shop-orders.top', overall: { badge: 'red', label: 'Confirmed scam' }, reasons: [{ text: 'Listed as phishing' }] } });
  assert.equal(red.level, 'danger');
  assert.match(red.detail, /shop-orders\.top: Listed as phishing/);
  const orange = withLinks(r, { x: { host: 'h', overall: { badge: 'orange', label: 'Likely scam' } } });
  assert.equal(orange.level, 'warn');
});
