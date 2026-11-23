'use strict';
// Are the live-scanning marks on their results once the page is still? Reads the overlay's frame trace
// (SENTINEL_OVERLAY_TRACE, frames.txt) and compares where the marks came to rest (F: the layer's shift) with where
// the browser last said the links are (R, since the marks were last placed: M ... fresh). Used by
// scripts/live-e2e.ps1 after Home, End, Page Down and a theme change. Exit 1 when they are apart.
// Usage: node scripts/marks-at-rest.js frames.txt [label], or frames.txt --tab [label] (see tabSwitch)
const fs = require('fs');

function atRest(text) {
  let shift = 0;
  let browser = 0;
  for (const line of text.split(/\r?\n/)) {
    const f = line.split(' ');
    if (f[0] === 'M' && f.includes('fresh')) { shift = 0; browser = 0; }
    else if (f[0] === 'F' && Number.isFinite(Number(f[2]))) shift = Number(f[2]);
    else if (f[0] === 'R' && Number.isFinite(Number(f[3]))) browser = Number(f[3]);
  }
  return { shift, browser, off: Math.round(Math.abs(shift - browser)) };
}

// A new tab opened over a page with marks (from the last "# ... opens" line in the trace): the old marks must go at
// once, before any movement of the hidden page reaches them (they slid 80 px for 400 ms in 1.20.0). Returns how far
// they were moved before new positions came.
function tabSwitch(text) {
  const lines = text.split(/\r?\n/);
  let from = -1;
  lines.forEach((l, i) => { if (/^# .* opens$/.test(l)) from = i; });
  let slid = 0;
  for (let i = from + 1; from >= 0 && i < lines.length; i++) {
    const f = lines[i].split(' ');
    if (f[0] === 'M') break;
    if (f[0] === 'R' && Number.isFinite(Number(f[3]))) slid = Math.max(slid, Math.abs(Number(f[3])));
  }
  return { slid: Math.round(slid) };
}

// A repaint that only looked like a scroll (from the last "# ... repaint" line, made on purpose by the test inbox's
// R key): how far the pixels said the page moved (P); how the reader put the marks right and how long after the pixels
// moved: an S marked settle (the links never moved, Date clock) or a fresh placing (M ... fresh, the overlay's clock
// from its first frame following the pixels); whether anything said the page really moved first; and where the
// flagged mark (K) sat before the repaint and after the correction; and how far the marks followed the pixels before
// the correction (F, the overlay's goal): a repaint is not a scroll, so they must not have moved onto other rows.
function repaint(text) {
  const lines = text.split(/\r?\n/);
  let from = -1;
  lines.forEach((l, i) => { if (/^# .* repaint/.test(l)) from = i; });
  let px = 0, lastPx = 0, firstF = 0, via = '', ms = null, moved = false, yBefore = null, yAfter = null, followed = 0;
  for (let i = 0; i < from; i++) { const f = lines[i].split(' '); if (f[0] === 'K') yBefore = Number(f[2]); }
  for (let i = from + 1; from >= 0 && i < lines.length; i++) {
    const f = lines[i].split(' ');
    if (!via) {
      if (f[0] === 'P') { px += Number(f[3]); lastPx = Number(f[1]); }
      else if (f[0] === 'F' && lastPx) { if (!firstF) firstF = Number(f[1]); followed = Math.max(followed, Math.abs(Number(f[3]))); }
      else if (f[0] === 'S' && f[4] === 'settle') { via = 'settle'; ms = lastPx ? Number(f[1]) - lastPx : null; }
      else if (f[0] === 'S') moved = true;
      // No F before it: the marks stood still (they stepped aside, 1.21.1), so nothing was off to be put right.
      else if (f[0] === 'M' && f.includes('fresh') && lastPx) { via = 'fresh read'; ms = firstF ? Math.round(Number(f[1]) - firstF) : 0; }
    } else if (f[0] === 'K') { yAfter = Number(f[2]); break; }
  }
  return { px: Math.round(px), ms, via, moved, yBefore, yAfter, followed: Math.round(followed), ...atRest(text) };
}
// The reader waits 700 ms after the pixels last moved before it reads again (watch.js); a read takes a moment more.
const SETTLE_MS = 1000;

if (require.main === module && process.argv[3] === '--repaint') {
  const r = repaint(fs.readFileSync(process.argv[2], 'utf8'));
  const label = process.argv[4] || 'a repaint';
  if (Math.abs(r.px) < 20) { console.log(`marks on ${label}: the pixels never saw it move (${r.px} px), so nothing was shown`); process.exitCode = 1; }
  else if (r.ms === null || r.moved) { console.log(`marks on ${label}: the pixels saw ${r.px} px, and ${r.moved ? 'the reader took it for a real scroll' : 'no correction came'}`); process.exitCode = 1; }
  // A repaint whose rows all keep their words must be put right by the reader's settle (a read that found nothing
  // changed), not by a new read's placing.
  // Until 1.21.1 the marks went with the pixels for most of a second, the scam masks on the honest emails beside them.
  else if (r.followed > 20) { console.log(`marks on ${label}: the marks followed the pixels ${r.followed} px onto other rows before the correction`); process.exitCode = 1; }
  else if (process.argv[5] === 'settle' && r.via !== 'settle') { console.log(`marks on ${label}: put right by a ${r.via}, not a settle, ${r.ms} ms after the pixels moved ${r.px} px`); process.exitCode = 1; }
  else if (r.ms > SETTLE_MS || r.off > 4 || (r.yBefore !== null && (r.yAfter === null || Math.abs(r.yAfter - r.yBefore) > 4))) {
    console.log(`marks on ${label}: put right by a ${r.via} ${r.ms} ms after the pixels moved ${r.px} px; flagged mark at ${r.yAfter}, its row at ${r.yBefore}; at rest ${r.off} px off`); process.exitCode = 1;
  } else console.log(`marks on ${label}: the pixels saw ${r.px} px the rows never moved; the marks ${r.followed ? `followed ${r.followed} px and were put right` : 'stood still, stepped aside, and were shown again'} by a ${r.via}${r.followed || r.via === 'settle' ? ` ${r.ms} ms later` : ''}, the flagged mark on its row (${r.yBefore})`);
} else if (require.main === module && process.argv[3] === '--tab') {
  const r = tabSwitch(fs.readFileSync(process.argv[2], 'utf8'));
  const label = process.argv[4] || 'a new tab';
  if (r.slid <= 2) console.log(`marks on ${label}: the old page's marks went at once`);
  else { console.log(`marks on ${label}: the old page's marks slid ${r.slid} px before going`); process.exitCode = 1; }
} else if (require.main === module) {
  const r = atRest(fs.readFileSync(process.argv[2], 'utf8'));
  const label = process.argv[3] || 'now';
  if (r.off <= 4) console.log(`marks at rest ${label}: on their results (${r.shift.toFixed(0)} px moved, browser says ${r.browser})`);
  else { console.log(`marks at rest ${label}: ${r.off} px off their results (moved ${r.shift.toFixed(0)} px, browser says ${r.browser})`); process.exitCode = 1; }
}

module.exports = { atRest, tabSwitch, repaint, SETTLE_MS };
