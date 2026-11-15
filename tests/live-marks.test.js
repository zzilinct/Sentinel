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

test('the overlay\'s digits tell a verdict only where its mark shows: Serious only never tints a safe link green', () => {
  const html = read('desktop/src/pages/overlay.html');
  const src = /function digLinks\(\) \{[\s\S]*?\r?\n {2}\}\r?\n/.exec(html)[0];
  const current = [
    { x: 0, y: 0, w: 10, h: 10, pending: false, badge: null },
    { x: 0, y: 20, w: 10, h: 10, pending: false, badge: 'yellow' },
    { x: 0, y: 40, w: 10, h: 10, pending: false, badge: 'red' },
    { x: 0, y: 60, w: 10, h: 10, pending: true, badge: null }
  ];
  const colours = (level) => new Function('M', 'current', 'marksLevel', 'shiftX', 'shiftY', 'DIG_COLOR', `${src}; return digLinks();`)(
    M, current, level, 0, 0, { yellow: 'yellow', orange: 'orange', red: 'red' }).map((l) => l.color);
  assert.deepStrictEqual(colours('all'), ['green', 'yellow', 'red', null]);
  assert.deepStrictEqual(colours('risky'), [null, 'yellow', 'red', null]);
  assert.deepStrictEqual(colours('danger'), [null, null, 'red', null], 'Serious only: no green, no yellow');
});

test('a mark that is no longer wanted eases out, as the Motion setting allows, instead of vanishing', () => {
  const html = read('desktop/src/pages/overlay.html').replace(/\r\n/g, '\n');
  assert.match(html, /if \(!seen\[key\]\) \{ dropMark\(n\); nodes\.delete\(key\); \}/, 'scrolled away or left out by Marks beside links');
  assert.match(html, /function dropMark\(n\) \{\n\s+if \(document\.documentElement\.dataset\.motion === 'off'\) \{ n\.remove\(\); return; \}/, 'Off: gone at once');
  assert.match(html, /n\.style\.opacity = cs\.opacity;/, 'from where it is, not from the hidden base style');
  assert.match(html, /\.mark\.is-out \{ animation: mark-out \.16s/, 'Full: a short shrink and fade');
  assert.match(html, /:root\[data-motion="calm"\] \.mark\.is-out \{ animation-name: mark-fade; \}/, 'Calm: a fade only');
  assert.ok(html.indexOf('.mark.is-out {') > html.indexOf('.mark.is-pending {') && html.indexOf('.mark.is-out {') > html.indexOf('.mark.is-in {'), 'leaving wins over arriving and waiting');
});

test('the overlay\'s tip never covers another mark: below, else above, else beside the mark', () => {
  const html = read('desktop/src/pages/overlay.html').replace(/\r\n/g, '\n');
  const tipSpot = new Function(`${/function tipSpot\([\s\S]*?\n {2}\}\n/.exec(html)[0]}; return tipSpot;`)();
  // An inbox: a mark on every 40 px row, in one column (live-e2e: the tip below hid the next row's tick).
  const column = [43, 83, 163, 203, 243].map((y) => [911, y]);
  const inbox = tipSpot(911, 123, 300, 64, 1016, 636, column);
  assert.deepStrictEqual(inbox, { left: 587, top: 91 }, 'to the left of the column');
  assert.ok(!column.some(([x, y]) => x > inbox.left - 14 && x < inbox.left + 314 && y > inbox.top - 14 && y < inbox.top + 78));
  assert.deepStrictEqual(tipSpot(400, 200, 300, 64, 1016, 636, [[400, 330]]), { left: 250, top: 220 }, 'nothing below: below, as before');
  assert.deepStrictEqual(tipSpot(400, 200, 300, 64, 1016, 636, [[420, 250]]), { left: 250, top: 116 }, 'a mark just below: above');
  assert.deepStrictEqual(tipSpot(400, 600, 300, 64, 1016, 636, []), { left: 250, top: 516 }, 'at the bottom of the page: above');
  assert.match(html, /var at = tipSpot\(hit\._cx \+ shiftX, hit\._cy \+ shiftY, tip\.offsetWidth, tip\.offsetHeight/);
});
