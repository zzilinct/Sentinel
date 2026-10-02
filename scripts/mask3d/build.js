'use strict';
/**
 * Builds web/assets/js/mask3d.js from scripts/mask3d/mask3d.src.js: three.js and the masks' code in one minified
 * file, with only the parts of three.js it uses. Three.js and esbuild are fetched into a temporary folder at pinned
 * versions, so the project itself keeps no dependencies.
 *
 *   node scripts/mask3d/build.js
 *
 * The models it loads are web/assets/models/*.glb, exported from Blender:
 *   node scripts/blender/export-svgs.js <svgs>
 *   blender -b --python scripts/blender/masks.py -- --svg-dir <svgs> --out <dir> --mask scam --glb --faces 15000
 *   npx @gltf-transform/cli quantize <dir>/scam.glb web/assets/models/scam.glb --quantize-position 14 --quantize-normal 10
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const THREE = '0.186.1';
const ESBUILD = '0.25.10';
const ROOT = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-mask3d-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
fs.writeFileSync(path.join(work, 'package.json'), '{"private":true}');
execFileSync(npm, ['install', '--silent', '--no-audit', '--no-fund', `three@${THREE}`, `esbuild@${ESBUILD}`], { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' });
const esbuild = require(path.join(work, 'node_modules', 'esbuild'));
const out = path.join(ROOT, 'web', 'assets', 'js', 'mask3d.js');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'mask3d.src.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome110', 'firefox115', 'safari16'],
  nodePaths: [path.join(work, 'node_modules')],
  banner: { js: `/* Sentinel masks in 3D. Built by scripts/mask3d/build.js from scripts/mask3d/mask3d.src.js. three.js ${THREE}, MIT License, (c) 2010-2025 three.js authors. */` },
  outfile: out
});
// esbuild's binary can still be held open on Windows: the temporary folder is left for the system to clear.
try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* left behind */ }
console.log(`  wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
