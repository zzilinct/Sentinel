'use strict';
/**
 * Rebuilds web/assets/js/three.min.js: only the parts of three.js the home
 * page backdrop (scene3d.js) uses, as one classic script that sets the
 * SentinelThree global. A plain file keeps the site free of a build step and
 * inside its CSP (script-src 'self', no modules from elsewhere).
 *
 *   node scripts/build-three.js
 *
 * three.js and esbuild are fetched into a temporary folder for the build and
 * never become dependencies of the project. Add an export below when the
 * scene needs another piece.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const THREE = '0.186.0';
const OUT = path.join(__dirname, '..', 'web', 'assets', 'js', 'three.min.js');

const CORE = [
  'ACESFilmicToneMapping', 'AdditiveBlending', 'Box3', 'BufferGeometry', 'CanvasTexture', 'Color', 'DirectionalLight',
  'ExtrudeGeometry', 'Float32BufferAttribute', 'Group', 'IcosahedronGeometry', 'Mesh', 'MeshPhysicalMaterial',
  'PerspectiveCamera', 'PlaneGeometry', 'PMREMGenerator', 'PointLight', 'Points', 'PointsMaterial', 'Scene',
  'ShaderMaterial', 'SRGBColorSpace', 'TorusGeometry', 'Vector3', 'WebGLRenderer'
];

const entry = `export { ${CORE.join(', ')} } from 'three';
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
export { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
export { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
export { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
`;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-three-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
fs.writeFileSync(path.join(work, 'package.json'), '{"private":true}');
execFileSync(npm, ['install', '--silent', '--no-audit', '--no-fund', `three@${THREE}`, 'esbuild@0.25'], { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' });
fs.writeFileSync(path.join(work, 'entry.js'), entry);

const esbuild = require(path.join(work, 'node_modules', 'esbuild'));
const result = esbuild.buildSync({
  entryPoints: [path.join(work, 'entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'SentinelThree',
  target: 'es2020',
  legalComments: 'none',
  write: false
});
const header = `/* three.js r${THREE.split('.')[1]}, MIT licence, (c) 2010-2026 three.js authors: https://github.com/mrdoob/three.js/blob/dev/LICENSE
   Only the parts the home page 3D uses, bundled by esbuild as the SentinelThree global. Rebuild with scripts/build-three.js, do not edit. */
`;
fs.writeFileSync(OUT, header + result.outputFiles[0].text);
fs.rmSync(work, { recursive: true, force: true });
console.log(`  wrote ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
