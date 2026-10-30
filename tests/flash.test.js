'use strict';
// The flash counter behind scripts/verify-web/47-calm-dig.js, on series with a known answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { windows, changes, flashesPerSecond, measure } = require('../scripts/verify-web/flash');

const square = (hz, seconds, a, b, fps = 60) => Array.from({ length: seconds * fps }, (_, i) => {
  const t = (i / fps) * 1000;
  return { t, l: Math.floor((t / 1000) * hz * 2) % 2 ? b : a };
});

test('a black and white square wave flashes at its own rate', () => {
  assert.equal(flashesPerSecond(square(5, 3, 0, 1)), 5);
  assert.equal(flashesPerSecond(square(2, 3, 0, 1)), 2);
});

test('changes under 10% of the maximum are no flash, however fast', () => {
  assert.deepEqual(changes(square(10, 3, 0.2, 0.28)), []);
});

test('two bright states are no flash: the darker one must be under 0.80', () => {
  assert.equal(flashesPerSecond(square(5, 3, 0.85, 1)), 0);
});

test('one fade is one change, not a flash', () => {
  const fade = Array.from({ length: 60 }, (_, i) => ({ t: i * 16, l: 1 - i / 59 }));
  assert.equal(changes(fade).length, 1);
  assert.equal(flashesPerSecond(fade), 0);
});

const flat = (w, h, v) => ({ w, h, bpp: 3, px: Buffer.alloc(w * h * 3, v) });

test('a window of a white frame reads 1, of a black frame 0', () => {
  assert.ok(windows(flat(683, 450, 255), 2).every((l) => Math.abs(l - 1) < 1e-9));
  assert.ok(windows(flat(683, 450, 0), 2).every((l) => l === 0));
});

test('measure finds a flashing area on real frames', () => {
  const frames = Array.from({ length: 120 }, (_, i) => ({ t: i * 33, frame: flat(400, 300, Math.floor(i / 3) % 2 ? 255 : 0) }));
  const m = measure(frames, 2);
  assert.ok(m.flashes >= 4, JSON.stringify(m));
  assert.equal(m.swing, 1);
});
