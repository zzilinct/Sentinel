'use strict';
// Arrival protection reaches what is unpacked and where the browser really saves (desktop/src/arrival.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const arrival = require('../desktop/src/arrival');

const { nestedAccepted, savedBy, usable, reset } = arrival._test;

test('inside a subfolder only programs are passed on, not deep, not hidden, and not thousands a minute', () => {
  reset();
  assert.equal(nestedAccepted('tools\\setup.exe'), true);
  assert.equal(nestedAccepted('tools/bin/run.bat'), true);
  for (const n of ["run.bat", "run.cmd", "run.ps1", "run.vbs", "run.js", "run.jse", "run.wsf", "run.hta", "setup.msi", "x.scr", "link.lnk", "lib.dll", "x.reg"]) assert.equal(nestedAccepted("tools/" + n), true, n);
  assert.equal(nestedAccepted('tools\\readme.txt'), false);
  assert.equal(nestedAccepted('.cache\\x.exe'), false);
  assert.equal(nestedAccepted('proj\\node_modules\\x\\y.exe'), false);
  assert.equal(nestedAccepted('a\\b\\c\\d\\e\\f.exe'), false, 'four folders deep at most');
  assert.equal(nestedAccepted('a\\b\\c\\d\\f.exe'), true);
  reset();
  for (let i = 0; i < 60; i++) assert.equal(nestedAccepted(`big\\p${i}.exe`), true);
  assert.equal(nestedAccepted('big\\p60.exe'), false, 'the minute is used up');
  assert.equal(nestedAccepted('big\\p3.exe'), true, 'a file still being written is the same file');
  assert.equal(nestedAccepted('big\\p61.exe', Date.now() + 61 * 1000), true, 'and the next minute starts again');
  reset();
  for (let i = 0; i < 20; i++) assert.equal(nestedAccepted(`proj\\l${i}.dll`), true);
  assert.equal(nestedAccepted('proj\\l20.dll'), false, 'libraries and scripts have a smaller allowance');
  assert.equal(nestedAccepted('proj\\setup.exe'), true, 'and cannot use up the programs\' allowance');
});

test('the save folder is read from the browser\'s own settings, and only a custom one', () => {
  assert.equal(savedBy('chromium', '', JSON.stringify({ download: { default_directory: 'D:\\Saves' } })), 'D:\\Saves');
  assert.equal(savedBy('chromium', '', '{ not json'), null);
  const prefs = (list) => `user_pref("browser.download.dir", "E:\\\\Got");\nuser_pref("browser.download.folderList", ${list});`;
  assert.equal(savedBy('gecko', '', prefs(2)), 'E:\\Got');
  assert.equal(savedBy('gecko', '', prefs(1)), null, 'folderList 1 is the Downloads folder, whatever dir says');
  assert.equal(usable('C:\\', []), false);
  assert.equal(usable(os.homedir(), []), false);
  assert.equal(usable('C:\\Users\\x\\Documents', []), false);
  assert.equal(usable('C:\\Users\\x\\OneDrive - Work\\Saves', []), false);
  assert.equal(usable('D:\\Saves', ['d:\\saves\\']), false, 'Downloads and Desktop are watched already');
  assert.equal(usable('D:\\Saves', []), true);
});

test('saveFolders finds a configured Chromium folder and leaves Downloads out', async () => {
  // Beside the tests, not in Temp: a folder in Temp is one saveFolders rightly refuses.
  const root = fs.mkdtempSync(path.join(__dirname, '..', 'arrival-test-'));
  try {
    const saves = path.join(root, 'SavedHere');
    const def = path.join(root, 'Downloads');
    fs.mkdirSync(saves); fs.mkdirSync(def);
    const profile = path.join(root, 'local', 'Google', 'Chrome', 'User Data', 'Default');
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, 'Preferences'), JSON.stringify({ download: { default_directory: saves } }));
    const edge = path.join(root, 'local', 'Microsoft', 'Edge', 'User Data', 'Default');
    fs.mkdirSync(edge, { recursive: true });
    fs.writeFileSync(path.join(edge, 'Preferences'), JSON.stringify({ download: { default_directory: def } }));
    const got = await arrival.saveFolders({ exclude: [def], local: path.join(root, 'local'), roaming: path.join(root, 'roaming') });
    assert.deepEqual(got.map((d) => d.toLowerCase()), [saves.toLowerCase()]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('one watch serves both modules: a program unpacked into a subfolder is heard, a text file there is not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-arr-'));
  const heard = [[], []];
  const stop = [arrival.watch(dir, true, (f) => heard[0].push(path.relative(dir, f))), arrival.watch(dir, true, (f) => heard[1].push(path.relative(dir, f)))];
  try {
    reset();
    fs.mkdirSync(path.join(dir, 'unpacked'));
    fs.writeFileSync(path.join(dir, 'unpacked', 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'unpacked', 'tool.exe'), 'x');
    fs.writeFileSync(path.join(dir, 'top.txt'), 'x');
    const until = Date.now() + 5000;
    while (Date.now() < until && !(heard[0].includes(path.join('unpacked', 'tool.exe')) && heard[0].includes('top.txt') && heard[1].length)) await new Promise((r) => setTimeout(r, 50));
    for (const h of heard) {
      assert.ok(h.includes(path.join('unpacked', 'tool.exe')), `the unpacked program was heard: ${h}`);
      assert.ok(h.includes('top.txt'), 'a top-level file is passed on as before');
      assert.ok(!h.includes(path.join('unpacked', 'notes.txt')), 'a text file inside a subfolder is not');
    }
  } finally {
    stop.forEach((s) => s());
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
