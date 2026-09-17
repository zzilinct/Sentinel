'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand.json'), 'utf8'));

function build(extraArgs = []) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-static-'));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-static.js'), '--out', out, ...extraArgs], {
    cwd: ROOT, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'test' }
  });
  const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');
  const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  return { out, read, hrefs };
}

test('static build: every page ships, every relative link resolves, nothing points at the server-only routes', () => {
  const { out, read, hrefs } = build();
  for (const page of ['index.html', 'pricing.html', 'download.html', 'privacy.html', 'terms.html', '404.html']) {
    assert.ok(fs.existsSync(path.join(out, page)), `${page} missing`);
    const html = read(page);
    assert.ok(!html.includes('@include'), `${page} has an unexpanded include`);
    for (const href of hrefs(html)) {
      if (/^(#|mailto:|https?:)/.test(href)) continue;
      const file = href.split('#')[0].split('?')[0];
      assert.ok(fs.existsSync(path.join(out, file)), `${page} links to missing ${href}`);
    }
    // /app, /login, /signup and friends have no static equivalent.
    assert.equal(hrefs(html).filter((h) => /^\/(app|login|signup|forgot|reset|connect|welcome)/.test(h)).length, 0, `${page} keeps a root-absolute server route`);
  }
  assert.ok(fs.existsSync(path.join(out, '.nojekyll')), 'GitHub Pages must not run Jekyll over the output');
});

test('static build: pre-launch defuses account and download links instead of leaving them dead', () => {
  assert.equal(brand.launched, false, 'this test describes the pre-launch build; update it when launched flips');
  const { read } = build();
  const home = read('index.html');
  assert.ok(home.includes('class="prelaunch"'), 'the preview banner is shown');
  assert.equal(home.match(new RegExp(`href="${brand.origin}/(signup|login|app)`, 'g')), null, 'no links into the unlaunched origin');
  assert.ok((home.match(/aria-disabled="true"/g) || []).length >= 5, 'sign-in and plan buttons are inert');
  // Releases live on GitHub, so those download links are real and stay live.
  const dl = read('download.html');
  assert.ok(dl.includes('https://github.com/zzilinct/Sentinel/releases/latest/download/Sentinel-Setup.exe'));
  assert.equal(dl.match(/href="downloads\//g), null, 'no download links into files the static host does not have');
});

test('static build: --launched wires every link to the live origin', () => {
  const { read, hrefs } = build(['--launched']);
  const home = read('index.html');
  assert.ok(!home.includes('class="prelaunch"'));
  assert.ok(hrefs(home).some((h) => h === `${brand.origin}/signup?plan=pro`), 'plan buttons reach the live signup');
  assert.ok(hrefs(home).some((h) => h === `${brand.origin}/app`));
});

test('static build: demo verdicts are baked in so the interactive sections work without an API', () => {
  const { read } = build();
  const config = read(path.join('assets', 'js', 'static.js'));
  assert.ok(config.includes('window.SENTINEL_STATIC'));
  assert.ok(config.includes('window.SENTINEL_DEMO'));
  const demo = JSON.parse(config.split('window.SENTINEL_DEMO = ')[1].replace(/;\s*$/, ''));
  assert.equal(Object.keys(demo.serp).length, 3);
  assert.ok(demo.game.length >= 6);
  for (const threat of ['scam', 'virus', 'malware']) for (const badge of ['yellow', 'orange', 'red']) {
    assert.equal(demo.masks[threat][badge].threats[threat].badge, badge, `${threat}/${badge} example carries its own colour`);
  }
  // The config loads before boot.js, which is the first script that reads it.
  const home = read('index.html');
  assert.ok(home.indexOf('assets/js/static.js') < home.indexOf('assets/js/boot.js'));
});

test('desktop bundle: carries the server and site but never an installer', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'desktop', 'scripts', 'sync-shared.js')], { cwd: ROOT, stdio: 'pipe' });
  const bundle = path.join(ROOT, 'desktop', 'bundle');
  for (const required of ['server/index.js', 'server/lib/scan/engine.js', 'web/app.html', 'web/index.html', 'brand.json']) {
    assert.ok(fs.existsSync(path.join(bundle, required)), `${required} missing from the bundle`);
  }
  const files = fs.readdirSync(bundle, { recursive: true }).map(String);
  assert.equal(files.filter((f) => /\.(exe|dmg|AppImage|msi)$/i.test(f)).length, 0, 'installers must not be bundled into the app');
});
