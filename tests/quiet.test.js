'use strict';
// How much Sentinel shows and says (Settings: Marks beside links, Pop-up warnings), the same in the Windows app's
// overlay, its warnings and the companion. masks.js holds the rule; each surface must use it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
require('../web/assets/js/masks.js');
const M = globalThis.SentinelMasks;
const STATES = ['red', 'orange', 'yellow', null];

test('marks beside links: every link, risky links, or serious only; a warning or danger mark always shows', () => {
  const seen = (level) => STATES.filter((b) => M.shows(level, b));
  assert.deepEqual(seen('all'), ['red', 'orange', 'yellow', null], 'every link, a tick on safe ones');
  assert.deepEqual(seen('risky'), ['red', 'orange', 'yellow'], 'no ticks, and no dot for a link still being checked');
  assert.deepEqual(seen('danger'), ['red', 'orange'], 'serious only keeps warning and danger');
  for (const odd of [undefined, '', 'none', 'red', 42]) assert.deepEqual(seen(odd), seen('all'), `${odd} falls back to every link`);
});

test('pop-up warnings: always, danger only, or never; a caution page never pops up', () => {
  const loud = (level) => STATES.filter((b) => M.warns(level, b));
  assert.deepEqual(loud('all'), ['red', 'orange']);
  assert.deepEqual(loud('danger'), ['red']);
  assert.deepEqual(loud('quiet'), []);
  for (const odd of [undefined, 'loud', 'off']) assert.deepEqual(loud(odd), loud('all'), `${odd} falls back to always`);
});

test('the companion warns by the same rule, and its older settings move over without hiding a warning', async () => {
  globalThis.chrome = { runtime: {}, storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } } };
  // The companion's modules are plain .js with no package.json of their own, so they are imported from a copy marked as modules.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-quiet-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'brand.js']) fs.copyFileSync(path.join(__dirname, '..', 'extension', 'src', 'lib', f), path.join(dir, f));
  const api = await import(pathToFileURL(path.join(dir, 'api.js')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const level of ['all', 'danger', 'quiet', undefined]) for (const b of STATES) assert.equal(api.warns(level, b), M.warns(level, b), `${level} ${b}`);
  assert.equal(api.DEFAULTS.marksLevel, 'all');
  assert.equal(api.DEFAULTS.warningsLevel, 'all');
  for (const k of api.OLD_LEVEL_KEYS) assert.ok(!(k in api.DEFAULTS), `${k} is gone`);
  const from = (old) => api.levelsFrom(old);
  assert.deepEqual(from({}), { marksLevel: 'all', warningsLevel: 'all' });
  assert.deepEqual(from({ minimumBadge: 'yellow', markSafe: false }), { marksLevel: 'risky', warningsLevel: 'all' });
  assert.deepEqual(from({ minimumBadge: 'orange', markSafe: true }), { marksLevel: 'danger', warningsLevel: 'all' });
  assert.deepEqual(from({ minimumBadge: 'red' }), { marksLevel: 'danger', warningsLevel: 'danger' }, 'an orange mark shows now; an orange page is not warned over, as before');
  assert.deepEqual(from({ notifications: false }), { marksLevel: 'all', warningsLevel: 'all' }, 'notifications off never stopped the warning over a page');
});

test('every surface reads the setting, and the old controls are gone', () => {
  const main = read('desktop/src/main.js');
  // The notification and the card for a flagged page go out only when Pop-up warnings asks for them.
  assert.match(main, /if \(Masks\.warns\(warningsLevel\(\), item\.verdict\.overall\.badge\)\) \{\s*notify\(`Sentinel: \$\{item\.verdict\.overall\.label\}`[^\n]*\n\s*showWarning\(item\);\s*\}/);
  assert.match(main, /lock\.guard\('pop-up warnings quieter'/, 'quieter needs the parent lock open');
  assert.match(read('desktop/src/pages/overlay.html'), /if \(!M\.shows\(marksLevel, m\.pending \? null : m\.badge\)\) \{ m\._cx = null; return; \}/);
  assert.match(read('desktop/src/overlay-preload.js'), /'overlay:level'/);
  for (const f of ['content/serp.js', 'content/hover.js']) assert.match(read(`extension/src/${f}`), /Masks\.shows\(settings\.marksLevel, null\)/, `${f}: a tick only on every-link`);
  assert.match(read('extension/src/content/webchat.js'), /Masks\.shows\(settings\.marksLevel, verdict\.threats\[t\]\.badge\)/);
  const bg = read('extension/src/background.js');
  assert.match(bg, /if \(warns\(settings\.warningsLevel, 'orange'\)\) await warnInPlace/);
  assert.match(bg, /return closeFlagged\(details\);/, 'a red page is stopped whatever is chosen');
  const options = read('extension/src/options.html');
  assert.match(options, /id="marksLevel"/);
  assert.match(options, /id="warningsLevel"/);
  assert.doesNotMatch(`${options}${bg}${read('extension/src/options.js')}`, /minimumBadge|markSafe|settings\.notifications|id="notifications"/);
  const app = read('web/assets/js/app.js');
  assert.match(app, /levelRow\(\{ id: 'marks-beside-links'/);
  assert.match(app, /levelRow\(\{ id: 'warn-level'/);
});
