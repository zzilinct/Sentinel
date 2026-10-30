'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { compare, loadDomains } = require('../scripts/fpgate/gate');

const f = (badge) => ({ badge, threat: 'scam', rules: ['U00 test'] });

test('a domain flagged now and not by main is a new false alarm, with the rule that fired', () => {
  const { fresh } = compare({ 'honest.com': f('yellow') }, {}, {});
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].domain, 'honest.com');
  assert.deepEqual(fresh[0].rules, ['U00 test']);
});

test('the same flag as main, or one in the known baseline, is not new', () => {
  assert.equal(compare({ 'a.com': f('yellow') }, { 'a.com': f('yellow') }, {}).fresh.length, 0);
  assert.equal(compare({ 'a.com': f('orange') }, {}, { 'a.com': f('orange') }).fresh.length, 0);
  assert.equal(compare({ 'a.com': f('yellow') }, {}, { 'a.com': f('orange') }).fresh.length, 0);
});

test('a flag raised above what main gave is new', () => {
  const { fresh } = compare({ 'a.com': f('red') }, { 'a.com': f('yellow') }, {});
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].before, 'yellow');
});

test('baseline entries no longer flagged are reported as fixed', () => {
  assert.deepEqual(compare({}, {}, { 'gone.com': f('yellow') }).fixed, ['gone.com']);
});

test('the frozen sample names its source, licence and date', { skip: !fs.existsSync(path.join(__dirname, '..', 'scripts', 'fpgate', 'domains.txt')) }, () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fpgate', 'domains.txt'), 'utf8');
  assert.match(text, /^# Source: .+majestic/im);
  assert.match(text, /^# Licence: /m);
  assert.match(text, /^# List date: /m);
  const domains = loadDomains();
  assert.ok(domains.length > 0);
  assert.equal(new Set(domains).size, domains.length, 'no domain twice');
});
