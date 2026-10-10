'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { ASKS, WHO, judge } = require('../web/assets/js/callcheck.js');

test('call check: nothing ticked, no answer yet', () => {
  assert.equal(judge([], []), null);
  assert.equal(judge(), null);
  assert.equal(judge(['nonsense'], ['nobody']), null);
});

test('call check: every ask on its own says hang up, with a reason', () => {
  for (const a of ASKS) {
    const r = judge([a.id], []);
    assert.equal(r.verdict, 'hangup', a.id);
    assert.equal(r.reason, a.reason);
    assert.match(r.next, /never one the caller gave you/);
  }
});

test('call check: who they say they are, with nothing asked, is probably fine, except Microsoft', () => {
  for (const w of WHO) {
    const r = judge([], [w.id]);
    assert.equal(r.verdict, w.id === 'microsoft' ? 'hangup' : 'fine', w.id);
    assert.ok(r.next.includes(w.next), 'what to do next is for who they claim to be');
  }
});

test('call check: the bank asking for a code gets the sharper reason, and the card number to call', () => {
  const r = judge(['code'], ['bank']);
  assert.equal(r.verdict, 'hangup');
  assert.match(r.reason, /Your bank never asks for a code/);
  assert.match(r.next, /number on the back of your card/);
});

test('call check: the strongest ask decides, whatever order they were ticked in', () => {
  assert.equal(judge(['secret', 'giftcards', 'remote'], []).reason, ASKS.find((a) => a.id === 'remote').reason);
});

test('call check: what was asked for leads to the matching parts of the recovery guide', () => {
  const { SITUATIONS } = require('../web/assets/js/recover.js');
  assert.deepEqual(judge(['giftcards', 'safeaccount', 'refund', 'secret'], []).happened, ['bank', 'giftcard']);
  for (const a of ASKS) if (a.happened) assert.ok(SITUATIONS.some((s) => s.id === a.happened), a.happened);
});

test('call check: calm house style, no em dashes', () => {
  const words = [...ASKS.flatMap((a) => [a.label, a.reason]), ...WHO.flatMap((w) => [w.label, w.next])];
  for (const w of words) assert.ok(!/—/.test(w), w);
});
