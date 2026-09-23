'use strict';
/**
 * Gathers everything the desktop app ships that lives elsewhere in the repo:
 *
 *   shared/   the on-device file scanner and its lists (download protection)
 *   assets/   icons
 *   bundle/   the whole Sentinel server and website, so the app can run the
 *             product by itself with nothing hosted anywhere
 *   companion-firefox/   the Firefox build of the companion (from build-extension)
 *
 * All four folders are build outputs and git-ignored.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(__dirname, '..');
const SHARED = path.join(APP, 'shared');
const ASSETS = path.join(APP, 'assets');
const BUNDLE = path.join(APP, 'bundle');

// Rewriting a file that has not changed is not harmless: another process may be in the middle of loading it
// (the test files run side by side), and would read it half written.
function copyIfChanged(from, to) {
  try { if (fs.readFileSync(from).equals(fs.readFileSync(to))) return; } catch { /* not there yet */ }
  fs.copyFileSync(from, to);
}

fs.mkdirSync(SHARED, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

for (const file of ['filescan.js', 'lists.js', 'brands.js']) {
  copyIfChanged(path.join(ROOT, 'server', 'lib', 'scan', file), path.join(SHARED, file));
}
copyIfChanged(path.join(ROOT, 'web', 'assets', 'js', 'masks.js'), path.join(SHARED, 'masks.js'));

for (const size of [16, 32, 48, 128, 256, 512]) {
  const src = path.join(ROOT, 'extension', 'icons', `icon${size}.png`);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ASSETS, `icon${size}.png`));
}
const big = path.join(ASSETS, 'icon512.png');
if (fs.existsSync(big)) fs.copyFileSync(big, path.join(ASSETS, 'icon.png'));

/* ------------------------------------------------ the embedded server */

// The bundle is source and static files only. Installers are far too large
// to carry inside another installer, and the running app never needs them.
const SKIP = (rel) => /\.(exe|dmg|AppImage|msi)$/i.test(rel) || /(^|[\\/])\.DS_Store$/.test(rel);

/** `skip(rel)` leaves out anything else a particular tree should not carry. */
function copyTree(from, to, skip = () => false, rel = '') {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (SKIP(childRel) || skip(childRel)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest, skip, childRel);
    else fs.copyFileSync(src, dest);
  }
}

/* ------------------------------------------------- firefox companion */

// build-extension.js writes the Firefox manifest into its archive only; lay the
// same files out as a folder so the app can point Firefox at it.
const FF = path.join(APP, 'companion-firefox');
fs.rmSync(FF, { recursive: true, force: true });
const EXT = path.join(ROOT, 'extension');
if (!fs.existsSync(path.join(EXT, 'src', 'background.firefox.js'))) require(path.join(ROOT, 'scripts', 'build-extension.js'));
copyTree(EXT, FF);
fs.rmSync(path.join(FF, 'src', 'background.js'), { force: true });
{
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand.json'), 'utf8'));
  delete manifest.minimum_chrome_version;
  delete manifest.externally_connectable;
  manifest.background = { scripts: ['src/background.firefox.js'] };
  manifest.browser_specific_settings = { gecko: { id: `companion@${brand.apexDomain}`, strict_min_version: '128.0', data_collection_permissions: { required: ['browsingActivity', 'websiteContent'] } } };
  fs.writeFileSync(path.join(FF, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

fs.rmSync(BUNDLE, { recursive: true, force: true });
copyTree(path.join(ROOT, 'server'), path.join(BUNDLE, 'server'));
// web/downloads/ holds the companion zips the website offers; the app never serves them,
// and bundling them would ship them inside the installer.
copyTree(path.join(ROOT, 'web'), path.join(BUNDLE, 'web'), (rel) => rel === 'downloads');
fs.copyFileSync(path.join(ROOT, 'brand.json'), path.join(BUNDLE, 'brand.json'));
// The server reads its own version from here.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(BUNDLE, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true }, null, 2));

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).length;
console.log(`  desktop: shared scanner and icons synced; server bundle has ${count(BUNDLE)} files`);
