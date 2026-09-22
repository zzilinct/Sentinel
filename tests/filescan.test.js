'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanFile } = require('../server/lib/scan/filescan');

const analyze = (buffer) => scanFile(buffer, 'inert-fixture.exe', { lookupHash: () => null });
const entropyCheck = (buffer) => analyze(buffer).checks.find((check) => check.id === 'F06');

test('file entropy keeps the packed-file warning for a uniform byte distribution', () => {
  // Only an MZ marker and synthetic bytes; this is not an executable program.
  const pattern = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const buffer = Buffer.alloc(1024 * 1024, pattern);
  buffer.write('MZ');
  const check = entropyCheck(buffer);
  assert.equal(check.status, 'warn');
  assert.equal(check.points, 14);
  assert.match(check.detail, /8\.00 bits\/byte/);
});

test('file entropy keeps low-entropy files clear and samples only the first 4 MiB', () => {
  const prefix = Buffer.alloc(4 * 1024 * 1024);
  prefix.write('MZ');
  const pattern = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const withTail = Buffer.concat([prefix, Buffer.alloc(6 * 1024 * 1024, pattern)]);
  const check = entropyCheck(prefix);
  assert.equal(check.status, 'pass');
  assert.equal(check.detail, 'Entropy 0.00');
  assert.deepEqual(entropyCheck(withTail), check, 'bytes beyond the entropy sample do not change the warning');
});

test('Office macro checks still distinguish auto-running and ordinary macros', () => {
  const header = Buffer.from('d0cf11e0a1b11ae1', 'hex');
  const macroCheck = (text) => scanFile(Buffer.concat([header, Buffer.from(text)]), 'inert-fixture.doc', {
    lookupHash: () => null
  }).checks.find((check) => check.id === 'F09');
  assert.equal(macroCheck('_VBA_PROJECT inert text Document_Open').points, 55);
  assert.equal(macroCheck('_VBA_PROJECT inert text ordinary macro').points, 36);
  assert.equal(macroCheck('Document_Open without any macro marker').status, 'pass');
});
