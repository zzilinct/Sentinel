'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { compare, loadDomains, judge, trim, byRule } = require('../scripts/fpgate/gate');

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

test('the ratchet: a baseline entry no longer flagged, or flagged lower, is stale, and trimming drops or lowers it', () => {
  const baseline = { 'planted-stale.com': f('yellow'), 'lowered.com': f('orange'), 'kept.com': f('yellow') };
  const branch = { 'lowered.com': f('yellow'), 'kept.com': f('yellow') };
  const { fixed, lowered } = compare(branch, {}, baseline);
  assert.deepEqual(fixed, ['planted-stale.com']);
  assert.deepEqual(lowered, ['lowered.com']);
  assert.deepEqual(trim(baseline, branch), { 'kept.com': f('yellow'), 'lowered.com': f('yellow') });
  // Trimming never adds: a domain flagged now and missing from the baseline stays out of it.
  assert.deepEqual(Object.keys(trim(baseline, { ...branch, 'new.com': f('red') })).sort(), ['kept.com', 'lowered.com']);
});

test('the committed baseline is current: every entry is still flagged, at no lower level (the baseline only shrinks)', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fpgate', 'baseline.json'), 'utf8'));
  const now = judge(path.join(__dirname, '..'), Object.keys(baseline));
  const { fixed, lowered } = compare(now, {}, baseline);
  assert.deepEqual([...fixed, ...lowered], [], 'run node scripts/fpgate/gate.js --trim-baseline and commit the result');
  assert.deepEqual(byRule({ a: f('yellow'), b: { ...f('yellow'), rules: ['U22 x', 'U22 y', 'U10 z'] } }), [['U00', 1], ['U10', 1], ['U22', 1]]);
});

test('a brand\'s own sites on generic endings pass; the same names on endings it does not run still flag', () => {
  const offline = require('../server/lib/scan/offline');
  for (const d of ['stripe.dev', 'dropbox.tech', 'shopify.engineering', 'spotify.design', 'google.org', 'robinhood.engineering']) {
    assert.equal(offline.scanAddress(`https://${d}/`).overall.badge, null, d);
  }
  for (const d of ['stripe.top', 'dropbox.live', 'shopify.support', 'spotify.shop', 'google.cfd', 'robinhood.icu']) {
    assert.ok(offline.scanAddress(`https://${d}/`).overall.badge, d);
  }
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
