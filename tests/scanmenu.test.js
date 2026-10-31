'use strict';
// "Scan with Sentinel" in the right-click menu (desktop/src/scanmenu.js): the command Windows runs, and reading the
// file back from it. Writing the registry and the scan in the app need a real desktop: scripts/desktop-e2e.ps1.
const test = require('node:test');
const assert = require('node:assert/strict');
const { command, fileFrom, KEY } = require('../desktop/src/scanmenu.js');

const EXE = 'C:\\Users\\Ada Lovelace\\AppData\\Local\\Programs\\Sentinel\\Sentinel.exe';

test('the menu is registered for this Windows user only, for every file', () => {
  assert.match(KEY, /^HKCU\\Software\\Classes\\\*\\shell\\/);
});

test('the command keeps the program and the file whole, spaces and all', () => {
  assert.equal(command(EXE), `"${EXE}" "--scan-file=%1"`);
});

test('the file comes back from the command line Windows starts', () => {
  const file = 'D:\\My files\\Invoice 2026.pdf';
  assert.equal(fileFrom([EXE, `--scan-file=${file}`]), file);
  // A running copy hears a second start with Chromium's own switches around it.
  assert.equal(fileFrom([EXE, '--allow-file-access-from-files', `--scan-file=${file}`, '--original-process-start-time=1']), file);
  assert.equal(fileFrom(['--scan-file=\\\\server\\share\\a.zip']), '\\\\server\\share\\a.zip');
});

test('anything that is not a full path is ignored', () => {
  assert.equal(fileFrom([EXE]), null);
  assert.equal(fileFrom([EXE, '--scan-file=']), null);
  assert.equal(fileFrom([EXE, '--scan-file=notes.txt']), null);
  assert.equal(fileFrom([EXE, '--scan-file=C:notes.txt']), null);
  assert.equal(fileFrom([EXE, '--hidden']), null);
  assert.equal(fileFrom(undefined), null);
});

// Signed out, the file is checked on this computer and the result window gets only these words: never the folder.
const { offlineResult } = require('../desktop/src/scanmenu.js');
const FILE = 'C:\\Users\\Ada Lovelace\\Documents\\Private\\Invoice 2026.pdf.exe';

test('the result window is told the file name and the verdict, never where the file is', () => {
  const report = { checks: [
    { status: 'pass', points: 0, detail: 'Hash not in any threat list' },
    { status: 'warn', points: 18, detail: 'PE executable: only run programs from publishers you trust' },
    { status: 'fail', points: 45, detail: '"Invoice 2026.pdf.exe" hides a .exe behind .pdf' },
    { status: 'skip', points: 0, detail: 'Not an executable' }
  ] };
  const r = offlineResult(FILE, 52224, { badge: 'orange', label: 'Likely virus' }, report);
  assert.deepEqual(r, {
    name: 'Invoice 2026.pdf.exe', size: '52224', badge: 'orange', label: 'Likely virus', why: '',
    found: '"Invoice 2026.pdf.exe" hides a .exe behind .pdf\nPE executable: only run programs from publishers you trust'
  });
  assert.ok(!JSON.stringify(r).includes('Ada Lovelace') && !JSON.stringify(r).includes('Private'));
});

test('a clean file is green, and a file not checked says so instead of a verdict', () => {
  const clean = offlineResult('D:\\notes.txt', 12, { badge: null, label: 'No threats found', looked: 'all' }, { checks: [] });
  assert.equal(clean.badge, 'green');
  assert.equal(clean.label, 'No threats found');
  assert.equal(clean.found, '');
  const big = offlineResult('D:\\film.mkv', 40 * 1024 * 1024, { badge: null, label: 'Partly checked', looked: 'part', reason: 'The ends.' }, { checks: [] });
  assert.deepEqual([big.badge, big.label, big.why, big.found], ['part', 'Partly checked', 'The ends.', '']);
  const gone = offlineResult('D:\\film.mkv', 0, { badge: null, label: 'Not checked', looked: 'none', reason: 'Gone.' }, null);
  assert.deepEqual([gone.badge, gone.why], ['none', 'Gone.']);
});

test('a clean verdict lists no findings, even the minor ones a clean program has', () => {
  const report = { checks: [
    { status: 'warn', points: 12, detail: 'Contains the classic process-injection API trio' },
    { status: 'warn', points: 8, detail: 'PE executable: only run programs from publishers you trust' }
  ] };
  const r = offlineResult('C:\Downloads\chrome.exe', 4500000, { badge: null, label: 'No threats found', looked: 'all' }, report);
  assert.deepEqual([r.badge, r.label, r.found], ['green', 'No threats found', '']);
});
