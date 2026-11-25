'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { defang, refang, parse, sampleId } = require('../scripts/phish-sample');

// Harmless addresses only: nothing here is, or looks like, a real attack.
const SAMPLE = ['https://login.example.com/a/b?x=1.2', 'http://example.org/'];

test('1.21.3: a frozen entry is defanged, so no complete address is written, and it comes back whole to be scored', () => {
  for (const u of SAMPLE) {
    const d = defang(u);
    assert.doesNotMatch(d, /^https?:/, 'the scheme is not a scheme');
    assert.doesNotMatch(d.replace(/\[\.\]/g, ''), /\./, 'every dot is bracketed');
    assert.equal(refang(d), u);
    assert.equal(refang(u), u, 'a normal address passes through');
  }
  assert.deepEqual(parse(SAMPLE.map(defang).join('\r\n') + '\n\nnot an address\n' + defang(SAMPLE[0])), SAMPLE, 'no repeats, no stray lines');
});

test('1.21.3: the same addresses give the same sample id, and a different set a different one', () => {
  assert.equal(sampleId(SAMPLE), sampleId([...SAMPLE]));
  assert.notEqual(sampleId(SAMPLE), sampleId(SAMPLE.slice(1)));
});

test('1.21.3: the evaluation scores the frozen sample and reports the unlisted rate apart from list hits', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'evaluate-modes.js'), 'utf8');
  assert.match(src, /RULES ALONE \(no list loaded/);
  assert.ok(src.indexOf('RULES ALONE (no list loaded') < src.indexOf('feeds.refreshAll'), 'the comparable pass runs before any list is loaded');
  assert.match(src, /verdict digest/);
  assert.match(src, /on a list \(moves with the lists\)/);
  assert.match(src, /fs\.writeFileSync\(MISSES, missed\.map\(defang\)/, 'misses are written defanged too');
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'evaluate.yml'), 'utf8');
  assert.match(yml, /--phish scripts\/evaluate-phish\.frozen\.txt/);
  assert.match(yml, /--freeze scripts\/evaluate-phish\.frozen\.txt/);
});
