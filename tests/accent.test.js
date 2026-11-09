'use strict';
// The home page's colour preview (web/assets/js/accent.js): every accent is a real colour of its own, keeps the
// contrast every text and button pair needs, in light and in dark, and never touches the warning colours.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../web/assets/js/accent.js');

const others = A.ACCENTS.filter((a) => a.h !== undefined);
const stops = (grad) => grad.match(/#[0-9a-f]{6}/g);

test('the rainbow: seven accents, gold in the middle as its yellow, one place to change them', () => {
  assert.deepStrictEqual(A.ACCENTS.map((a) => a.id), ['ruby', 'amber', 'gold', 'emerald', 'sapphire', 'indigo', 'amethyst']);
  assert.strictEqual(A.ramp('gold', 'dark'), null, 'gold is never derived: it keeps its hand-tuned values');
  // Each accent really is its own hue, at least 25 degrees from its neighbours.
  const hues = others.map((a) => A.oklch(A.ramp(a.id, 'dark')['--gold-400']).h);
  hues.forEach((h, i) => hues.slice(i + 1).forEach((g) => assert.ok(Math.min(Math.abs(h - g), 360 - Math.abs(h - g)) > 25, `${h} and ${g} are too close`)));
});

test('dark: text tones on the page and the dark words on the buttons pass 4.5:1', () => {
  for (const a of others) {
    const r = A.ramp(a.id, 'dark');
    for (const bg of ['#15120e', '#1e1a14', '#262019']) for (const s of [200, 300, 400]) {
      assert.ok(A.contrast(r[`--gold-${s}`], bg) >= 4.5, `${a.id} --gold-${s} on ${bg}: ${A.contrast(r[`--gold-${s}`], bg).toFixed(2)}`);
    }
    for (const c of stops(r['--gold-grad']).concat(stops(r['--gold-hover']))) assert.ok(A.contrast('#16130b', c) >= 4.5, `${a.id} on-gold on ${c}`);
    for (const c of stops(r['--btn-grad']).concat(stops(r['--btn-grad-hover']))) assert.ok(A.contrast('#1a1206', c) >= 4.5, `${a.id} button words on ${c}`);
  }
});

test('light: text tones on paper and white words on the filled buttons pass 4.5:1', () => {
  for (const a of others) {
    const r = A.ramp(a.id, 'light');
    for (const bg of ['#efe8da', '#f4eee3', '#efece6', '#f5f2ec']) for (const s of [50, 200, 300, 400, 500]) {
      assert.ok(A.contrast(r[`--gold-${s}`], bg) >= 4.5, `${a.id} --gold-${s} on ${bg}: ${A.contrast(r[`--gold-${s}`], bg).toFixed(2)}`);
    }
    for (const c of stops(r['--gold-grad']).concat(stops(r['--gold-hover']))) assert.ok(A.contrast('#ffffff', c) >= 4.5, `${a.id} white on ${c}`);
    // The lux gold button keeps its bright fill and dark words on paper too.
    for (const c of stops(r['--btn-grad'])) assert.ok(A.contrast('#1a1206', c) >= 4.5, `${a.id} button words on ${c}`);
  }
});

test('the stylesheet sets only gold tokens, never a warning colour, and beats every theme rule', () => {
  for (const a of others) {
    const css = A.css(a.id);
    assert.doesNotMatch(css, /--(red|orange|yellow|green|on-status)\s*:/);
    assert.match(css, /^:root\[data-accent\]\{/);
    assert.match(css, /:root\[data-accent\]:not\(\[data-theme="dark"\]\)\{/);
    assert.match(css, /:root\[data-accent\]\[data-theme="light"\]\{/);
  }
});

test('the gold button and chips draw from tokens, so an accent reaches them', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'web/assets/css', f), 'utf8');
  assert.doesNotMatch(read('lux.css'), /\.btn--gold(:hover)? \{[^}]*#d2ac63/);
  assert.doesNotMatch(read('home.css'), /\.chip-q\[aria-selected="true"\] \{[^}]*#d2ac63/);
});
