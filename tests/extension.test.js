'use strict';
/**
 * The companion has to run in two engines from one codebase. These are the rules
 * that make that true, checked on the built packages. (scripts/verify-companion*.js
 * go further and drive real browsers; they need browsers installed, so they are
 * run by hand before a release rather than here.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension', 'src');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let chromium;
let firefox;
test.before(() => {
  const log = console.log;
  console.log = () => {};
  try { require('../scripts/build-extension.js'); } finally { console.log = log; }
  chromium = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
  // The Firefox manifest only exists inside its archive; the desktop sync lays it out as a folder.
  require('../desktop/scripts/sync-shared.js');
  firefox = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'companion-firefox', 'manifest.json'), 'utf8'));
});

test('every script reaches the browser through the shared `ext` namespace, with promises', () => {
  // masks.js is shared with the site; background.firefox.js is generated from the files checked here.
  const scripts = walk(SRC).filter((f) => f.endsWith('.js') && !f.endsWith('masks.js') && !f.endsWith('background.firefox.js'));
  assert.ok(scripts.length >= 8);
  for (const file of scripts) {
    const code = strip(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(ROOT, file);
    assert.doesNotMatch(code, /\bchrome\.(runtime|storage|tabs|action|alarms|notifications|contextMenus|webNavigation|permissions|scripting|windows)\b/, `${rel} uses a bare chrome.* API`);
    // (the one allowed mention is the shim itself: globalThis.browser.runtime ? ...)
    assert.doesNotMatch(code, /(?<!globalThis\.)\bbrowser\.(runtime|storage|tabs)\b/, `${rel} uses a bare browser.* API`);
    if (/\bext\./.test(code)) assert.match(code, /globalThis\.browser && globalThis\.browser\.runtime \? globalThis\.browser : globalThis\.chrome|import \{[^}]*\bext\b[^}]*\} from/, `${rel} uses ext without defining or importing it`);
    // Callback style does not exist on Firefox's promise namespace.
    assert.doesNotMatch(code, /ext\.runtime\.sendMessage\([^()]*,\s*\(?\w*\)?\s*=>/, `${rel} passes a callback to sendMessage`);
    assert.doesNotMatch(code, /ext\.storage\.(sync|local)\.(get|set)\([^()]*,\s*\(?\w*\)?\s*=>/, `${rel} passes a callback to storage`);
  }
});

test('content scripts find the masks in both engines', () => {
  // Firefox runs content scripts in a sandbox: globalThis is not the page's window.
  for (const name of ['serp.js', 'mail.js', 'guard.js']) {
    const code = strip(fs.readFileSync(path.join(SRC, 'content', name), 'utf8'));
    assert.match(code, /globalThis\.SentinelMasks/, `${name} must read the masks from globalThis`);
    assert.doesNotMatch(code.replace(/globalThis\.SentinelMasks \|\| window\.SentinelMasks/g, ''), /window\.SentinelMasks/, `${name} reads the masks from window only`);
  }
});

test('the Chromium package is a Manifest V3 service-worker extension', () => {
  assert.equal(chromium.manifest_version, 3);
  assert.equal(chromium.background.service_worker, 'src/background.js');
  assert.equal(chromium.background.type, 'module');
  assert.ok(chromium.externally_connectable.matches.length >= 1);
  assert.equal(chromium.browser_specific_settings, undefined, 'no Firefox-only keys for Chromium to warn about');
});

test('the Firefox package is an event page with nothing Chromium-only in it', () => {
  assert.equal(firefox.manifest_version, 3);
  assert.equal(firefox.background.service_worker, undefined, 'Firefox has no extension service workers');
  assert.deepEqual(firefox.background.scripts, ['src/background.firefox.js']);
  assert.equal(firefox.background.type, undefined, 'one flattened classic script, no module loader needed');
  assert.equal(firefox.externally_connectable, undefined, 'Firefox does not support it');
  assert.equal(firefox.minimum_chrome_version, undefined);
  assert.match(firefox.browser_specific_settings.gecko.id, /^companion@/);
  assert.ok(firefox.browser_specific_settings.gecko.data_collection_permissions.required.length);
  assert.ok(firefox.permissions.includes('permissions'), 'it must be able to ask for site access');
  assert.equal(firefox.options_ui.page, 'src/options.html');

  const bundle = fs.readFileSync(path.join(ROOT, 'desktop', 'companion-firefox', 'src', 'background.firefox.js'), 'utf8');
  assert.doesNotMatch(bundle, /^\s*(import|export)\s/m, 'a classic script cannot import or export');
  assert.doesNotThrow(() => new vm.Script(bundle, { filename: 'background.firefox.js' }), 'it parses as a classic script');
  assert.doesNotMatch(strip(bundle), /\bchrome\.(runtime|storage|tabs|action|alarms)\b/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'desktop', 'companion-firefox', 'src', 'background.js')), 'the service worker is not shipped to Firefox');
});

test('pairing works without externally_connectable, and Firefox is asked for site access', () => {
  for (const manifest of [chromium, firefox]) {
    const connect = manifest.content_scripts.find((c) => c.js.includes('src/content/connect.js'));
    assert.ok(connect, 'the /connect content script ships in both packages');
    assert.ok(connect.matches.some((m) => m.includes('/connect')));
  }
  const background = strip(fs.readFileSync(path.join(SRC, 'background.js'), 'utf8'));
  assert.match(background, /content_scripts[\s\S]{0,200}connect\.js/, 'trusted origins come from the connect content script, which both builds carry');
  assert.match(background, /if \(ext\.runtime\.onMessageExternal\)/, 'external messages are optional');
  const popup = strip(fs.readFileSync(path.join(SRC, 'popup.js'), 'utf8'));
  assert.match(popup, /permissions\.request\(\{ origins: \['<all_urls>'\] \}\)/, 'the popup asks for site access the first time');
});

test('the search overlay is a shadow-root overlay that never takes a click, and live hours are only spent on a tab in use', () => {
  const serp = strip(fs.readFileSync(path.join(SRC, 'content', 'serp.js'), 'utf8'));
  assert.match(serp, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.match(serp, /pointer-events:none/);
  assert.match(serp, /prefers-reduced-motion/);
  assert.match(serp, /visibilityState === 'visible' && document\.hasFocus\(\)/, 'a hidden or unfocused tab asks for nothing');
  assert.match(serp, /if \(!inUse\(\) && message && message\.type && message\.type\.startsWith\('live-'\)\) return/);
  // The content script renders verdicts; it never calls the scanner itself.
  assert.doesNotMatch(serp, /fetch\(/, 'engine calls stay in the background worker');
  assert.doesNotMatch(serp, /sentinel-mask--red[^'"]*['"]\s*\)/, 'red is never assigned by the page script');
});
