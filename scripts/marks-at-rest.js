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

if (require.main === module && process.argv[3] === '--tab') {
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

module.exports = { atRest, tabSwitch };
