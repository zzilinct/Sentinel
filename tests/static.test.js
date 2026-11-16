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
  for (const page of ['index.html', 'pricing.html', 'download.html', 'privacy.html', 'terms.html', 'refunds.html', 'recover.html', 'practice.html', '404.html']) {
    assert.ok(fs.existsSync(path.join(out, page)), `${page} missing`);
    const html = read(page);
    assert.ok(!html.includes('@include'), `${page} has an unexpanded include`);
    // A static host sends no security headers: the page must carry its own content policy and referrer policy.
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'/, `${page} lost its content policy`);
    assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/, `${page} lost its referrer policy`);
    for (const href of hrefs(html)) {
      if (/^(#|mailto:|https?:)/.test(href)) continue;
      const file = href.split('#')[0].split('?')[0];
      assert.ok(fs.existsSync(path.join(out, file)), `${page} links to missing ${href}`);
    }
    // /app, /login, /signup and friends have no static equivalent.
    assert.equal(hrefs(html).filter((h) => /^\/(app|login|signup|forgot|reset|connect|welcome)/.test(h)).length, 0, `${page} keeps a root-absolute server route`);
  }
  assert.ok(fs.existsSync(path.join(out, '.nojekyll')), 'GitHub Pages must not run Jekyll over the output');
  // Search engines and AI crawlers: their files ship, pointed at where this build lives.
  for (const f of ['robots.txt', 'sitemap.xml', 'llms.txt']) assert.ok(fs.existsSync(path.join(out, f)), `${f} missing`);
  assert.match(read('robots.txt'), /^Sitemap: \S+\/sitemap\.xml$/m);
  // One H1 per public page, and every public page names its canonical address.
  for (const page of ['index.html', 'pricing.html', 'download.html', 'privacy.html', 'terms.html', 'refunds.html', 'recover.html', 'practice.html']) {
    const html = read(page);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${page} needs exactly one h1`);
    assert.match(html, /<link rel="canonical" href="[^"]+">/, `${page} has no canonical link`);
  }
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
  // No accounts here yet, so the one button on the plans is the app, not a Start free that does nothing.
  assert.match(read('pricing.html'), /<a class="btn btn--gold btn--sm" href="download\.html">Get the app<\/a>/);
});

test('static build: --launched wires every link to the live origin', () => {
  const { read, hrefs } = build(['--launched']);
  const home = read('index.html');
  assert.ok(!home.includes('class="prelaunch"'));
  assert.ok(hrefs(home).some((h) => h === `${brand.origin}/signup`), 'Start free reaches the live signup');
  assert.ok(!hrefs(home).some((h) => /plan=/.test(h)), 'a static site sells no plan, even launched: it has no billing');
  assert.ok(hrefs(home).some((h) => h === `${brand.origin}/app`));
});

test('static build: demo verdicts are baked in so the interactive sections work without an API', () => {
  const { out, read } = build();
  const config = read(path.join('assets', 'js', 'static.js'));
  assert.ok(config.includes('window.SENTINEL_STATIC'));
  assert.ok(config.includes('window.SENTINEL_DEMO'));
  const demo = JSON.parse(config.split('window.SENTINEL_DEMO = ')[1].replace(/;\s*$/, ''));
  assert.equal(Object.keys(demo.serp).length, 3);
  assert.ok(demo.game.length >= 6);
  for (const threat of ['scam', 'virus', 'malware']) for (const badge of ['yellow', 'orange', 'red']) {
    assert.equal(demo.masks[threat][badge].threats[threat].badge, badge, `${threat}/${badge} example carries its own colour`);
  }
  // Try a link has no server here: the checker and its word list ship beside the page, and the CSP lets them load.
  assert.match(read(path.join('assets', 'js', 'engine.js')), /window\.SentinelEngine = /);
  assert.ok(fs.statSync(path.join(out, 'assets', 'data', 'words.txt.gz')).size > 100000, 'the word list ships');
  assert.match(read('index.html'), /data-try-lede/);
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

test('boot: hidden reveals fail open when a script errors or site.js never becomes ready', () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(ROOT, 'web', 'assets', 'js', 'boot.js'), 'utf8');
  const boot = (ready) => {
    const classes = new Set();
    let onError;
    let timer;
    const win = {
      IntersectionObserver: class {},
      document: { documentElement: { classList: { add: (c) => classes.add(c) }, dataset: {} }, addEventListener() {}, querySelectorAll: () => [] },
      localStorage: { getItem: () => null },
      location: { protocol: 'file:', hostname: '', pathname: '/' },
      navigator: {},
      addEventListener: (type, fn) => { if (type === 'error') onError = fn; },
      setTimeout: (fn) => { timer = fn; }
    };
    win.window = win;
    vm.runInNewContext(src, win);
    if (ready) win.Site = { ready: true };
    return { classes, error: (tagName) => onError({ target: tagName ? { tagName } : win }), timeout: () => timer() };
  };
  let b = boot(false); b.error('IMG'); assert.ok(!b.classes.has('no-io'), 'a missing image keeps the animations');
  b.error('LINK'); assert.ok(!b.classes.has('no-io'), 'a missing stylesheet keeps the animations');
  b.error('SCRIPT'); assert.ok(b.classes.has('no-io'), 'a script that fails to load reveals everything');
  b = boot(false); b.error(); assert.ok(b.classes.has('no-io'), 'a runtime error reveals everything');
  b = boot(false); b.timeout(); assert.ok(b.classes.has('no-io'), 'site.js never running reveals everything');
  b = boot(true); b.error(); b.timeout(); assert.ok(!b.classes.has('no-io'), 'once reveals run, later errors leave them alone');
  assert.match(fs.readFileSync(path.join(ROOT, 'web', 'assets', 'js', 'site.js'), 'utf8'), /window\.Site\.ready = true/);
});

test('scroll motion: GSAP, ScrollTrigger and Lenis ship with their licences and load, deferred, before motion.js (and are in the page before site.js looks for them)', () => {
  const web = path.join(ROOT, 'web');
  const vendor = path.join(web, 'assets', 'js', 'vendor');
  assert.match(fs.readFileSync(path.join(vendor, 'gsap.min.js'), 'utf8').slice(0, 400), /gsap\.com\/standard-license/);
  assert.match(fs.readFileSync(path.join(vendor, 'ScrollTrigger.min.js'), 'utf8').slice(0, 400), /gsap\.com\/standard-license/);
  assert.match(fs.readFileSync(path.join(vendor, 'lenis.min.js'), 'utf8').slice(0, 400), /@license MIT/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(!['gsap', 'lenis'].some((d) => (pkg.dependencies || {})[d] || (pkg.devDependencies || {})[d]), 'vendored, not dependencies');
  for (const page of ['index.html', 'pricing.html', 'download.html', '404.html', 'privacy.html', 'terms.html', 'refunds.html', 'recover.html', 'practice.html']) {
    const html = fs.readFileSync(path.join(web, page), 'utf8');
    const at = (f) => html.indexOf(`<script src="/assets/js/${f}" defer></script>`);
    const order = ['vendor/gsap.min.js', 'vendor/ScrollTrigger.min.js', 'vendor/lenis.min.js', 'motion.js'].map(at);
    assert.ok(order.every((i, k) => i > 0 && i < html.indexOf('assets/js/site.js') && (k === 0 || i > order[k - 1])), `${page}: the scroll motion scripts are missing, not deferred, or out of order`);
  }
  for (const page of ['app.html', 'login.html', 'signup.html']) {
    assert.ok(!fs.readFileSync(path.join(web, page), 'utf8').includes('vendor/gsap'), `${page} has no scroll motion to load`);
  }
});

test('home masks: every rendered mask the pages point at exists, and anime.js loads before the motion', () => {
  const web = path.join(ROOT, 'web');
  for (const page of ['index.html', 'pricing.html', 'download.html', '404.html']) {
    const html = fs.readFileSync(path.join(web, page), 'utf8');
    for (const [, src] of html.matchAll(/src="(\/assets\/img\/masks\/[^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(web, src)), `${page} points at missing ${src}`);
    }
    assert.ok(html.indexOf('assets/js/anime.min.js') < html.indexOf('assets/js/lux.js'), `${page}: anime.js has to load first`);
    assert.ok(!/scene3d|three\.min/.test(html), `${page} still loads the old WebGL scene`);
  }
  // Each mask plate carries its mask in all three severity colours, one of them showing.
  const home = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  for (const threat of ['scam', 'virus', 'malware']) {
    const plate = home.slice(home.indexOf(`data-threat="${threat}">`), home.indexOf('</article>', home.indexOf(`data-threat="${threat}">`)));
    for (const tint of ['yellow', 'orange', 'red']) assert.ok(plate.includes(`data-tint="${tint}"`), `${threat} has no ${tint} render`);
    assert.equal((plate.match(/data-tint="[a-z]+"[^>]*class="is-on"/g) || []).length, 1, `${threat} shows exactly one colour`);
  }
});

test('type: no serif italic accents, no gradient-filled headings, no eyebrow labels, no em dashes in what people read', () => {
  const skip = /[\/](vendor|bundle|dist|node_modules)[\/]|mask3d\.js$/;
  const files = ['web', 'desktop/src', 'extension'].flatMap((dir) => fs.readdirSync(path.join(ROOT, dir), { recursive: true })
    .map((f) => path.join(ROOT, dir, f))
    .filter((f) => /\.(html|js|css|json|txt)$/.test(f) && !skip.test(f) && fs.statSync(f).isFile()));
  assert.ok(files.length > 50, `only ${files.length} files looked at`);
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('instrument-serif-italic'), `${rel}: the italic face is gone; nothing may load it`);
    assert.doesNotMatch(text, /\u2014|&mdash;|&#8212;|\u2014/, `${rel}: an em dash`);
    if (/\.(html|js)$/.test(file)) assert.doesNotMatch(text, /class="[^"]*\b(kicker|tile__label|lux-label)\b/, `${rel}: an eyebrow label over a heading`);
    if (!file.endsWith('.css')) continue;
    for (const [, sel, body] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      assert.ok(!(/italic/.test(body) && /--display|--serif|\bh[1-3]\b[^,]*\bem\b/.test(body + sel)), `${rel}: serif italic in "${sel.trim()}"`);
      assert.ok(!(/background-clip:\s*text/.test(body) && /\.unmasked|\.gold-text|(^|[\s,])h[1-3]\b/.test(sel)), `${rel}: gradient-filled heading text in "${sel.trim()}"`);
    }
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'web/assets/fonts/fonts.css'), 'utf8'), /font-style:\s*italic/);
});

test('the app page paints its side bar from styles inside it; its stylesheets no longer hold up the first paint', () => {
  const { serveStatic } = require('../server/lib/http');
  const critical = require('../server/lib/critical');
  const res = { headers: {}, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
  serveStatic(path.join(ROOT, 'web'), '/app.html', { headers: {}, method: 'GET' }, res);
  const html = res.body.toString('utf8');
  const css = /<style>\n([\s\S]*?)\n<\/style>/.exec(html)[1];
  // Nothing in the page's <head> waits for a stylesheet; each is preloaded, in its order, and app.js puts it in.
  assert.ok(!/<link rel="stylesheet"/.test(html), 'a stylesheet still holds up the first paint');
  // The rules come before every stylesheet, so each sheet put in later overrides them in the page's own order.
  assert.ok(html.indexOf('<style>') < html.indexOf('data-late>') && !html.includes(critical.MARK));
  const late = [...html.matchAll(/<link rel="preload" href="([^"]+\.css)" as="style" data-late>/g)].map((m) => m[1]);
  assert.deepEqual(late, ['/assets/fonts/fonts.css', '/assets/css/sentinel.css', '/assets/css/interactive.css', '/assets/css/hover.css', '/assets/css/app.css', '/assets/css/app-lux.css']);
  assert.match(fs.readFileSync(path.join(ROOT, 'web/assets/js/app.js'), 'utf8'), /const styled = Promise\.all\(\$\$\('link\[data-late\]'\)[\s\S]*?await styled;\n    try \{/);
  // What the side bar, the phone's top bar and the faces need is in it; what only a page or the website uses is not.
  for (const rule of ['@font-face', ':root', '.side__link{', '.side__nav{', '.topbar-mobile', '.logo', '.btn{', '.theme-toggle', '.skeleton']) assert.ok(css.includes(rule), `the first view's styles lack ${rule}`);
  for (const rule of ['.hero{', '.set-row', '.result{', '.pricing']) assert.ok(!css.includes(rule), `${rule} is not the first view's`);
  assert.ok(css.length < 40 * 1024, `the first view's styles weigh ${css.length} bytes`);
  // The reading of selectors: a rule is left out only when a name it needs is missing from the page.
  const names = { classes: new Set(['side', 'btn']), ids: new Set(['view']), tags: new Set(['html', 'body', 'a', 'div']) };
  for (const [sel, kept] of [['.side a', true], ['.side .hero', false], ['.btn:not(.is-soon):hover', true], ['#view:has(.ask) .btn', false], ['div:is(.x, .y) > a', true], ['[data-theme="light"] .btn::before', true], ['main .btn', false]]) {
    assert.equal(critical.canMatch(sel, names), kept, sel);
  }
});
