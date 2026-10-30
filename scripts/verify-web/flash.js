'use strict';
/**
 * Counts flashes the way WCAG 2.3.1 defines them, from frames of a page: a flash is a pair of opposing changes in
 * relative luminance of at least 10% of the maximum, where the darker state is below 0.80. It counts over any area as
 * large as a quarter of 10 degrees of the visual field, which WCAG puts at 341 by 256 pixels on a 1024 by 768 screen.
 * Windows of that size slide across the frame in half steps. Pure numbers, tested in tests/flash.test.js.
 */

const DELTA = 0.1;
const DARK = 0.8;

/** Relative luminance (WCAG) of an sRGB channel triple, 0 to 255 each. */
function channel(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const LINEAR = Array.from({ length: 256 }, (_, v) => channel(v));

/** Mean relative luminance of each window of a frame ({ w, h, bpp, px }), `scale` CSS pixels to a frame pixel. */
function windows(frame, scale = 1, size = { w: 341, h: 256 }) {
  const { w, h, bpp, px } = frame;
  const tw = Math.max(1, Math.round(size.w / scale / 2));
  const th = Math.max(1, Math.round(size.h / scale / 2));
  const cols = Math.ceil(w / tw);
  const rows = Math.ceil(h / th);
  const sum = new Float64Array(cols * rows);
  const count = new Float64Array(cols * rows);
  // Every fourth pixel of every second row: plenty for a mean over this many pixels.
  for (let y = 0; y < h; y += 2) {
    const row = Math.floor(y / th);
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * bpp;
      const t = row * cols + Math.floor(x / tw);
      sum[t] += 0.2126 * LINEAR[px[i]] + 0.7152 * LINEAR[px[i + 1]] + 0.0722 * LINEAR[px[i + 2]];
      count[t] += 1;
    }
  }
  // Each window is 2 by 2 half-size tiles.
  const out = [];
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const at = [r * cols + c, r * cols + c + 1, (r + 1) * cols + c, (r + 1) * cols + c + 1];
      out.push(at.reduce((s, i) => s + sum[i], 0) / at.reduce((s, i) => s + count[i], 0));
    }
  }
  return out;
}

/** The moments (ms) of a series [{ t, l }] at which it changed direction by at least DELTA with the dark side under DARK. */
function changes(series) {
  const out = [];
  let peak = series[0].l;   // the far end of the change under way
  let dir = 0;
  for (const { t, l } of series) {
    if ((dir > 0 && l > peak) || (dir < 0 && l < peak)) peak = l;
    else if (Math.abs(l - peak) >= DELTA && Math.min(l, peak) < DARK) { dir = l > peak ? 1 : -1; peak = l; out.push(t); }
  }
  return out;
}

/** The most flashes in any one second of a series. */
function flashesPerSecond(series) {
  const at = changes(series);
  let most = 0;
  for (let i = 0; i < at.length; i++) {
    let n = 0;
    while (i + n < at.length && at[i + n] - at[i] <= 1000) n++;
    most = Math.max(most, Math.floor(n / 2));
  }
  return most;
}

/** Over frames [{ t, frame }]: the worst window's flashes per second, the frames a second, and the largest change seen. */
function measure(frames, scale = 1) {
  const all = frames.map((f) => ({ t: f.t, l: windows(f.frame, scale) }));
  const count = all.length ? all[0].l.length : 0;
  let flashes = 0;
  let swing = 0;
  for (let i = 0; i < count; i++) {
    const series = all.map((f) => ({ t: f.t, l: f.l[i] }));
    flashes = Math.max(flashes, flashesPerSecond(series));
    const ls = series.map((s) => s.l);
    swing = Math.max(swing, Math.max(...ls) - Math.min(...ls));
  }
  const ms = all.length > 1 ? all[all.length - 1].t - all[0].t : 0;
  return { flashes, fps: ms ? Math.round(((all.length - 1) / ms) * 10000) / 10 : 0, swing: Math.round(swing * 1000) / 1000, frames: all.length };
}

module.exports = { windows, changes, flashesPerSecond, measure };
