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

test('each severity reads without colour: its own seal shape and its own word', () => {
  const shapes = ['red', 'orange', 'yellow'].map((b) => M.mark('scam', b).replace(/#[0-9a-f]{6}/gi, ''));
  assert.equal(new Set(shapes).size, 3, 'red, orange and yellow differ by more than colour');
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
  // An unknown severity still draws a seal, never nothing.
  assert.ok(M.mark('scam', 'purple').includes('<circle cx="50" cy="50"'));
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
  assert.match(overlay, /\.mark\.is-clear \{[^}]*background: none;[^}]*border: 0;/, 'the tick has no tile');
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
  assert.match(css, /\.sentinel-mask \{[^}]*background: #0c0d10 !important;/, 'the same dark tile as the overlay');
  assert.doesNotMatch(css.slice(css.indexOf('.sentinel-mask--clear {')).split('}')[0], /opacity/, 'the tick is quiet by size, not faded below contrast');
  assert.match(css, /@media \(forced-colors: active\)/);
});

test('hover reasons: one plain sentence why a site is flagged, the same in the overlay, the companion\'s tip and its marks', () => {
  const { SENTENCES } = require('../server/lib/scan/plain');
  // Every sentence a reason can be, cut to the tip's length at a word, with no em dash.
  for (const [id, entry] of Object.entries(SENTENCES)) {
    for (let i = 1; i < entry.length; i += 2) {
      if (typeof entry[i] !== 'string') continue;
      const line = M.reasonLine([{ threat: 'scam', plain: entry[i], text: 'raw detail' }], 'scam');
      assert.ok(line.length > 0 && line.length <= 110, `${id}: ${line}`);
      assert.doesNotMatch(line, /\u2014/, id);
      if (entry[i].length <= 110) assert.equal(line, entry[i].replace(/\s+/g, ' ').trim(), id);
      else assert.match(line, /\S\u2026$/, `${id} is cut at a word`);
    }
  }
  // The reason about the threat the mark shows, then the strongest; an older server's detail; never empty.
  const reasons = [{ threat: 'virus', plain: 'A virus reason.' }, { threat: 'scam', plain: 'A scam reason.' }];
  assert.equal(M.reasonLine(reasons, 'scam'), 'A scam reason.');
  assert.equal(M.reasonLine(reasons, 'malware'), 'A virus reason.');
  assert.equal(M.reasonLine([{ threat: 'scam', text: 'Older server detail' }], 'scam'), 'Older server detail');
  assert.equal(M.reasonLine([], 'scam'), 'Open it with care.');
  assert.equal(M.reasonLine(undefined, 'scam'), 'Open it with care.');

  // The engine sends the plain sentence beside the detail.
  assert.match(read('server/lib/scan/engine.js'), /plain: plainFor\(\{ id: r\.id, detail: r\.text \}\) \|\| r\.text/);
  // The overlay's marks carry it, only when flagged.
  assert.equal((read('desktop/src/watch.js').match(/reason: badge \? reasonLine\(v\.reasons, kind\) : ''/g) || []).length, 2);
  // The companion's search marks: no native title (it carried no reason, waited a second and never showed for the
  // keyboard), the reason in their name, and the shared tip on hover and focus.
  const serp = read('extension/src/content/serp.js');
  assert.doesNotMatch(serp, /\.title = |title=/, 'no native title on a mark');
  assert.match(serp, /aria-label', `Sentinel: \$\{Masks\.SEVERITY\[info\.badge\] \|\| 'Caution'\}, \$\{info\.label\}\. \$\{Masks\.reasonLine\(verdict\.reasons, threat\)\}`/);
  assert.match(serp, /'focusin'[^\n]*tipShow\(m, 0\)/);
  assert.match(serp, /'pointerover'[^\n]*tipShow\(m, 250\)/);
  const hover = read('extension/src/content/hover.js');
  assert.match(hover, /reason: Masks\.reasonLine\(verdict\.reasons, threat\)/);
  assert.match(hover, /el\.querySelector\('p'\)\.textContent = line\.reason/, 'set as text, never as HTML');
  assert.doesNotMatch(hover, /nowrap/, 'a reason wraps to a second line instead of being cut off');
  assert.match(hover, /reason: '', host \}/, 'a clear link gets no reason');
});
