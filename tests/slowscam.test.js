'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { judgeConversation } = require('../server/lib/scan/slowscam');

// Written examples of the slow scams, the way people paste them.
const WRONG_NUMBER_TO_CRYPTO = [
  '[10/6/26, 09:12] +1 917 555 0101: Hi, is this Linda?',
  '[10/6/26, 09:40] Me: No, sorry, wrong number',
  '[10/6/26, 09:41] +1 917 555 0101: Oh I am so sorry! You seem kind though. I am Amy, I live in Singapore.',
  '[10/7/26, 10:02] +1 917 555 0101: I rarely use this app, add me on WhatsApp so we can keep talking',
  '[10/9/26, 20:15] +1 917 555 0101: My uncle is a financial analyst, he taught me crypto trading. I made $4,000 profit last week on a trading platform.',
  '[10/9/26, 20:16] +1 917 555 0101: I can teach you how to invest, start small'
].join('\n');

const ROMANCE_EMERGENCY = [
  'Daniel: Good morning my dear, did you sleep well?',
  'Me: I did! When can we video call?',
  'Daniel: I am working on an oil rig, we are not allowed to video call here',
  'Daniel: Something terrible happened, my account is frozen and I need to pay the customs fee for my equipment',
  'Daniel: Can you send me $2,500? I will pay you back when I am home'
].join('\n');

const OPENER_THEN_APP = [
  'Hello, is this Mike?',
  'no',
  'Sorry to bother you! Since we met by fate, can we chat on Telegram? I do not use this app much'
].join('\n');

// Ordinary conversations that touch one of the steps: none may be flagged.
const ORDINARY = [
  ['a real wrong number', 'Hi, is this Linda?\nNo sorry, wrong number\nOh sorry! Have a good day'],
  ['friends and crypto', 'Mia: did you see bitcoin today lol\nMe: yeah crazy\nMia: anyway dinner at 7?'],
  ['moving a group chat', 'Tom: this app is so slow\nTom: add me on WhatsApp, my number is the same\nMe: ok see you saturday'],
  ['family and a hospital', 'Mum: Dad is in hospital for his knee, all fine\nMe: Oh no, I will visit tomorrow'],
  ['a friend overseas', 'Sam: I am working abroad this year, in Dubai\nMe: Amazing, send pictures!']
];

test('a wrong number that moves apps and turns to crypto profits is a slow scam at the investment step', () => {
  const r = judgeConversation(WRONG_NUMBER_TO_CRYPTO);
  assert.ok(r);
  assert.equal(r.level, 'danger');
  assert.equal(r.at, 'invest');
  assert.deepEqual(r.stages.filter((s) => s.seen).map((s) => s.id), ['opener', 'move', 'invest']);
  assert.match(r.next, /fee or a tax/);
  assert.match(r.detail, /3 of the five steps/);
});

test('a far-away friend who cannot video call and then needs money is at the money step', () => {
  const r = judgeConversation(ROMANCE_EMERGENCY);
  assert.equal(r.level, 'danger');
  assert.equal(r.at, 'money');
  assert.deepEqual(r.stages.filter((s) => s.seen).map((s) => s.id), ['bond', 'money']);
  assert.match(r.next, /ask again/);
});

test('a stranger moving the chat to another app is a warning about what comes next', () => {
  const r = judgeConversation(OPENER_THEN_APP);
  assert.equal(r.level, 'warn');
  assert.equal(r.at, 'move');
  assert.match(r.next, /far away/);
});

test('one step alone is ordinary and is left alone', () => {
  for (const [name, text] of ORDINARY) assert.equal(judgeConversation(text), null, name);
  assert.equal(judgeConversation(''), null);
});

test('all five steps are listed in order, with plain words and no em dashes', () => {
  const r = judgeConversation(`${WRONG_NUMBER_TO_CRYPTO}\n${ROMANCE_EMERGENCY}`);
  assert.deepEqual(r.stages.map((s) => s.id), ['opener', 'move', 'bond', 'invest', 'money']);
  assert.ok(r.stages.every((s) => s.seen));
  for (const s of [r.title, r.detail, r.advice, r.next, ...r.stages.map((x) => x.label)]) assert.doesNotMatch(s, /—/);
});
