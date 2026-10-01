'use strict';
/**
 * Writes the mask drawings from web/assets/js/masks.js as SVG files, for scripts/blender/masks.py to build the 3D
 * renders from. The renders on the site are made from exactly these shapes, so the 2D icons and the 3D masks
 * always match.
 *
 *   node scripts/blender/export-svgs.js <out-dir>
 *   python scripts/blender/masks.py --svg-dir <out-dir> --out <renders> --mask scam --tint red
 *
 * The web images (web/assets/img/masks/*.webp) are the renders cropped and saved at 700x1000 (the lying black
 * mask at its own size).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const out = path.resolve(process.argv[2] || 'mask-svgs');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'assets', 'js', 'masks.js'), 'utf8'), ctx);
const { GLYPHS } = ctx.SentinelMasks;

fs.mkdirSync(out, { recursive: true });
for (const name of ['scam', 'virus', 'malware', 'logo']) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${GLYPHS[name].replace(/currentColor/g, '#000')}</svg>`;
  fs.writeFileSync(path.join(out, `${name}.svg`), svg);
}
console.log(`  wrote scam, virus, malware and logo SVGs to ${out}`);
