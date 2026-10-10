'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { MESSAGES, KINDS, parse, clueOrder, score, closing } = require('../web/assets/js/practice.js');

test('practice: marks split into plain and marked pieces, in order', () => {
  assert.deepEqual(parse('Pay {{fee:£1.45}} now'), [{ text: 'Pay ' }, { text: '£1.45', clue: 'fee' }, { text: ' now' }]);
  assert.deepEqual(parse('{{a:x}}{{b:y}}'), [{ text: 'x', clue: 'a' }, { text: 'y', clue: 'b' }]);
  assert.deepEqual(parse('no marks'), [{ text: 'no marks' }]);
  assert.deepEqual(parse(undefined), []);
});

test('practice: twelve messages, a mix of scams and real ones, in every kind', () => {
  assert.equal(MESSAGES.length, 12);
  assert.equal(new Set(MESSAGES.map((m) => m.id)).size, 12, 'ids are unique');
  const scams = MESSAGES.filter((m) => m.scam).length;
  assert.ok(scams >= 5 && scams <= 8, `a mix, not ${scams} scams`);
  for (const kind of Object.keys(KINDS)) assert.ok(MESSAGES.some((m) => m.kind === kind), `no ${kind}`);
  for (const kind of Object.keys(KINDS)) assert.ok(MESSAGES.some((m) => m.kind === kind && m.scam), `no scam ${kind}`);
  assert.ok(MESSAGES.some((m) => m.kind === 'dm' && m.scam) && MESSAGES.some((m) => m.kind === 'dm' && !m.scam), 'a Discord scam and a real Discord message');
});

test('practice: every clue is marked in its message and explained, and every mark has its clue', () => {
  for (const m of MESSAGES) {
    const order = clueOrder(m);
    assert.deepEqual([...order].sort(), Object.keys(m.clues).sort(), `${m.id}: marks and clues differ`);
    assert.ok(order.length >= 2, `${m.id}: at least two clues`);
    for (const c of Object.values(m.clues)) assert.ok(c.label && c.why, `${m.id}: a clue without words`);
    assert.ok(!/\{\{|\}\}/.test(parse(m.body).map((p) => p.text).join('')), `${m.id}: a mark that did not parse`);
    if (m.kind === 'email') assert.ok(m.subject && m.address, `${m.id}: an email has a subject and an address`);
  }
});

test('practice: clues are numbered in reading order, sender first', () => {
  const signin = MESSAGES.find((m) => m.id === 'signin');
  assert.deepEqual(clueOrder(signin), ['sender', 'threat', 'button', 'link']);
});

test('practice: the score counts what was sorted right, and only answered ones as missed', () => {
  const all = (pick) => Object.fromEntries(MESSAGES.map((m) => [m.id, pick(m)]));
  assert.deepEqual(score(all((m) => (m.scam ? 'scam' : 'real'))), { right: 12, total: 12, missed: [] });
  const scams = MESSAGES.filter((m) => m.scam).length;
  const s = score(all(() => 'scam'));
  assert.equal(s.right, scams);
  assert.deepEqual(s.missed, MESSAGES.filter((m) => !m.scam).map((m) => m.id));
  assert.deepEqual(score({}), { right: 0, total: 12, missed: [] });
});

test('practice: the closing words never shame, and every score has some', () => {
  for (let right = 0; right <= 12; right++) {
    const line = closing(right, 12);
    assert.ok(line.length > 20);
    assert.doesNotMatch(line, /\b(fail|failed|bad|wrong|poor|only)\b/i, `${right}: ${line}`);
  }
  assert.notEqual(closing(12, 12), closing(5, 12));
});

test('practice: made-up messages with nothing to click, plain words, no em dashes', () => {
  const text = MESSAGES.flatMap((m) => [m.from, m.address, m.subject, m.body, m.context, ...Object.values(m.clues).flatMap((c) => [c.label, c.why])]).filter(Boolean).join('\n');
  assert.ok(!text.includes('—'), 'no em dashes');
  assert.doesNotMatch(text, /https?:\/\/|www\./i, 'no address written as a link a page could make clickable');
  assert.doesNotMatch(text, /<[a-z]/i, 'no markup in the messages');
  // Phone numbers only from the ranges kept for drama, so none rings a real person.
  for (const n of text.match(/\+\d[\d ()]{8,}/g) || []) assert.match(n, /^\+44 7700 900\d{3}$|^\+1 \(555\) 01\d\d$/, n);
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'practice.html'), 'utf8');
  assert.ok(!page.includes('—') && !page.includes('&mdash;'), 'no em dashes on the page');
  assert.match(page, /<script src="\/assets\/js\/practice\.js"><\/script>/);
  assert.equal((page.match(/<h1[\s>]/g) || []).length, 1);
});
