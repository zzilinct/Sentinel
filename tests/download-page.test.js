'use strict';
// The download page says what is true of the release: its note comes from changelog/, nothing about a version is typed
// into it, and what it tells someone about the installer is tied to the configuration that makes it so.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseNote, renderNote, assertInStep } = require('../scripts/release-note');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r/g, '');
const page = read('web', 'download.html');
const script = read('web', 'assets', 'js', 'download.js');

const NOTE = `Sentinel 9.8.7 Argus: one thing & another

Group one:
• First <change>.
• Second change.

Group two:
• Third change.

Download 9.8.7:
https://example.com/
Report problems in #bug-reports.
`;

test('release note: the partial is what the changelog of package.json\'s version says', () => {
  assertInStep(); // Out of step? npm run build:note, and the message says so.
});

test('release note: a changelog becomes the page\'s note, without its Discord footer', () => {
  const note = parseNote(NOTE.replace(/\n/g, '\r\n'), '9.8.7');
  assert.deepEqual(note.groups.map((g) => [g.title, g.items.length]), [['Group one', 2], ['Group two', 1]]);
  const html = renderNote(note);
  assert.match(html, /New in Sentinel 9\.8\.7 Argus/);
  assert.match(html, /One thing &amp; another\./);
  assert.match(html, /First &lt;change&gt;\./);
  assert.match(html, /data-release-note="9\.8\.7"/);
  assert.doesNotMatch(html, /bug-reports|example\.com/);
});

test('release note: a changelog it cannot read stops the build instead of publishing a broken note', () => {
  assert.throws(() => parseNote('Just some words', '9.8.7'), /first line/);
  assert.throws(() => parseNote(NOTE, '9.8.8'), /title says 9\.8\.7/);
  assert.throws(() => parseNote('Sentinel 9.8.7 Argus: x\n\n• No group', '9.8.7'), /no group/);
  assert.throws(() => parseNote('Sentinel 9.8.7 Argus: x\n\nEmpty:\n\nDownload 9.8.7:', '9.8.7'), /at least one/);
  assert.throws(() => parseNote('Sentinel 9.8.7 Argus: x\n\nA loose paragraph', '9.8.7'), /not a group/);
});

test('download page: no version and no release note is typed into the page', () => {
  assert.equal(page.match(/\b\d+\.\d+\.\d+\b/), null);
  assert.match(page, /<!-- @include release-note -->/);
  assert.doesNotMatch(page, /Check the release page|Release notes/);
});

test('download page: the warning comes right after the button, and the checks before everything else', () => {
  const at = (needle) => { const i = page.indexOf(needle); assert.ok(i >= 0, needle); return i; };
  const order = ['data-installer', 'Windows protected your PC', 'data-ss-more', 'data-ss-run', 'Installing,', 'id="check"', '@include release-note', 'class="compare"', 'id="elsewhere"', 'id="models-title"'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('download page: the practice warning holds only words Microsoft documents for that screen, and says where', () => {
  const dialog = /<div class="ss__dialog">([\s\S]*?)<div class="ss__after">/.exec(page)[1];
  const words = dialog.replace(/<[^>]+>/g, '\n').split('\n').map((w) => w.trim()).filter(Boolean);
  assert.deepEqual(words, ['Windows protected your PC', 'More info', 'Run anyway']);
  assert.match(page, /learn\.microsoft\.com\/en-us\/windows\/apps\/package-and-deploy\/smartscreen-reputation/);
  assert.doesNotMatch(page, /Don&rsquo;t run|Don't run/);
});

test('download page: "not code-signed" stays true, or this fails and the page is rewritten', () => {
  assert.match(page, /not code-signed yet/);
  const { build } = JSON.parse(read('desktop', 'package.json'));
  assert.doesNotMatch(JSON.stringify(build), /certificate|signtool|azureSignOptions|signingHashAlgorithms/i);
  assert.doesNotMatch(read('.github', 'workflows', 'release.yml'), /CSC_LINK|WIN_CSC|signtool/i);
});

test('download page: what it says about installing is what the installer is set up to do', () => {
  const { nsis } = JSON.parse(read('desktop', 'package.json')).build;
  assert.equal(nsis.oneClick, false, 'an installer with answers to go through');
  assert.equal(nsis.runAfterFinish, true, 'Sentinel opens at the end');
  const main = read('desktop', 'src', 'main.js');
  // The switch is in the app (Live protection, This computer) since the tray became a card with protections only.
  assert.match(read('web', 'assets', 'js', 'app.js'), /<b>Start with my computer<\/b>[^\n]*data-login/);
  assert.match(page, /turn that off in Live protection, under This computer/);
  assert.match(main, /store\.get\('openAtLogin', true\)/);
  const release = read('.github', 'workflows', 'release.yml');
  assert.match(release, /release\/SHA256SUMS\.txt/);
  assert.match(page, /releases\/latest\/download\/SHA256SUMS\.txt/);
});

test('download page: the file check uploads nothing', () => {
  assert.equal(script.match(/\bfetch\(/g).length, 1);
  assert.match(script, /api\.github\.com\/repos\/\$\{button\.dataset\.releases\}\/releases\/latest/);
  assert.doesNotMatch(script, /XMLHttpRequest|sendBeacon|FormData|WebSocket/);
});

test('download page: the page takes the fingerprint from GitHub\'s own record, and compares every byte', () => {
  assert.match(script, /asset\.digest/);
  assert.match(script, /crypto\.subtle\.digest\('SHA-256'/);
});

test('download page: it never asks anyone to paste a command, which is what Sentinel warns people about', () => {
  assert.doesNotMatch(page + script, /Get-FileHash|certutil|PowerShell/i);
});
