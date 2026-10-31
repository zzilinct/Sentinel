'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { RANG, ASKS, WHO, judge } = require('../web/assets/js/callcheck.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Every answer the page can give to one person: who called who, who they claim to be, and one thing asked or none.
const everyCall = () => [undefined, ...RANG.map((r) => r.id)].flatMap((rang) => [undefined, ...WHO.map((w) => w.id)].flatMap((who) =>
  [[], ...ASKS.map((a) => [a.id])].map((asks) => ({ rang, who, asks }))));

test('call check: the page opens on a true answer, and nonsense changes nothing', () => {
  for (const r of [judge(), judge({}), judge({ rang: 'nonsense', who: 'nobody', asks: ['nonsense'] })]) {
    assert.equal(r.verdict, 'hold');
    assert.equal(r.big, 'Give them nothing yet.');
    assert.match(r.next, /allowed to hang up/);
  }
});

test('call check: no input of any kind ever says safe', () => {
  for (const c of everyCall()) {
    const r = judge(c);
    assert.ok(['hangup', 'callback', 'hold'].includes(r.verdict), JSON.stringify(c));
    assert.ok(!/\b(fine|safe to|is safe|real caller is|genuine|legit|no scam)\b/i.test(r.big + r.reason + r.next), JSON.stringify(r));
  }
  assert.ok(!/call__answer\[data-verdict="fine"\]|probably fine/.test(read('web/assets/css/app.css') + read('web/assets/js/app.js')), 'the green answer is gone');
  const css = read('web/assets/css/app.css');
  const call = css.slice(css.indexOf('.call {'), css.indexOf('@keyframes call-land-b') + 200);
  assert.ok(!/--green/.test(call), 'no green in the call check');
});

test('call check: every ask on its own says hang up, with a reason', () => {
  for (const a of ASKS) {
    const r = judge({ asks: [a.id] });
    assert.equal(r.verdict, 'hangup', a.id);
    assert.equal(r.big, 'Hang up now.');
    assert.equal(r.reason, a.reason);
    assert.match(r.next, /never one the caller gave you/);
  }
});

test('call check: the bank, police, tax office or family calling out of the blue is itself the warning', () => {
  for (const id of ['bank', 'police', 'tax', 'family']) {
    for (const rang of [undefined, 'them']) {
      const r = judge({ rang, who: id });
      assert.equal(r.verdict, 'callback', id);
      assert.equal(r.big, 'Hang up and call back.');
      assert.equal(r.next, WHO.find((w) => w.id === id).next, 'what to do next is for who they claim to be');
    }
  }
  assert.equal(judge({ who: 'microsoft' }).verdict, 'hangup', 'tech companies do not call at all');
  assert.equal(judge({ who: 'delivery' }).verdict, 'hold', 'a driver calling can be ordinary, and is not called a scam');
  assert.equal(judge({ who: 'other' }).verdict, 'hold');
  assert.equal(judge({ rang: 'them' }).verdict, 'hold');
});

test('call check: a number the person chose is safer, never cleared, and what scammers want still says hang up', () => {
  for (const w of WHO) assert.equal(judge({ rang: 'self', who: w.id }).verdict, 'hold', w.id);
  const r = judge({ rang: 'self', who: 'bank' });
  assert.match(r.reason, /cannot see who is on the line/);
  for (const a of ASKS) {
    assert.equal(judge({ rang: 'self', asks: [a.id] }).verdict, a.yours ? 'hold' : 'hangup', a.id);
    assert.equal(judge({ rang: 'them', asks: [a.id] }).verdict, 'hangup', a.id);
  }
});

test('call check: a number from a message reaches whoever sent the message', () => {
  for (const w of WHO) {
    const r = judge({ rang: 'link', who: w.id });
    assert.equal(r.verdict, 'callback', w.id);
    assert.match(r.reason, /came from the message/);
  }
  assert.equal(judge({ rang: 'link', asks: ['card'] }).verdict, 'hangup');
});

test('call check: the bank asking for a code gets the sharper reason, and the card number to call', () => {
  const r = judge({ who: 'bank', asks: ['code'] });
  assert.equal(r.verdict, 'hangup');
  assert.match(r.reason, /Your bank never asks for a code/);
  assert.match(r.next, /number on the back of your card/);
});

test('call check: the strongest ask decides, whatever order they were ticked in', () => {
  assert.equal(judge({ asks: ['secret', 'giftcards', 'remote'] }).reason, ASKS.find((a) => a.id === 'remote').reason);
});

test('call check: what was asked for leads to the matching parts of the recovery guide', () => {
  const { SITUATIONS } = require('../web/assets/js/recover.js');
  assert.deepEqual(judge({ asks: ['giftcards', 'safeaccount', 'refund', 'secret'] }).happened, ['bank', 'giftcard']);
  for (const a of ASKS) if (a.happened) assert.ok(SITUATIONS.some((s) => s.id === a.happened), a.happened);
});

test('call check: calm house style, no em dashes, and words short enough to stay on a phone screen', () => {
  const words = [...RANG.map((r) => r.label), ...ASKS.flatMap((a) => [a.label, a.reason]), ...WHO.flatMap((w) => [w.label, w.doubt || '', w.next || ''])];
  for (const c of everyCall()) { const r = judge(c); words.push(r.big, r.reason, r.next); assert.ok(r.reason.length + r.next.length <= 220, r.reason + r.next); }
  for (const w of words) assert.ok(!/—/.test(w), w);
});
