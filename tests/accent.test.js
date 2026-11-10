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

test("the accents: gold in rainbow order with the product's own, gold never derived", () => {
  assert.deepStrictEqual(A.ACCENTS.map((a) => a.id), ['rose', 'gold', 'teal', 'sapphire', 'amethyst', 'platinum']);
  assert.strictEqual(A.ramp('gold', 'dark'), null, 'gold is never derived: it keeps its hand-tuned values');
  // Each coloured accent really is its own hue, at least 25 degrees from the others.
  const hues = others.filter((a) => a.c > 0.3).map((a) => A.oklch(A.ramp(a.id, 'dark')['--gold-400']).h);
  hues.forEach((h, i) => hues.slice(i + 1).forEach((g) => assert.ok(Math.min(Math.abs(h - g), 360 - Math.abs(h - g)) > 25, `${h} and ${g} are too close`)));
});

test('no accent can be mistaken for a warning: every tone sits 25 degrees or more from red, orange, yellow and green', () => {
  const status = Object.entries(A.STATUS).map(([k, v]) => [k, A.oklch(v).h]);
  for (const a of others) for (const scheme of ['dark', 'light']) {
    const r = A.ramp(a.id, scheme);
    for (const s of A.STEPS) {
      const o = A.oklch(r[`--gold-${s}`]);
      if (o.C < 0.04) continue; // grey has no hue to confuse
      for (const [k, h] of status) assert.ok(Math.min(Math.abs(o.h - h), 360 - Math.abs(o.h - h)) >= 25, `${a.id} ${scheme} --gold-${s} (${o.h.toFixed(0)}) is near ${k} (${h.toFixed(0)})`);
    }
  }
});

test("dark pages: the coloured accents are deep, not pastel (at least 1.2 times gold's depth)", () => {
  const gold = A.oklch('#d2ac63').C;
  for (const a of others.filter((x) => x.c > 0.3)) {
    const o = A.oklch(A.ramp(a.id, 'dark')['--gold-400']);
    // Or as much colour as the screen can show at that lightness and hue (a teal this light cannot be deeper).
    const most = A.oklch(A.hexOf(A.fit(o.L, 1, o.h))).C;
    assert.ok(o.C >= Math.min(gold * 1.2, most * 0.95), `${a.id} is pastel: ${o.C.toFixed(3)} of ${most.toFixed(3)}`);
  }
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
