'use strict';
/**
 * Copies the built Windows installer into web/downloads and records it in
 * latest.json, which the download page reads.
 *
 *   cd desktop && npm run dist:win && cd .. && node scripts/publish-desktop.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'desktop', 'dist');
const OUT = path.join(ROOT, 'web', 'downloads');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version;
const installer = path.join(DIST, `Sentinel-Setup-${version}.exe`);

if (!fs.existsSync(installer)) {
  console.error(`No installer at ${path.relative(ROOT, installer)} - run "npm run dist:win" in desktop/ first.`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(installer, path.join(OUT, `Sentinel-Setup-${version}.exe`));
fs.copyFileSync(installer, path.join(OUT, 'Sentinel-Setup-latest.exe'));

const manifestPath = path.join(OUT, 'latest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
manifest.desktop = {
  version,
  platform: 'windows-x64',
  size: fs.statSync(installer).size,
  builtAt: new Date().toISOString(),
  download: `/downloads/Sentinel-Setup-${version}.exe`
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`  published Sentinel-Setup-${version}.exe (${(manifest.desktop.size / 1048576).toFixed(1)} MB)`);
