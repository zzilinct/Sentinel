'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'extension', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// Each place that falls back to a default when nothing is stored yet must agree, or a fresh install behaves one way in
// the settings page and another in the chat itself.
test('companion: "Hints in web chats" is on by default everywhere a default is read', () => {
  for (const f of ['lib/api.js', 'background.firefox.js', 'options.js', 'content/webchat.js']) {
    assert.match(read(f), /chatHints:\s*true\b/, `${f} should default chatHints to true`);
  }
  assert.match(read('content/webchat.js'), /settings\.chatHints !== false/);
});

test('companion: the settings page says when private windows are not checked', () => {
  assert.match(read('options.html'), /id="privateNote" hidden/);
  assert.match(read('options.js'), /isAllowedIncognitoAccess/);
});

test('companion: search results are marked on every Yahoo and on more of Google\'s country sites', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'manifest.json'), 'utf8'));
  const serp = m.content_scripts.find((c) => c.js.includes('src/content/serp.js')).matches;
  for (const p of ['*://*.search.yahoo.com/search*', '*://search.yahoo.co.jp/search*', '*://*.google.com/search*', '*://*.google.co.za/search*', '*://*.google.com.mx/search*', '*://search.brave.com/search*', '*://duckduckgo.com/*']) {
    assert.ok(serp.includes(p), p);
  }
});

// A new install opens the connect page, but not once the companion was paired while its first sign-in attempt ran
// (the desktop app or the settings page handed it a token): that tab only asked a signed-in person to sign in.
test('companion: the install tab opens only for a new install that is not signed in', async () => {
  let stored = {};
  globalThis.chrome = { runtime: {}, storage: { local: { get: async () => stored } } };
  // The companion's modules are plain .js with no package.json of their own, so they are imported from a copy marked as modules.
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sentinel-api-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'brand.js']) fs.copyFileSync(path.join(SRC, 'lib', f), path.join(dir, f));
  const { wantsConnectTab } = await import(require('url').pathToFileURL(path.join(dir, 'api.js')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(await wantsConnectTab('install', false), true, 'a new install with no account gets the tab');
  assert.equal(await wantsConnectTab('install', true), false, 'signed in through the site already');
  stored = { authToken: 'paired-meanwhile' };
  assert.equal(await wantsConnectTab('install', false), false, 'paired by the desktop app or settings page meanwhile');
  stored = {};
  assert.equal(await wantsConnectTab('update', false), false, 'an update never opens it');
  assert.match(read('background.js'), /if \(await wantsConnectTab\(details\.reason, account\.signedIn\)\)/);
});

// Bing redraws its results a moment after loading; the redrawn links must get the verdicts already known, or every
// mark vanishes (verify-web run 40787005308: every result marked 1.2 s after loading, none 1.5 s later).
test('companion: a search result drawn again keeps its marks', () => {
  const serp = read('content/serp.js');
  assert.match(serp, /if \(known\.has\(url\)\) attach\(a, known\.get\(url\)\);/);
  assert.match(serp, /known\.set\(url, verdict\)/);
});
