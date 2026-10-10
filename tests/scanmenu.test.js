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
