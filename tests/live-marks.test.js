'use strict';
// The live-scanning marks (masks.js mark() and tick()), drawn the same by the Windows overlay and the companion.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
require('../web/assets/js/masks.js');
const M = globalThis.SentinelMasks;
const HELMET = 'M32 11.6';

test('each severity is its own tile shape, ringed in its colour, and has its own word', () => {
  // The pictures prove it reads (scripts/verify-web/49-live-marks.js); this pins which shape is which.
  const tile = { red: '<path d="M32 2.5 61.5 32 32 61.5 2.5 32Z"/>', orange: '<rect x="7" y="7"', yellow: '<circle cx="32" cy="32" r="25.5"/>' };
  for (const [badge, shape] of Object.entries(tile)) {
    const svg = M.mark('scam', badge);
    assert.equal(svg.split(shape).length - 1, 2, `${badge}: its tile and the tile's shadow`);
    for (const other of Object.keys(tile)) if (other !== badge) assert.ok(!svg.includes(tile[other]), `${badge} draws no ${other} tile`);
    assert.ok(svg.includes(`stroke="${M.COLORS[badge]}"`), `${badge}: ringed in its own colour`);
  }
  assert.deepEqual(M.SEVERITY, { red: 'Danger', orange: 'Warning', yellow: 'Caution' });
});

test('a flagged mark is the threat\'s own mask in gold, vector and without document-wide ids', () => {
  for (const kind of ['scam', 'virus', 'malware']) {
    const svg = M.mark(kind, 'red');
    assert.ok(svg.includes(M.GLYPHS[kind]), `${kind} draws its own mask`);
    assert.equal(svg.split(M.GLYPHS[kind]).length - 1, 3, `${kind}: shadow, light and face`);
    assert.match(svg, /#d9b65f/i, 'gold face');
    assert.match(svg, /aria-hidden="true"/, 'decorative: the element holding it is named');
    // A gradient or clip id is shared by the whole host page, where it can clash or vanish with the first mark.
    assert.doesNotMatch(svg, /\sid=|url\(#/);
    assert.doesNotMatch(svg, /<image|data:/, 'no raster: sharp at any screen scale');
  }
  // An unknown severity or kind still draws a mark, never nothing: a caution circle, the bare helmet.
  assert.equal(M.mark('worm', 'purple'), M.mark('scam', 'yellow'));
});

test('a safe link gets a small tick, never a mask', () => {
  const t = M.tick();
  assert.doesNotMatch(t, new RegExp(HELMET));
  assert.equal((t.match(/<path /g) || []).length, 2, 'the tick and its dark edge');
  assert.match(t, /stroke="currentColor"/, 'the clear colour comes from the element, never a threat colour');
});

test('the overlay and the companion draw the marks from masks.js, and the companion\'s copy is the same file', () => {
  assert.equal(read('extension/src/content/masks.js'), read('web/assets/js/masks.js'));
  const overlay = read('desktop/src/pages/overlay.html');
  assert.match(overlay, /n\.innerHTML = m\.badge \? M\.mark\(m\.kind, m\.badge\) : M\.tick\(\);/);
  assert.doesNotMatch(overlay, /M\.svg\(m\.badge \? m\.kind : 'scam'\)/, 'no mask on a clear result');
  assert.match(overlay, /n\.setAttribute\('aria-label', 'Sentinel: '/);
  assert.doesNotMatch(overlay.slice(overlay.indexOf('  .mark {')).split('}')[0], /background|border|box-shadow/, 'the tile is the drawing\'s, never a square box around it');
  assert.match(overlay, /@media \(forced-colors: active\) \{ \.mark \{ forced-color-adjust: none; \} \}/);
  const serp = read('extension/src/content/serp.js');
  assert.match(serp, /Masks\.mark\(threat, info\.badge\)/);
  assert.match(serp, /ok\.innerHTML = Masks\.tick\(\);/);
  assert.match(serp, /Masks\.SEVERITY\[info\.badge\]/);
  for (const f of ['mail.js', 'webchat.js']) {
    const code = read(`extension/src/content/${f}`);
    assert.match(code, /Masks\.mark\(t, verdict\.threats\[t\]\.badge\)/, f);
    assert.match(code, /Masks\.SEVERITY\[verdict\.threats\[t\]\.badge\]/, `${f} names the severity`);
  }
  const css = read('extension/src/content/sentinel.css');
  assert.doesNotMatch(css.slice(css.indexOf('.sentinel-mask {')).split('}')[0], /background|box-shadow|border-radius/, 'the tile is the drawing\'s, never a square box around it');
  // A dangerous result is never faded: the mark is its strongest signal, and fading the row faded the mark with it.
  assert.doesNotMatch(css, /sentinel-row|opacity: \.\d+;\s*filter/);
  assert.doesNotMatch(serp, /sentinel-row/);
  assert.doesNotMatch(css.slice(css.indexOf('.sentinel-mask--clear {')).split('}')[0], /opacity/, 'the tick is quiet by size, not faded below contrast');
  assert.match(css, /@media \(forced-colors: active\)/);
});
