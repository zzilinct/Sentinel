'use strict';
/**
 * The companion's own pages and the look: danger, warning and safe keep their exact colours in every accent and
 * scheme, written once per scheme in popup.css and never by the accent; each page draws the kept look before its
 * first paint and asks for the chosen one after (lib/lookhere.js). In a real Chrome and Firefox:
 * scripts/verify-web/50-companion-look.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../web/assets/js/look.js');

const SRC = path.join(__dirname, '..', 'extension', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const STATUS = { dark: { '--red': '#ff7a7e', '--orange': '#f08a24', '--green': '#4cb782' }, light: { '--red': '#b3261e', '--orange': '#a84600', '--green': '#1e7a3c' } };

/** The custom properties a CSS block sets. */
function props(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

test('danger, warning and safe: the same bytes in every block of popup.css that sets them, and never the accent\'s', () => {
  const css = read('popup.css');
  const dark = props(css.match(/^:root \{([^}]+)\}/m)[1]);
  const lightSystem = props(css.match(/:root:not\(\[data-theme="dark"\]\) \{([^}]+)\}/)[1]);
  const lightChosen = props(css.match(/:root\[data-theme="light"\] \{([^}]+)\}/)[1]);
  for (const [k, v] of Object.entries(STATUS.dark)) assert.equal(dark[k], v, `dark ${k}`);
  for (const block of [lightSystem, lightChosen]) for (const [k, v] of Object.entries(STATUS.light)) assert.equal(block[k], v, `light ${k}`);
  for (const a of L.ACCENTS) for (const scheme of ['dark', 'light']) {
    const vars = L.ramp(a.id, scheme);
    for (const k of ['--red', '--orange', '--yellow', '--green']) assert.ok(!(k in vars), `${a.id} ${scheme} must not set ${k}`);
  }
});

test('every page of the companion draws the kept look first, then asks for the chosen one', () => {
  for (const page of ['popup.html', 'options.html', 'block.html']) {
    const html = read(page);
    const look = html.indexOf('<script src="lib/look.js">');
    assert.ok(look > 0 && look < html.indexOf('<link rel="stylesheet"'), `${page}: look.js before the stylesheets, so nothing is drawn gold first`);
    assert.ok(html.indexOf('lib/lookhere.js') > html.indexOf('</main>') || html.indexOf('lib/lookhere.js') > html.indexOf('<body'), `${page}: lookhere.js in the body`);
  }
  // The popup no longer asks the app itself: the worker does, for every page (background.js look).
  assert.doesNotMatch(read('popup.js'), /47821/);
  assert.match(read('background.js'), /async look\(\{ change \}, sender\) \{\s*fromOptions\(sender\);/);
});

test('the settings page offers the same choice as the app: Theme (3) and Colour (every accent), as radio groups', () => {
  const html = read('options.html');
  assert.match(html, /<section class="group" id="look">[\s\S]*<legend>Theme<\/legend>[\s\S]*<legend>Colour<\/legend>/);
  const js = read('options.js');
  assert.match(js, /\['auto', 'Auto'\], \['light', 'Light'\], \['dark', 'Dark'\]/);
  assert.match(js, /L\.ACCENTS\.map/);
  assert.match(js, /type="radio" name="look-accent"/);
});
