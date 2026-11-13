'use strict';
// The home page's colour preview (web/assets/js/accent.js): the product's own accents from look.js, every one a real
// colour of its own, reaching the marketing pages' gold button with its words still readable, and never touching the
// warning colours. look.test.js holds the rest of the table's rules (contrast on the pages, the status colours).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../web/assets/js/look.js');
const A = require('../web/assets/js/accent.js');

const others = L.ACCENTS.filter((a) => a.id !== 'gold');
const stops = (grad) => grad.match(/#[0-9a-f]{6}/g);

test("the preview: look.js's accents in rainbow order, gold as the yellow, no colour table of its own", () => {
  assert.deepStrictEqual([...A.ORDER].sort(), L.ACCENTS.map((a) => a.id).sort());
  assert.strictEqual(A.ORDER[1], 'gold');
  const src = fs.readFileSync(path.join(__dirname, '..', 'web/assets/js/accent.js'), 'utf8');
  assert.doesNotMatch(src, /#[0-9a-f]{6}/i, 'no colour of its own: every tone comes from look.js');
});

test('the gold button, its hover and the polished metal reach every accent, and their dark words read at 4.5:1', () => {
  for (const a of others) for (const scheme of ['dark', 'light']) {
    const r = L.ramp(a.id, scheme);
    for (const k of ['--btn-grad', '--btn-grad-hover', '--gilt']) {
      assert.ok(r[k], `${a.id} ${scheme} ${k}`);
      for (const c of stops(r[k])) assert.ok(L.contrast(L.LUX.ink, c) >= 4.5, `${a.id} ${scheme} ${k}: words on ${c} ${L.contrast(L.LUX.ink, c).toFixed(2)}`);
    }
    assert.strictEqual(stops(r['--metal-stops']).length, 5);
  }
});

test('the stylesheet sets only the accent, never a warning colour, and beats every theme rule and a look of their own', () => {
  for (const a of others) {
    const css = A.css(a.id);
    assert.doesNotMatch(css, /--(red|orange|yellow|green|on-status)\s*:/);
    assert.match(css, /^:root\[data-accent\]\{/);
    assert.match(css, /:root\[data-accent\]:not\(\[data-theme="dark"\]\)\{/);
    assert.match(css, /:root\[data-accent\]\[data-theme="light"\]\{/);
    assert.match(css, /--btn-grad:[^;]+ !important/);
  }
});

test('the gold button and chips draw from tokens, so an accent reaches them', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'web/assets/css', f), 'utf8');
  assert.doesNotMatch(read('lux.css'), /\.btn--gold(:hover)? \{[^}]*#d2ac63/);
  assert.doesNotMatch(read('home.css'), /\.chip-q\[aria-selected="true"\] \{[^}]*#d2ac63/);
});
