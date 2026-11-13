'use strict';
// One voice: the words a person reads in the app, the Windows app, the tray, the companion and the site. Every choice
// lives in Settings, so nothing sends a person to look for one elsewhere; no em dashes, no buzzwords. A word test cannot
// judge tone, only these.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = [
  ...fs.readdirSync(path.join(ROOT, 'web')).filter((f) => f.endsWith('.html')).map((f) => `web/${f}`),
  'web/assets/js/app.js', 'web/assets/js/ui.js', 'desktop/src/main.js', 'desktop/src/parentlock.js',
  ...fs.readdirSync(path.join(ROOT, 'desktop/src/pages')).filter((f) => /\.(html|js)$/.test(f)).map((f) => `desktop/src/pages/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'extension/src')).filter((f) => /\.(html|js)$/.test(f) && !f.includes('firefox')).map((f) => `extension/src/${f}`),
  'extension/src/lib/say.js'
];

test('one voice: no em dash, no buzzword, and every choice is found in Settings', () => {
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(text, /—|&mdash;/, `${f}: an em dash`);
    assert.doesNotMatch(text, /\b(seamless(ly)?|robust|cutting-edge|utili[sz]e|leverage|supercharge|next-gen)\b/i, `${f}: a buzzword`);
    assert.doesNotMatch(text, /\b(in|under|from) Live protection\b/, `${f}: a choice said to be in Live protection; it is in Settings`);
  }
});

test('one name for each feature: live scanning, the companion, Check', () => {
  // The companion's own switch is Live scanning, as in the Windows app and the tray.
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'extension/src/popup.js'), 'utf8'), /Live protection \$\{/);
  // The site names Sentinel's own browser add-on the companion.
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'web/download.html'), 'utf8'), /optional browser add-on|add-on&rsquo;s options/);
  // The tray opens Check, the page every check now starts from.
  assert.match(fs.readFileSync(path.join(ROOT, 'desktop/src/main.js'), 'utf8'), /label: 'Check a link or file\.\.\.', click: \(\) => showWindow\('\/app\/check'\)/);
});
