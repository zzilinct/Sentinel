'use strict';
// One way to say empty, failed, offline and slow (ui.js stateBlock, app.js failed), and simple view never hiding what
// keeps a result honest. The browser check is scripts/verify-web/55-states.js and 54-simple.js; this one needs no browser.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const js = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'js', f), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'css', 'app.css'), 'utf8');
const app = js('app.js');
const ui = js('ui.js');

test('states: the app has no red banner and no hand-made empty box left', () => {
  assert.ok(!app.includes('banner--error'), 'every load failure is a stateBlock');
  assert.ok(!/<div class="empty[ "]/.test(app), 'every empty place is a stateBlock');
  assert.ok(!/catch \{ return; \}/.test(app.slice(app.indexOf('async function weekCard'), app.indexOf('async function weekView'))), 'the week card does not fail silently');
  assert.ok(!/catch \{ return; \}/.test(app.slice(app.indexOf('async function askChatSafety'), app.indexOf('const EXPOSURE_WHAT'))), 'the chat safety offer does not fail silently');
});

test('states: offline is decided by fetch itself, never by navigator.onLine', () => {
  assert.ok(!/navigator\.onLine/.test((app + ui).replace(/\/\/.*$/gm, '')), 'no code reads navigator.onLine');
  assert.ok(/down\.offline = true/.test(ui) && /reachable\(false\)/.test(ui) && /reachable\(true\)/.test(ui));
});

test('states: stateBlock says which kind, and reads out failures', () => {
  global.window = { SentinelMasks: {} };
  global.document = { createElement: () => ({}) };
  const UI = new Function('window', 'document', `${ui}; return window.UI;`)(global.window, global.document);
  const err = UI.stateBlock('error', 'x', { title: 't' });
  assert.ok(/data-state="error"/.test(err) && /role="alert"/.test(err) && /empty__title">t</.test(err));
  assert.ok(/role="status"/.test(UI.stateBlock('offline', 'x')));
  assert.ok(!/role=/.test(UI.stateBlock('waiting', 'x')), 'an empty place is not announced');
  assert.ok(!/<img/.test(UI.stateBlock('clear', 'x', { small: true })), 'a small one is the seal alone');
});

test('simple view never hides what keeps a result honest', () => {
  const rules = [...css.matchAll(/html\[data-simple\][^{]*\{[^}]*display:\s*none[^}]*\}/g)].map((m) => m[0]);
  assert.ok(rules.length >= 2, 'simple view has its hiding rules');
  for (const kept of ['result__partly', 'data-not-run', 'notrun', 'next-steps', 'real-site', 'result__lead', 'result__title']) {
    assert.ok(!rules.some((r) => r.includes(kept)), `simple view never hides ${kept}`);
  }
  assert.ok(/html\[data-simple\] \.result:not\(\.is-full\) :is\(\.reasons, \.result__more\) \{ display: none; \}/.test(css), 'the clues and the checklist wait behind Show details');
});

test('a wait is as tall as what replaces it: every place that waits keeps its height', () => {
  const keys = [...app.matchAll(/skel\('([\w-]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 7);
  // Every wait is drawn the first time from what a new account sees there, never from a number.
  assert.equal([...app.matchAll(/skel\('[\w-]+'\)/g)].length, 0, 'every wait has its first-time shape');
  assert.doesNotMatch(css, /\.h-[a-z]+\s*[,{]/, 'no first-time height written down as a number');
  assert.match(css, /\.skeleton__ghost \{ visibility: hidden;/);
  for (const k of new Set(keys)) {
    assert.ok(new RegExp(`keep\\(.*, '${k}'\\);`).test(app), `${k} keeps its height`);
  }
});

test('a long wait offers Try again in its place, with no timer', () => {
  assert.match(app, /const LATE = '<p class="skeleton__late">This is taking longer than usual\. <button[^>]*data-skel-again>Try again<\/button><\/p>';/);
  assert.match(app, /closest\('\[data-skel-again\]'\)\) return;\s*render\(\);/);
  assert.match(css, /\.skeleton__late \{[^}]*visibility: hidden; animation: skeleton-late 0s 8s forwards;/);
  assert.doesNotMatch(css, /\.skeleton[^{]*::after/, 'the old note in ::after is gone');
});
