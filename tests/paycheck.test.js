'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const research = require('../server/lib/scan/research');
const { payCheck, isCheckout, ago } = require('../server/lib/scan/paycheck');

const DAY = 24 * 60 * 60 * 1000;
const at = Date.now();
research.setTestFacts('fresh-sneaker-deals.example', { registration: { available: true, registered: true, createdAt: at - 21 * DAY } });
research.setTestFacts('old-corner-bookshop.example', { registration: { available: true, registered: true, createdAt: at - 9 * 365 * DAY } });

test('a checkout is known by its address: checkout, Shopify checkouts, cart/payment, pay', () => {
  for (const u of ['https://shop.example/checkout', 'https://shop.example/checkout/', 'https://shop.example/checkouts/cn/abc?step=pay',
    'https://shop.example/cart/payment', 'https://shop.example/en/pay/123']) assert.ok(isCheckout(u), u);
  for (const u of ['https://shop.example/', 'https://shop.example/cart', 'https://shop.example/paypal-info', 'https://shop.example/payday-sale',
    'https://shop.example/?checkout=1', 'not a url']) assert.ok(!isCheckout(u), u);
});

test('a young shop\'s checkout gets the card, with how long ago it was registered', () => {
  const pay = payCheck('https://fresh-sneaker-deals.example/checkout', { at });
  assert.equal(pay.young, true);
  assert.equal(pay.days, 21);
  assert.equal(pay.text, 'This shop\'s address was registered 3 weeks ago. Pay with a credit card or PayPal, not a bank transfer, gift card or crypto, so you can get your money back.');
  assert.ok(!/—/.test(pay.text), 'no em dashes');
});

test('a shop whose age is not known gets nothing (no card at every small shop), and neither does an old one', () => {
  assert.equal(payCheck('https://never-seen-store.example/checkout', { at }), null);
  assert.equal(payCheck('https://old-corner-bookshop.example/checkout', { at }), null);
});

test('a delicate scan\'s own lookup is used when there is one', () => {
  const verdict = { overall: { badge: null }, research: { registeredAt: at - 3 * DAY } };
  assert.match(payCheck('https://never-seen-store.example/checkout', { verdict, at }).text, /registered 3 days ago/);
  const old = { overall: { badge: null }, research: { registeredAt: at - 800 * DAY } };
  assert.equal(payCheck('https://never-seen-store.example/checkout', { verdict: old, at }), null);
});

test('big brands, verified sites and the person\'s own sites never get it', () => {
  assert.equal(payCheck('https://www.amazon.com/checkout/p/xyz', { at }), null);
  assert.equal(payCheck('https://www.ebay.co.uk/pay/123', { at }), null);
  assert.equal(payCheck('https://never-seen-store.example/checkout', { verdict: { overall: { badge: null }, knowledge: { trusted: true } }, at }), null);
  assert.equal(payCheck('https://never-seen-store.example/checkout', { mine: () => true, at }), null);
});

test('only at a checkout, and a flagged page keeps its own warning instead', () => {
  assert.equal(payCheck('https://fresh-sneaker-deals.example/', { at }), null);
  assert.ok(payCheck('https://fresh-sneaker-deals.example/order/review', { checkout: true, at }), 'the title said checkout (decided on the device)');
  for (const badge of ['red', 'orange']) assert.equal(payCheck('https://fresh-sneaker-deals.example/checkout', { verdict: { overall: { badge } }, at }), null, badge);
  assert.ok(payCheck('https://fresh-sneaker-deals.example/checkout', { verdict: { overall: { badge: 'yellow' } }, at }));
});

test('ages read naturally', () => {
  assert.deepEqual([0, 1, 5, 13, 14, 21, 59, 60, 200, 364].map(ago),
    ['today', '1 day ago', '5 days ago', '13 days ago', '2 weeks ago', '3 weeks ago', '8 weeks ago', '2 months ago', '6 months ago', '12 months ago']);
});
