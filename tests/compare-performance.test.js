'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../server/lib/db');
const compare = require('../server/lib/scan/compare');

const text = 'A walking guide to lakes and beaches describes quiet trails, forests, boats, and ordinary lunch recipes.';
const insert = db.prepare('INSERT INTO scam_fingerprints (simhash, host, threat, label, added_at) VALUES (?, ?, ?, ?, ?)');
const clear = () => db.exec('DELETE FROM scam_fingerprints');

test('page similarity preserves every fingerprint bit and the six-bit confirmation boundary', () => {
  clear();
  const fingerprint = compare.compareContent(text, text, 'checking.invalid').fingerprint;
  const bits = BigInt('0x' + fingerprint);
  // Independent string-based reference: avoid duplicating the optimized math.
  const differences = [0n, 0xffffffffffffffffn, 0x8000000080000000n, 0xffffffff00000000n, 0x00000000ffffffffn];
  for (let bit = 0n; bit < 64n; bit++) differences.push(1n << bit);
  for (let count = 2n; count <= 8n; count++) {
    differences.push((1n << count) - 1n, ((1n << count) - 1n) << (64n - count));
  }
  differences.push(0x8000000780000000n, 0x8000000f80000000n, 0x8000001f80000000n);

  for (const difference of differences) {
    clear();
    const candidate = (bits ^ difference).toString(16).padStart(16, '0');
    insert.run(candidate, 'known.invalid', 'scam', 'Reference page', 1);
    const distance = difference.toString(2).split('1').length - 1;
    const actual = compare.compareContent(text, text, 'checking.invalid').similarPages;
    const expected = distance <= 6 ? [{
      host: 'known.invalid', threat: 'scam', label: 'Reference page', similarity: Math.round((1 - distance / 64) * 100)
    }] : [];
    assert.deepEqual(actual, expected, `XOR fingerprint ${difference.toString(16)} (${distance} different bits)`);
  }
  clear();
});

test('page similarity still excludes the current host and returns the newest three matching pages', () => {
  clear();
  const fingerprint = compare.compareContent(text, text, 'checking.invalid').fingerprint;
  for (let i = 1; i <= 4; i++) insert.run(fingerprint, `known-${i}.invalid`, 'scam', `Page ${i}`, i);
  insert.run(fingerprint, 'checking.invalid', 'scam', 'Self', 5);
  const actual = compare.compareContent(text, text, 'checking.invalid').similarPages;
  assert.deepEqual(actual.map(row => row.host), ['known-4.invalid', 'known-3.invalid', 'known-2.invalid']);
  assert.ok(actual.every(row => row.similarity === 100));
  clear();
});
