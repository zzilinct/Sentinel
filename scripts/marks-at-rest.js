'use strict';
// Are the live-scanning marks on their results once the page is still? Reads the overlay's frame trace
// (SENTINEL_OVERLAY_TRACE, frames.txt) and compares where the marks came to rest (F: the layer's shift) with where
// the browser last said the links are (R, since the marks were last placed: M ... fresh). Used by
// scripts/live-e2e.ps1 after Home, End, Page Down and a theme change. Exit 1 when they are apart.
// Usage: node scripts/marks-at-rest.js frames.txt [label]
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

if (require.main === module) {
  const r = atRest(fs.readFileSync(process.argv[2], 'utf8'));
  const label = process.argv[3] || 'now';
  if (r.off <= 4) console.log(`marks at rest ${label}: on their results (${r.shift.toFixed(0)} px moved, browser says ${r.browser})`);
  else { console.log(`marks at rest ${label}: ${r.off} px off their results (moved ${r.shift.toFixed(0)} px, browser says ${r.browser})`); process.exitCode = 1; }
}

module.exports = { atRest };
