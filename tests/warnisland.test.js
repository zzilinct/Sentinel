'use strict';
/**
 * One warning card (desktop/src/pages/card.js): every desktop warning window is frameless and transparent, springs out
 * of the corner island, is sized to its words with no scrollbar inside, and answers the keyboard. The real windows
 * are photographed and measured on a GitHub Windows runner (scripts/desktop-e2e.ps1, desktop-qa.ps1,
 * desktop-core-qa.ps1); this checks the parts that can be checked without opening one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const main = read('desktop/src/main.js');
const card = read('desktop/src/pages/card.js');
const PAGES = ['warn', 'guard', 'filescan'];

/** card.js run against a small stand-in page: `heightAt(width)` is how tall the card's words are at that width. */
function loadCard(heightAt, buttons = [], trims = []) {
  const listeners = {};
  const style = () => ({});
  const doc = {
    head: { appendChild() {} },
    createElement: () => ({ textContent: '' }),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    documentElement: { style: style() },
    body: { style: style(), getBoundingClientRect() { return { height: heightAt(parseInt(this.style.width, 10) || 0, trims.filter((t) => !t.hidden).length) }; } },
    activeElement: null,
    querySelector: (sel) => (sel === '[data-escape]' ? buttons.find((b) => b.escape) || null : null),
    querySelectorAll: (sel) => (sel === '[data-trim]' ? trims : sel === '[data-trimmed]' ? trims.filter((t) => t.attrs['data-trimmed']) : buttons)
  };
  const window = {};
  vm.runInNewContext(card, { window, document: doc, getComputedStyle: () => ({}), requestAnimationFrame: (f) => f(), MutationObserver: class { observe() {} } });
  const key = (k, shiftKey = false, defaultPrevented = false) => {
    const e = { key: k, shiftKey, defaultPrevented, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of listeners.keydown || []) fn(e);
    return e;
  };
  return { api: window.SentinelCard, doc, key };
}

test('every warning window is one frameless, transparent card window', () => {
  const opts = main.slice(main.indexOf('function cardWindow('), main.indexOf('\n}\n', main.indexOf('function cardWindow(')));
  assert.match(opts, /frame: false, transparent: true, backgroundColor: '#00000000'/);
  assert.match(opts, /resizable: false/);
  assert.match(main, /warnWin = cardWindow\(\{ alwaysOnTop: true \}\)/);
  assert.match(main, /guardWin = cardWindow\(\{ alwaysOnTop: true \}\)/);
  assert.match(main, /menuWin = cardWindow\(\)/);
  // No other window of theirs: the only BrowserWindows made in main.js are the app's own and the card.
  assert.equal((main.match(/new BrowserWindow\(/g) || []).length, 2);
  // The CARD_PAD of the window and the PAD of the page are one number.
  assert.equal(Number(main.match(/const CARD_PAD = (\d+);/)[1]), loadCard(() => 100).api.PAD);
});

test('the live-scan warning springs from the corner island, fits its words, and never takes the keyboard', () => {
  const show = main.slice(main.indexOf('function showWarning('), main.indexOf('/* -----', main.indexOf('function showWarning(')));
  assert.match(show, /warnWin\.cardCorner = true/);
  assert.match(show, /fitToWords\(warnWin\)[\s\S]*warnWin\.showInactive\(\)/);
  assert.doesNotMatch(show, /setSize\(|\.show\(\)|\.focus\(\)/, 'no fixed size, never shown with the keyboard');
  // The island is 18 px in from the bottom right of the page area (overlay.html), and the card's corner is there.
  assert.match(read('desktop/src/pages/overlay.html'), /\.corner \{ position: absolute; right: 18px; bottom: 18px; width: 46px; height: 46px;/);
  assert.match(main, /return \{ x: d\.x \+ d\.width - 18, y: d\.y \+ d\.height - 18 \};/);
  assert.match(main, /const x = corner \? corner\.x \+ CARD_PAD - width : b\.x;/);
  // Kept on its screen.
  assert.match(main, /x: Math\.round\(Math\.max\(area\.x, Math\.min\(x, area\.x \+ area\.width - width\)\)\)/);
});

test('the full-screen and game rules are kept: on top only while a browser is in front, the way out alone takes the keyboard', () => {
  assert.match(main, /if \(warnWin && !warnWin\.isDestroyed\(\)\) warnWin\.setAlwaysOnTop\(Boolean\(rect\)\);/);
  assert.match(main, /guardWin\.setAlwaysOnTop\(Boolean\(rect\), 'screen-saver'\)/);
  assert.match(main, /if \(guardMode === 'escape'\) takeKeyboard\(\); else guardWin\.showInactive\(\);/);
  assert.match(main, /guardWin\.cardCorner = guardMode !== 'escape';/, 'the way out stays in the middle of the full-screen page');
});

test('each warning page is drawn by the card, has no scrolling box of its own, and is a dialog to a screen reader', () => {
  for (const name of PAGES) {
    const html = read(`desktop/src/pages/${name}.html`);
    assert.match(html, /script-src 'unsafe-inline' file:/, `${name}: may load card.js`);
    assert.ok(html.indexOf('<script src="card.js"></script>') > 0 && html.indexOf('<script src="card.js"></script>') < html.indexOf('<body'), `${name}: card.js in the head`);
    assert.doesNotMatch(html, /overflow(-y)?: (auto|scroll)/, `${name}: nothing scrolls inside`);
    assert.match(html, /<body role="(alert)?dialog" aria-labelledby="[a-z]+"/, `${name}: a labelled dialog`);
    assert.ok(!html.includes('\u2014'), `${name}: no em dash`);
  }
  assert.match(read('desktop/src/pages/warn.html'), /<body role="alertdialog"/);
  assert.match(read('desktop/src/pages/filescan.html'), /if \(badge === 'red' \|\| badge === 'orange'\) document\.body\.setAttribute\('role', 'alertdialog'\)/);
  assert.match(read('desktop/src/pages/warn.html'), /id="close" data-escape>Got it/);
  assert.match(read('desktop/src/pages/filescan.html'), /id="close" data-escape>Done/);
  // What may be left out on a very short screen: never the first reason, the verdict, the advice or a button.
  for (const name of ['warn', 'filescan']) assert.match(read(`desktop/src/pages/${name}.html`), /if \(ul\.children\.length\) li\.dataset\.trim = '';/);
  assert.match(read('desktop/src/pages/warn.html'), /<small id="browser" data-trim><\/small>/);
  assert.doesNotMatch(card, /overflow(-y)?: (auto|scroll)/);
  assert.ok(!card.includes('\u2014'));
});

test('the card springs with the island\'s curve, once, and only fades for reduced motion', () => {
  const spring = (s) => s.match(/--spring: (linear\([^)]*\))/)[1];
  assert.equal(spring(card), spring(read('desktop/src/pages/overlay.html')), 'the island\'s own spring');
  assert.match(card, /@keyframes card-open \{ from \{ clip-path: inset\(calc\(100% - 46px\) 0 0 calc\(100% - 46px\) round 12px\); \}/, 'out of the 46 px mask in its corner');
  assert.match(card, /@media \(prefers-reduced-motion: reduce\) \{ body, \.mark, \.head > div, \.body, \.row \{ animation: card-fade \.2s ease both; \} \}/);
  assert.doesNotMatch(card, /infinite|transition:/);
});

test('measure: the narrowest card whose words fit the screen, the widest when none does', () => {
  // Words that wrap: narrower is taller.
  const { api } = loadCard((w) => Math.round(400 * 480 / w));
  assert.deepEqual({ ...api.measure(900) }, { width: 480 + 2 * api.PAD, height: 400 + 2 * api.PAD });
  assert.deepEqual({ ...api.measure(380) }, { width: 560 + 2 * api.PAD, height: Math.ceil(400 * 480 / 560) + 2 * api.PAD });
  assert.deepEqual({ ...api.measure(100) }, { width: 660 + 2 * api.PAD, height: Math.ceil(400 * 480 / 660) + 2 * api.PAD });
  // The page's own sizes are given back after measuring.
  const c = loadCard(() => 200);
  c.doc.body.style.width = '';
  c.api.measure(500);
  assert.equal(c.doc.body.style.width, '');
  assert.equal(c.doc.documentElement.style.height, undefined);
});

test('measure: on a screen too short for every word, the later reasons are left out, last first, never the rest', () => {
  const trim = (name) => ({ name, hidden: false, attrs: {}, setAttribute(k) { this.attrs[k] = true; }, removeAttribute(k) { delete this.attrs[k]; } });
  const trims = [trim('reason 2'), trim('reason 3'), trim('note')];
  // 300 px of words that are always shown, 80 px for each word that may be left out; width changes nothing here.
  const c = loadCard((w, shown) => 300 + 80 * shown, [], trims);
  const PAD2 = 2 * c.api.PAD;
  assert.deepEqual({ ...c.api.measure(300 + 80 * 3 + PAD2) }, { width: 480 + PAD2, height: 300 + 240 + PAD2 }, 'room for all: nothing left out');
  assert.deepEqual(trims.map((t) => t.hidden), [false, false, false]);
  assert.deepEqual({ ...c.api.measure(300 + 80 + PAD2) }, { width: 660 + PAD2, height: 380 + PAD2 });
  assert.deepEqual(trims.map((t) => t.hidden), [false, true, true], 'the note first, then the last reason');
  // A taller screen (or new words) measured again: what was left out comes back.
  c.api.measure(2000);
  assert.deepEqual(trims.map((t) => t.hidden), [false, false, false]);
});

test('keyboard: Escape presses the button marked for it, Tab goes round the card', () => {
  const pressed = [];
  const button = (name, escape) => ({ name, escape, offsetParent: {}, disabled: false, click() { pressed.push(name); }, focus() { c.doc.activeElement = this; } });
  const buttons = [button('details'), button('close', true)];
  const c = loadCard(() => 100, buttons);
  assert.equal(c.key('Escape').defaultPrevented, true);
  assert.deepEqual(pressed, ['close']);
  c.doc.activeElement = buttons[1];
  assert.equal(c.key('Tab').defaultPrevented, true);
  assert.equal(c.doc.activeElement.name, 'details', 'from the last button back to the first');
  assert.equal(c.key('Tab', true).defaultPrevented, true);
  assert.equal(c.doc.activeElement.name, 'close', 'Shift+Tab from the first to the last');
  // A page that answers Escape itself (guard.html) is left to do so.
  pressed.length = 0;
  c.key('Escape', false, true);
  assert.deepEqual(pressed, []);
});

test('new words in the same card size its window again, through the card windows only', () => {
  assert.match(card, /window\.sentinelDesktop\.cardFit\(\)/);
  assert.match(read('desktop/src/preload.js'), /cardFit: \(\) => ipcRenderer\.invoke\('sentinel:card-fit'\)/);
  const h = main.slice(main.indexOf("ipcMain.handle('sentinel:card-fit'"), main.indexOf("handle('sentinel:guard-action'"));
  assert.match(h, /if \(!trustedLocal\(event\)\) throw new Error\('Not allowed'\);/);
  assert.match(h, /w === win/, 'never the app\'s own window');
});
