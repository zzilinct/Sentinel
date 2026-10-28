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
  for (const p of ['*://*.search.yahoo.com/search*', '*://*.google.com/search*', '*://*.google.co.za/search*', '*://*.google.com.mx/search*', '*://search.brave.com/search*', '*://duckduckgo.com/*']) {
    assert.ok(serp.includes(p), p);
  }
});
