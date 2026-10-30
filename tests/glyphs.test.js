'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bands, LEVELS, MAX, PERIOD } = require('../web/assets/js/glyphs.js');

test('glyph field: the bands stay between their faintest and brightest, and with the pointer never pass MAX', () => {
  for (const theme of ['dark', 'light']) {
    const level = LEVELS[theme];
    assert.ok(level.peak + level.glow <= MAX[theme] + 1e-9, `${theme}: band and pointer together stay under MAX`);
    for (const phase of [0, 0.25, 0.5, 3.7]) {
      const stops = bands(2400, phase, level);
      assert.equal(stops[0][0], 0);
      assert.equal(stops[stops.length - 1][0], 1);
      for (let i = 1; i < stops.length; i++) assert.ok(stops[i][0] > stops[i - 1][0], 'positions rise');
      for (const [, a] of stops) assert.ok(a >= level.floor - 1e-9 && a <= level.peak + 1e-9, `${theme}: ${a} in range`);
      // Bands, not a flat wash: some stops bright, some faint.
      const as = stops.map(([, a]) => a);
      assert.ok(Math.max(...as) - Math.min(...as) > (level.peak - level.floor) * 0.6);
    }
  }
});

test('glyph field: the bands move on with the phase, and come back after the long sine\'s whole cycle', () => {
  const level = LEVELS.dark;
  const a = bands(PERIOD * 4, 0, level);
  const b = bands(PERIOD * 4, 0.2, level);
  const c = bands(PERIOD * 4, 2.3 * 10, level); // a whole number of both sines' cycles
  assert.notDeepEqual(a.map(([, x]) => x.toFixed(4)), b.map(([, x]) => x.toFixed(4)));
  assert.deepEqual(a.map(([, x]) => x.toFixed(4)), c.map(([, x]) => x.toFixed(4)));
  assert.ok(bands(1e7, 0, level).length <= 161, 'the stops are capped on a huge section');
});

test('glyph field: nothing behind the heading, coming in below it, full in the middle, gone at the bottom', () => {
  const { veil } = require('../web/assets/js/glyphs.js');
  const h = 1200, clear = 170;
  assert.equal(veil(0, h, clear), 0);
  assert.equal(veil(clear, h, clear), 0);
  assert.ok(veil(clear + 70, h, clear) > 0.4 && veil(clear + 70, h, clear) < 0.6, 'half way up its ramp');
  assert.equal(veil(600, h, clear), 1);
  assert.equal(veil(h, h, clear), 0);
  assert.ok(veil(h * 0.95, h, clear) < 0.5, 'fading at the bottom');
  // A short section: the ramp never runs past the fade at the bottom.
  for (let y = 0; y <= 300; y += 10) { const v = veil(y, 300, 200); assert.ok(v >= 0 && v <= 1, `${y}: ${v}`); }
});
