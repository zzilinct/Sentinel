'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = (file) => fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'css', file), 'utf8');
const rule = (text, selector) => {
  const at = text.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} is styled`);
  return text.slice(at, text.indexOf('}', at));
};

// GSAP folds an element's CSS `translate` (and `rotate`, `scale`) into its own transform, in pixels measured once.
// Anything it animates must be placed another way, or it moves when the font or the window changes its size: the
// hero's name slid right and was cut off at the edge.
test('elements GSAP animates (motion.js) are not placed with the CSS translate, rotate or scale properties', () => {
  for (const [file, selector] of [['home.css', '.hero__word'], ['lux.css', '.laser__flare'], ['lux.css', '.laser svg'], ['lux.css', '.laser i']]) {
    assert.doesNotMatch(rule(css(file), selector), /(^|[\s;{])(translate|rotate|scale)\s*:/, `${file} ${selector}`);
  }
});
