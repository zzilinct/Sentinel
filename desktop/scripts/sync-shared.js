'use strict';
/**
 * Copies the pieces the desktop app shares with the server (the offline file
 * scanner and its intelligence lists) plus brand settings and icons, so the
 * packaged app is self-contained.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(__dirname, '..');
const SHARED = path.join(APP, 'shared');
const ASSETS = path.join(APP, 'assets');

fs.mkdirSync(SHARED, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

for (const file of ['filescan.js', 'lists.js', 'brands.js']) {
  fs.copyFileSync(path.join(ROOT, 'server', 'lib', 'scan', file), path.join(SHARED, file));
}
fs.copyFileSync(path.join(ROOT, 'brand.json'), path.join(SHARED, 'brand.json'));
fs.copyFileSync(path.join(ROOT, 'web', 'assets', 'js', 'masks.js'), path.join(SHARED, 'masks.js'));

for (const size of [16, 32, 48, 128, 256, 512]) {
  const src = path.join(ROOT, 'extension', 'icons', `icon${size}.png`);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ASSETS, `icon${size}.png`));
}
const big = path.join(ASSETS, 'icon512.png');
if (fs.existsSync(big)) fs.copyFileSync(big, path.join(ASSETS, 'icon.png'));

console.log('  desktop: shared scanner, brand and icons synced');
