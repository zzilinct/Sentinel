'use strict';
/**
 * Proves, in a real headless Chrome, three things that unit tests cannot:
 *
 *   site      Try a link on the static website (npm run build:static) gives real verdicts in the browser, with no
 *             console errors and no request that carries the typed link.
 *   qr        qr.js reads real QR pictures made by another encoder (scripts/verify-web-qr.py), loaded and called the
 *             way the app does it (app.js qrFromFile).
 *   motion    The scroll motion (motion.js): Lenis smooths the wheel on a computer, never on a touch screen or under
 *             reduced motion, and every scroll the page makes (a tab's jump, an anchor, back to top) lands exactly.
 *   companion The companion's password alarm stops a protected password on another site, and its clipboard guard
 *             stops a ClickFix-shaped command but not an ordinary one.
 *   hover     Resting the pointer on a link shows the companion's mask beside it (a listed scam behind Google's
 *             wrapper, an honest site), with the real Sentinel server behind the companion; nothing while it is off.
 *   practice  The practice inbox (/practice) sorts all twelve with Tab and Enter alone, at phone and computer width,
 *             marks each message's clues where they are, follows reduced motion, and sends nothing anywhere.
 *
 *   node scripts/verify-web.js [--only site,motion,qr,companion,hover,practice] [--static dist-static] [--qr qr-samples] [--out verify-web]
 *
 * Meant for CI (.github/workflows/verify-web.yml), never a person's computer. Every page is local: the sign-in sites
 * are this script's own HTTPS server, reached through --host-resolver-rules with a throwaway self-signed certificate.
 * Exits 1 if any check fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const { cdpPipe, CANDIDATES, expand } = require('./verify-companion');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const ROOT = path.join(__dirname, '..');
const ONLY = arg('--only', 'site,motion,qr,companion,hover,practice').split(',');
const STATIC = path.resolve(ROOT, arg('--static', 'dist-static'));
const QR = path.resolve(ROOT, arg('--qr', 'qr-samples'));
const OUT = path.resolve(ROOT, arg('--out', 'verify-web'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const report = [];
function result(check, ok, detail) {
  report.push({ check, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}`);
  for (const line of [].concat(detail || [])) console.log(`      ${typeof line === 'string' ? line : JSON.stringify(line)}`);
}

/* ------------------------------------------------------------------ servers */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.gz': 'application/gzip', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };

/** A static file server on 127.0.0.1 over the given folders ({ '/prefix/': dir }), logging every request. */
function serveFiles(mounts, extra = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    log.push(req.url);
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (extra[url]) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(extra[url]); return; }
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (!url.startsWith(prefix)) continue;
      let file = path.join(dir, url.slice(prefix.length));
      if (!file.startsWith(dir)) break;
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) break;
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, log, base: `http://127.0.0.1:${server.address().port}` })));
}

/* ------------------------------------------------------------------ browser */

async function launch(extraArgs = []) {
  const exe = CANDIDATES.chrome.map(expand).find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Chrome is not installed here');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-verify-web-'));
  const child = spawn(exe, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--window-size=1366,900', ...extraArgs, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const browser = cdpPipe(child);
  const version = await Promise.race([browser.send('Browser.getVersion'), sleep(90000).then(() => { throw new Error('Chrome did not answer on its DevTools pipe'); })]);
  const close = async () => { child.kill(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still letting go */ } };
  return { browser, version: version.product, close };
}

async function evalIn(browser, sessionId, expression, opts = {}) {
  const r = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...opts }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}

async function openPage(browser) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const sessionId = (await browser.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function goto(browser, sessionId, url, ready = 'true') {
  await browser.send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    const ok = await evalIn(browser, sessionId, `location.href !== 'about:blank' && document.readyState === 'complete' && Boolean(${ready})`).catch(() => false);
    if (ok) return;
  }
  throw new Error(`${url} did not finish loading`);
}

/** Everything a person would read on the page, closed shadow roots included (where the companion's warnings live). */
async function pageText(browser, sessionId) {
  const { root } = await browser.send('DOM.getDocument', { depth: -1, pierce: true }, sessionId);
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3 && n.nodeValue.trim()) out.push(n.nodeValue.trim());
    if (n.nodeName === 'STYLE' || n.nodeName === 'SCRIPT') return;
    for (const c of [...(n.shadowRoots || []), ...(n.children || []), ...(n.contentDocument ? [n.contentDocument] : [])]) walk(c);
  };
  walk(root);
  return out.join(' ');
}

async function shot(browser, sessionId, name) {
  try {
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  } catch { /* a picture is a nicety */ }
}

async function typeText(browser, sessionId, text) {
  await browser.send('Input.insertText', { text }, sessionId);
}
async function pressEnter(browser, sessionId) {
  for (const type of ['keyDown', 'keyUp']) {
    await browser.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) }, sessionId);
  }
}

/* -------------------------------------------------------------- 1. the site */

const SCAM = 'paypa1-account-verify.top';
const HONEST = 'https://www.wikipedia.org';

async function checkSite() {
  if (!fs.existsSync(path.join(STATIC, 'assets', 'js', 'engine.js'))) throw new Error(`no static build in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, version, close } = await launch();
  try {
    const { sessionId } = await openPage(browser);
    const requests = [];
    const errors = [];
    browser.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, post: p.request.postData || '' }));
    browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
    browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
    browser.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url || ''}`); });
    await browser.send('Network.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Log.enable', {}, sessionId);
    await goto(browser, sessionId, `${files.base}/index.html`, "document.querySelector('[data-try-form]') && window.SENTINEL_STATIC");
    await sleep(1500);   // the page's own start-up (3D masks, demo) has its say in the console first

    const before = requests.length;
    const verdicts = {};
    for (const link of [SCAM, HONEST]) {
      await evalIn(browser, sessionId, `(() => { const f = document.querySelector('[data-try-form]'); document.querySelector('[data-try-out]').innerHTML = ''; f.elements.url.value = ''; f.elements.url.scrollIntoView({ block: 'center' }); f.elements.url.focus(); })()`);
      await typeText(browser, sessionId, link);
      await pressEnter(browser, sessionId);
      let v = null;
      for (let i = 0; i < 60 && !v; i++) {
        await sleep(250);
        v = await evalIn(browser, sessionId, `(() => {
          const r = document.querySelector('[data-try-out] .try__result');
          if (!r) { const e = document.querySelector('[data-try-out] .try__empty'); return e ? { error: e.textContent.trim() } : null; }
          return { title: r.querySelector('h3').textContent, host: r.querySelector('.try__head p').textContent, colour: r.style.getPropertyValue('--c'),
            caveat: [...r.querySelectorAll('.try__caveat')].map((p) => p.textContent),
            threats: [...r.querySelectorAll('.try__threat')].map((t) => t.textContent.trim().replace(/\\s+/g, ' ')),
            why: [...r.querySelectorAll('.try__why li')].map((li) => li.textContent), foot: r.querySelector('.try__foot span').textContent };
        })()`);
      }
      verdicts[link] = v;
      await shot(browser, sessionId, `site-${link.replace(/\W+/g, '-')}`);
    }

    const scam = verdicts[SCAM] || {};
    const honest = verdicts[HONEST] || {};
    const needles = ['paypa1', 'account-verify', 'wikipedia'];
    const leaks = requests.slice(before).filter((r) => needles.some((n) => (r.url + r.post).toLowerCase().includes(n)));
    // Requests after typing: only the checker itself (engine.js and its word list) may load, from this host.
    const offHost = requests.slice(before).filter((r) => !r.url.startsWith(files.base) && !r.url.startsWith('data:'));
    const CLEAN = 'No warning signs in the address';
    result(`site: ${SCAM} gets a warning`, Boolean(scam.title) && scam.title !== CLEAN && scam.title !== 'No threats found' && !/green/.test(scam.colour), scam);
    // Checked in the browser, with no threat list: never "No threats found" in green, and it says what was left out.
    result(`site: ${HONEST} shows no warning signs, without claiming the threat lists were checked`,
      honest.title === CLEAN && !/green/.test(honest.colour) && (honest.caveat || []).some((c) => /Threat lists were not checked here/.test(c)) && !(honest.caveat || []).some((c) => /did not run/.test(c)), honest);
    result('site: no request carries the typed link, and none leaves the page\'s host', !leaks.length && !offHost.length,
      [`requests after typing: ${requests.slice(before).map((r) => r.url.replace(files.base, '')).join(', ') || 'none'}`, ...leaks.map((r) => `leak: ${r.url}`), ...offHost.map((r) => `off host: ${r.url}`)]);
    result('site: no console errors', !errors.length, errors.length ? errors : `${version}, ${requests.length} requests`);
  } finally {
    await close();
    files.server.close();
  }
}

/* ------------------------------------------------------- 1b. scroll motion */

// A headless browser reports no mouse; this says there is one, as a desktop browser would (as review-shots does).
const MOUSE = `(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /hover: hover|pointer: fine/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); })();`;

async function checkMotion() {
  if (!fs.existsSync(path.join(STATIC, 'assets', 'js', 'vendor', 'gsap.min.js'))) throw new Error(`no static build with the scroll motion in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  const errors = [];
  browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
  browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
  const open = async ({ mouse, touch, reduce }) => {
    const { sessionId } = await openPage(browser);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] }, sessionId);
    if (touch) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    }
    if (mouse) await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: MOUSE }, sessionId);
    await goto(browser, sessionId, `${files.base}/index.html`, 'window.SentinelMotion');
    await sleep(1200);
    return { s: sessionId, ev: (expr) => evalIn(browser, sessionId, expr) };
  };
  const state = "({ lenis: document.documentElement.classList.contains('lenis'), scroller: Boolean(window.SentinelScroll), coarse: matchMedia('(pointer: coarse)').matches, lasers: document.querySelectorAll('.laser').length })";
  try {
    /* A computer: Lenis glides the wheel, rests when done, and every scroll the page makes lands where it should. */
    const d = await open({ mouse: true });
    const on = await d.ev(state);
    result('motion: on a computer, Lenis smooths the scroll', on.lenis && on.scroller, on);
    // The first 3D mask is built in a quiet moment after load (mask3d.js): its shaders and studio light took 1 to 2
    // seconds of one frame in this runner's software WebGL, and a wheel turned then landed in that one frame. The
    // glide is looked at once the first mask is up.
    for (let i = 0; i < 100 && !(await d.ev("!document.querySelector('[data-mask3d]') || Boolean(document.querySelector('.mask3d--ready'))")); i++) await sleep(200);
    await sleep(500);
    // Where the page is, frame by frame, recorded in the page: a sample taken 90 ms later by this script's own clock
    // came back after the glide had landed whenever the runner was busy (the call and the frames run late, not the glide).
    await d.ev("(() => { const f = window.__glide = []; const t0 = performance.now(); addEventListener('wheel', () => { window.__wheelAt = Math.round(performance.now() - t0); }, { once: true, capture: true }); const rec = () => { f.push([Math.round(performance.now() - t0), Math.round(scrollY), window.SentinelScroll.ticking]); if (performance.now() - t0 < 20000) requestAnimationFrame(rec); }; requestAnimationFrame(rec); return true; })()");
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 683, y: 450, deltaX: 0, deltaY: 600 }, d.s);
    // From the page's own state, not a fixed wait: the page can take the wheel seconds late on a busy runner.
    for (let i = 0; i < 75 && !(await d.ev('scrollY > 0')); i++) await sleep(200);
    for (let i = 0; i < 40 && await d.ev('window.SentinelScroll.ticking'); i++) await sleep(200);
    const end = await d.ev('({ y: scrollY, ticking: window.SentinelScroll.ticking, frames: window.__glide, wheelAt: window.__wheelAt })');
    // A glide: Lenis ticking, and the page part way, on frames that span at least 90 ms of the page's own time.
    const between = end.frames.filter(([, y, ticking]) => ticking && y > 0 && y < 598);
    const span = between.length ? between[between.length - 1][0] - between[0][0] : 0;
    result('motion: a turn of the wheel glides (part way for 90 ms and more, Lenis ticking), lands, and Lenis stops ticking', between.length >= 2 && span >= 90 && Math.abs(end.y - 600) <= 2 && !end.ticking, { wheelAt: end.wheelAt, partWay: between.length, spanMs: span, frames: end.frames.slice(Math.max(0, end.frames.findIndex(([, y]) => y > 0) - 3)).slice(0, 30).map(([t, y]) => `${t}:${y}`).join(' '), y: end.y, ticking: end.ticking });

    const lands = async (name, setup, measure, want) => {
      await d.ev(setup);
      await sleep(2200);
      const got = await d.ev(measure);
      result(`motion: ${name}`, Math.abs(got - want(got)) <= 2, { got, want: want(got) });
    };
    await lands('a tab\'s jump (under its wipe) lands its chapter just under the header', "scrollTo(0, 0); document.querySelector('.nav__links a[href*=\"#how\"]').click(); true",
      "document.getElementById('how').getBoundingClientRect().top - document.querySelector('[data-nav]').offsetHeight - 8", () => 0);
    await lands('an anchor link (the scroll cue) glides to its place', "scrollTo(0, 0); document.querySelector('.scroll-cue').click(); true",
      "document.getElementById('stage-demo').getBoundingClientRect().top - parseFloat(getComputedStyle(document.getElementById('stage-demo')).scrollMarginTop)", () => 0);
    await lands('back to top glides to the top', "scrollTo(0, 4000); setTimeout(() => document.querySelector('.to-top').click(), 300); true", 'scrollY', () => 0);
    // A chapter's head, scrolled to: the laser has played and gone, the heading has risen, the paragraph is full.
    await d.ev("document.querySelector('#masks .section__head').scrollIntoView({ block: 'start' }); true");
    await sleep(2500);
    const head = await d.ev(`(() => { const h = document.querySelector('#masks .section__head');
      return { risen: h.querySelector('h2').classList.contains('is-in'), laser: getComputedStyle(h.querySelector('.laser')).opacity,
        words: Math.min(...[...h.querySelectorAll('.wd')].map((w) => Number(getComputedStyle(w).opacity))) }; })()`);
    result('motion: a chapter scrolled to has its laser played and gone, its heading risen and its paragraph in full', head.risen && head.laser === '0' && head.words > 0.95, head);
    await d.ev("document.querySelector('.stats').scrollIntoView({ block: 'center' }); true");
    await sleep(2600);
    const stats = await d.ev("[...document.querySelectorAll('[data-count]')].map((el) => [el.textContent, Number(el.dataset.count).toLocaleString(), el.closest('.stat').querySelector('.stat__bar').getBoundingClientRect().width])");
    result('motion: the figures count up to their real numbers, with their bars grown', stats.length && stats.every(([t, n, w]) => t === n && w > 60), stats);

    /* A phone: its own scroll, untouched. Reduced motion: the browser's own scroll and no laser. */
    const t = await open({ touch: true });
    const tOn = await t.ev(state);
    // coarse says whether this browser's touch emulation also reports a coarse pointer, as a real phone does.
    result('motion: on a touch screen, Lenis stays off', !tOn.lenis && !tOn.scroller, tOn);
    const r = await open({ mouse: true, reduce: true });
    const rOn = await r.ev(state);
    const rStats = await r.ev("[...document.querySelectorAll('[data-count]')].every((el) => el.textContent === Number(el.dataset.count).toLocaleString())");
    result('motion: with reduced motion, Lenis and the lasers stay off and the figures stand at their numbers', !rOn.lenis && !rOn.scroller && !rOn.lasers && rStats, { ...rOn, figures: rStats });
    result('motion: no console errors', !errors.length, errors);
  } finally {
    await close();
    files.server.close();
  }
}

/* ------------------------------------------------------------------ 2. QR */

async function checkQr() {
  const manifest = path.join(QR, 'manifest.json');
  if (!fs.existsSync(manifest)) throw new Error(`no QR pictures in ${QR}: run python scripts/verify-web-qr.py ${path.relative(ROOT, QR)}`);
  const samples = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  // The app's own reading code, taken from app.js so this checks what ships: qrFrom (two sizes) and qrFromFile.
  const app = fs.readFileSync(path.join(ROOT, 'web', 'assets', 'js', 'app.js'), 'utf8');
  const start = app.indexOf('  function qrFrom(');
  const end = app.indexOf('\n  /** What a QR code does');
  if (start < 0 || end < start) throw new Error('could not find qrFrom and qrFromFile in web/assets/js/app.js');
  const page = `<!doctype html><meta charset="utf-8"><title>QR</title><script src="/assets/js/qr.js"></script><script>\n${app.slice(start, end)}\nwindow.qrFromFile = qrFromFile;</script>`;
  const files = await serveFiles({ '/samples/': QR, '/': path.join(ROOT, 'web') }, { '/qr.html': page });
  const { browser, close } = await launch();
  try {
    const { sessionId } = await openPage(browser);
    await goto(browser, sessionId, `${files.base}/qr.html`, 'window.SentinelQR && window.qrFromFile');
    for (const s of samples) {
      const t0 = Date.now();
      const got = await evalIn(browser, sessionId, `fetch('/samples/${s.file}').then((r) => r.blob()).then((b) => qrFromFile(b))`).catch((err) => `error: ${err.message}`);
      result(`qr: ${s.file} (${s.what})`, got === s.text, got === s.text ? `read "${got}" in ${Date.now() - t0} ms` : `expected "${s.text}", got ${JSON.stringify(got)}`);
    }
  } finally {
    await close();
    files.server.close();
  }
}

/* ------------------------------------------------------------ 3. companion */

const HOME = 'accounts.google.com';
const PHISH = 'accounts-google.verify-session.top';
const CLIP = 'robot-check.verify-session.top';
const PASSWORD = 'Test-only-pw-7731';
const OTHER = 'Another-pw-0000-x';   // the same length, so it is hashed and compared, and must not match
const BAD = `powershell -w hidden -enc ${Buffer.from('Write-Output hi', 'utf16le').toString('base64')}`;   // harmless, shaped like ClickFix
const FINE = 'npm i x';

function openssl() {
  for (const exe of ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe']) {
    if (spawnSync(exe, ['version']).status === 0) return exe;
  }
  throw new Error('openssl was not found (Git for Windows ships one)');
}

function signInPage(host) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body>
    <h1>Sign in</h1><p>${host}</p>
    <form method="post" action="/signin"><input name="email" value="test@example.com"><input type="password" name="password" autocomplete="current-password"><button>Sign in</button></form>
  </body></html>`;
}

async function checkCompanion() {
  const ext = path.join(ROOT, 'extension');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-tls-'));
  const r = spawnSync(openssl(), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
    '-days', '1', '-subj', '/CN=sentinel-verify', '-addext', `subjectAltName=DNS:${HOME},DNS:${PHISH},DNS:${CLIP}`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`openssl could not make a certificate: ${r.stderr}`);

  const posts = [];
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => { posts.push({ host, body }); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Signed in</title><p>Signed in</p>'); });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(host === CLIP ? `<!doctype html><title>Verify you are human</title><p>Press the button to verify.</p>` : signInPage(host));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const rules = [HOME, PHISH, CLIP].map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',');
  const { browser, version, close } = await launch([`--host-resolver-rules=${rules}`, '--ignore-certificate-errors']);
  try {
    const loaded = await browser.send('Extensions.loadUnpacked', { path: ext });
    let sw;
    for (let i = 0; i < 40 && !sw; i++) {
      const { targetInfos } = await browser.send('Target.getTargets');
      sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${loaded.id}/`));
      if (!sw) await sleep(250);
    }
    if (!sw) throw new Error('the companion loaded but its service worker never started');

    // Protect the Google account from the companion's own settings page, as a person would.
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const worker = (msg) => evalIn(browser, opt.sessionId, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
    const set = await worker({ type: 'pw-set', id: 'google', on: true });
    if (!set || !set.ok) throw new Error(`could not protect the Google account: ${JSON.stringify(set)}`);

    /* (a) password alarm */
    const tab = await openPage(browser);
    const s = tab.sessionId;
    const signIn = async (host, password) => {
      await goto(browser, s, `https://${host}/`, "document.querySelector('input[type=password]')");
      await sleep(1000);   // the content script asks the worker for its settings at start
      await evalIn(browser, s, "document.querySelector('input[type=password]').focus()");
      await typeText(browser, s, password);
      await pressEnter(browser, s);
    };

    await signIn(HOME, PASSWORD);
    let learned = false;
    for (let i = 0; i < 40 && !learned; i++) {
      await sleep(250);
      const list = await worker({ type: 'pw-list' });
      learned = Boolean(list && list.accounts && list.accounts.some((a) => a.id === 'google' && a.learned));
    }
    const homePosted = posts.some((p) => p.host === HOME);
    result(`companion: signing in on ${HOME} teaches the password alarm (and the sign-in goes through)`, learned && homePosted, { learned, homePosted, browser: version });

    // Said once, quietly, in a corner of the sign-in page or the page it moved on to, and not again.
    let told = '';
    for (let i = 0; i < 40 && !/Your Google password is now protected/.test(told); i++) { await sleep(250); told = await pageText(browser, s); }
    await shot(browser, s, 'companion-password-protected');
    await sleep(3500);   // on screen long enough to count as said
    await goto(browser, s, `https://${HOME}/`, "document.querySelector('input[type=password]')");
    await sleep(1500);
    const again = /now protected/.test(await pageText(browser, s));
    result('companion: after the first sign-in, a quiet note says "Your Google password is now protected", once', /Your Google password is now protected/.test(told) && !again, { again, onScreen: told.slice(0, 200) });
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/popup.html`, "!document.getElementById('pwLine').hidden");
    const line = await evalIn(browser, opt.sessionId, "document.getElementById('pwLine').textContent + '|' + (document.getElementById('pwLink') || {}).textContent");
    result('companion: the popup says what the password alarm protects, with a link to its settings', /Password alarm protects your Google password\..*\|Password alarm settings$/.test(line), { line });
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");

    const before = posts.length;
    await signIn(PHISH, PASSWORD);
    let text = '';
    for (let i = 0; i < 40 && !/This is your Google password/.test(text); i++) {
      await sleep(250);
      text = await pageText(browser, s);
    }
    await sleep(3000);   // long enough for a form that was going to be sent to be sent
    await shot(browser, s, 'companion-password-alarm');
    const box = await evalIn(browser, s, "(document.querySelector('input[type=password]') || {}).value");
    const sent = posts.slice(before).filter((p) => p.host === PHISH);
    const alarm = /This is your Google password, and this is not a Google site/.test(text);
    result(`companion: the same password typed on ${PHISH} sounds the alarm and is not sent`, alarm && !sent.length && box === '',
      { alarm, formSent: sent.length > 0, boxValue: box, onScreen: text.slice(0, 300) });

    // An ordinary password of the same length on the same page: checked, no alarm, and the press goes through.
    const before2 = posts.length;
    await signIn(PHISH, OTHER);
    let through = false;
    for (let i = 0; i < 40 && !through; i++) { await sleep(250); through = posts.slice(before2).some((p) => p.host === PHISH && p.body.includes(encodeURIComponent(OTHER))); }
    const text2 = await pageText(browser, s);
    result('companion: a different password on that page is let through, with no alarm', through && !/This is your Google password/.test(text2), { through });

    /* (b) pasted-command guard */
    await browser.send('Browser.grantPermissions', { origin: `https://${CLIP}`, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await goto(browser, s, `https://${CLIP}/`);
    // Each write answers "<how the page's call ended>|<what is on the clipboard after it>".
    const settle = "then(() => 'ok', (e) => e.name).then((r) => navigator.clipboard.readText().then((c) => r + '|' + c))";
    const write = (t) => evalIn(browser, s, `navigator.clipboard.writeText(${JSON.stringify(t)}).${settle}`, { userGesture: true }).catch((err) => `error: ${err.message}`);
    const writeItem = (t) => evalIn(browser, s, `navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([${JSON.stringify(t)}], { type: 'text/plain' }) })]).${settle}`, { userGesture: true }).catch((err) => `error: ${err.message}`);
    const wrapped = await evalIn(browser, s, "!/\\[native code\\]/.test(Function.prototype.toString.call(navigator.clipboard.writeText))");
    // What the worker registered, and what reached the page: printed with the first result, to tell why if it fails.
    const registered = await evalIn(browser, opt.sessionId, 'chrome.scripting.getRegisteredContentScripts().then((r) => JSON.stringify(r))').catch((err) => `error: ${err.message}`);
    const inPage = await evalIn(browser, s, "JSON.stringify({ rules: typeof SentinelClickFix, alarm: typeof SentinelAlarm, guard: Boolean(window.__sentinelClipGuard) })");
    const afterFine = await write(FINE);
    const warnedFine = /stopped this page from copying a command/.test(await pageText(browser, s));
    result(`companion: an ordinary command (${FINE}) is copied, with no warning, and the guard is in the page`, wrapped && afterFine === `ok|${FINE}` && !warnedFine, { wrapped, registered, inPage, clipboard: afterFine, warned: warnedFine });
    const afterBad = await write(BAD);
    let clipText = '';
    for (let i = 0; i < 20 && !/stopped a copied command/.test(clipText); i++) { await sleep(150); clipText = await pageText(browser, s); }
    await shot(browser, s, 'companion-clipguard');
    const warnedBad = /Sentinel stopped this page from copying a command/.test(clipText) && /hidden window/.test(clipText);
    result('companion: a ClickFix-shaped command is not copied, the page is told so, and the warning shows', afterBad === `NotAllowedError|${FINE}` && warnedBad, { clipboard: afterBad, warned: warnedBad, onScreen: clipText.slice(0, 300) });

    // The warning has the keyboard: Escape closes it.
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, s);
    await sleep(300);
    const closed = !/stopped this page from copying a command/.test(await pageText(browser, s));
    result('companion: Escape closes the pasted-command warning', closed, { closed });

    const afterItem = await writeItem(BAD);
    result('companion: navigator.clipboard.write() with the same command is stopped too', afterItem === `NotAllowedError|${FINE}`, { clipboard: afterItem });
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, s);
    await sleep(300);

    // The person's own Ctrl+C on text they selected: held back with a small notice that can copy it anyway.
    await evalIn(browser, s, `(() => { const pre = document.createElement('pre'); pre.id = 'cmd'; pre.textContent = ${JSON.stringify(BAD)}; document.body.appendChild(pre);
      const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67, commands: ['copy'] }, s);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 }, s);
    let ownText = '';
    for (let i = 0; i < 20 && !/Sentinel did not copy this/.test(ownText); i++) { await sleep(150); ownText = await pageText(browser, s); }
    await shot(browser, s, 'companion-clipguard-own-copy');
    const ownClip = await evalIn(browser, s, 'navigator.clipboard.readText()', { userGesture: true }).catch((err) => `error: ${err.message}`);
    result('companion: the person\'s own copy of a command gets the small notice with "Copy it anyway", not the full-screen block',
      /Sentinel did not copy this/.test(ownText) && /Copy it anyway/.test(ownText) && !/stopped this page from copying/.test(ownText) && ownClip === FINE,
      { clipboard: ownClip, onScreen: ownText.slice(0, 300) });
  } finally {
    await close();
    server.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

/* ---------------------------------------------------- 4. hover a link (companion) */

// A listed scam behind Google's redirect wrapper, and an honest site. Neither is ever opened: the page only lists them.
const HOVER_SCAM = `https://www.google.com/url?q=${encodeURIComponent('https://paypa1-secure-login.com/account')}&sa=D`;
const HOVER_SAFE = 'https://www.wikipedia.org/';

async function checkHover() {
  // The real Sentinel server, on its own port and database, with this computer's account (Pro in demo billing), so
  // the companion's verdicts come from the real worker, threat list and fast check.
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-hover-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'hover-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), SENTINEL_DEVICE_ACCOUNTS: '1', FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0' }
  });
  const api = `http://127.0.0.1:${port}`;
  let token = null;
  for (let i = 0; i < 120 && !token; i++) {
    await sleep(500);
    try {
      const r = await fetch(`${api}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: api }, body: '{}' });
      if (r.ok) token = (await r.json()).token;
    } catch { /* still starting */ }
  }
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>A forum thread</title>
    <style>body{font:16px/1.6 system-ui,sans-serif;margin:60px}a{display:inline-block;padding:6px 0}</style></head><body>
    <h1>Re: my account was limited?</h1>
    <p>Someone sent me this: <a id="scam" href="${HOVER_SCAM}">PayPal account review</a></p>
    <p>And the wiki has more: <a id="safe" href="${HOVER_SAFE}">Wikipedia</a></p>
    <p id="blank" style="height:200px">Nothing here.</p></body></html>`;
  const files = await serveFiles({}, { '/thread.html': page });
  const { browser, close } = await launch();
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see hover-server.log)`);
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const paired = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(api)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return Boolean(r && r.account && r.account.signedIn);
    })()`);
    if (!paired) throw new Error('the companion could not sign in to the test server');

    const tab = await openPage(browser);
    const s = tab.sessionId;
    const mouse = (x, y) => browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s);
    const at = async (id) => evalIn(browser, s, `(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
    const tipText = async () => {
      const text = await pageText(browser, s);
      return /Nothing here\.(.*)$/.exec(text) ? /Nothing here\.(.*)$/.exec(text)[1].trim() : '';
    };
    const hover = async (id) => {
      await mouse(...await at('blank'));
      await sleep(300);
      await mouse(...await at(id));
      let text = '';
      for (let i = 0; i < 30 && !text; i++) { await sleep(200); text = await tipText(); }
      return text;
    };

    await goto(browser, s, `${files.base}/thread.html`);
    await sleep(800);   // the content script reads its settings at start
    // Not before the pointer has rested: half a second.
    await mouse(...await at('scam'));
    await sleep(200);
    const early = await tipText();
    const scam = await hover('scam');
    await shot(browser, s, 'companion-hover-scam');
    result('companion: resting on a link to a listed scam (behind Google\'s /url wrapper) shows the scam mask beside it, after the pointer rests',
      !early && /scam/i.test(scam) && /paypa1-secure-login\.com/.test(scam), { early, tip: scam });
    const safe = await hover('safe');
    await shot(browser, s, 'companion-hover-safe');
    result('companion: resting on a link to an honest site shows the quiet "no warning signs" mark', /No warning signs found|A verified site/.test(safe) && !/scam/i.test(safe), { tip: safe });
    await mouse(...await at('blank'));
    await sleep(400);
    const gone = await tipText();
    result('companion: the mark goes when the pointer leaves the link', !gone, { after: gone });

    // The companion switched off: a fresh page has nothing listening, and nothing appears.
    await evalIn(browser, opt.sessionId, 'chrome.storage.sync.set({ enabled: false }).then(() => true)');
    await goto(browser, s, `${files.base}/thread.html`);
    await sleep(800);
    await mouse(...await at('blank'));
    await sleep(300);
    await mouse(...await at('scam'));
    await sleep(2500);
    const off = await tipText();
    const host = await evalIn(browser, s, "Boolean(document.querySelector('[data-sentinel-hover]'))");
    await shot(browser, s, 'companion-hover-off');
    result('companion: with the companion turned off, resting on the same link shows nothing', !off && !host, { tip: off, host });
  } finally {
    await close();
    files.server.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

/* ----------------------------------------------- 5. the practice inbox (/practice) */

async function checkPractice() {
  if (!fs.existsSync(path.join(STATIC, 'practice.html'))) throw new Error(`no practice page in ${STATIC}: run npm run build:static`);
  const P = require('../web/assets/js/practice.js');
  const files = await serveFiles({ '/': STATIC });
  const { browser, close } = await launch();
  const errors = [];
  const requests = [];
  browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
  browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
  browser.on('Network.requestWillBeSent', (p) => requests.push(p.request.url));
  const key = async (s, k, code, vk) => {
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === 'keyDown' && k === 'Enter' ? { text: '\r' } : {}) }, s);
    await sleep(120);
  };
  const tab = (s) => key(s, 'Tab', 'Tab', 9);
  const enter = (s) => key(s, 'Enter', 'Enter', 13);
  // The whole inbox, not just the screen: a marked message and its clues run below the fold on a phone.
  const snap = async (s, name) => {
    try {
      const r = await evalIn(browser, s, "(() => { const r = document.querySelector('[data-practice]').getBoundingClientRect(); return { x: Math.max(0, r.left + scrollX - 12), y: Math.max(0, r.top + scrollY - 12), width: r.width + 24, height: r.height + 24 }; })()");
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r, scale: 1 } }, s);
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    } catch { /* a picture is a nicety */ }
  };
  const open = async ({ phone, reduce }) => {
    const { sessionId: s } = await openPage(browser);
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Network.enable', {}, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] }, s);
    if (phone) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, s);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
    }
    await goto(browser, s, `${files.base}/practice.html`, "document.querySelector('[data-practice] [data-pick]') && window.SentinelMotion");
    await sleep(1200);
    return s;
  };
  // What the page shows for the message on screen, after it was answered.
  const marked = (s) => evalIn(browser, s, `(() => {
    const marks = [...document.querySelectorAll('.pmsg .pmark')];
    return {
      shown: document.querySelector('.pmsg').classList.contains('is-marked') && marks.every((m) => getComputedStyle(m.querySelector('.pmark__n')).display !== 'none' && getComputedStyle(m).boxShadow !== 'none'),
      texts: marks.map((m) => m.firstChild.textContent), numbers: marks.map((m) => Number(m.dataset.clue)),
      clues: document.querySelectorAll('.practice__clues li').length, focus: document.activeElement && document.activeElement.matches('[data-practice-verdict]') ? 'verdict' : String(document.activeElement && document.activeElement.outerHTML).slice(0, 80),
      verdict: document.querySelector('[data-practice-verdict]').textContent, links: document.querySelectorAll('.pmsg a').length };
  })()`);

  /**
   * Sorts all twelve with the keyboard alone (Tab and Enter, from the message's heading), checking each answer's marks
   * against the message's own clues and that focus goes where a screen reader needs it. `choose` picks per message.
   */
  const playThrough = async (s, label, choose, shots) => {
    const problems = [];
    await evalIn(browser, s, "document.getElementById('pmsg-h').focus(), true");
    for (const [i, m] of P.MESSAGES.entries()) {
      const pick = choose(m);
      const heading = await evalIn(browser, s, "document.activeElement && document.activeElement.id === 'pmsg-h' ? document.activeElement.textContent : ''");
      if (!heading.startsWith(`Message ${i + 1} of 12`)) problems.push(`${m.id}: focus was not on the message's heading (${heading})`);
      if (shots[m.id] === 'before') await snap(s, `practice-${label}-${m.id}`);
      for (let t = 0; t < (pick === 'scam' ? 1 : 2); t++) await tab(s);
      const onButton = await evalIn(browser, s, 'document.activeElement && document.activeElement.dataset.pick');
      if (onButton !== pick) problems.push(`${m.id}: Tab reached ${onButton}, not ${pick}`);
      await enter(s);
      await sleep(500);
      const got = await marked(s);
      const want = P.parse([m.from, m.address, m.subject, m.body].filter(Boolean).join('\n')).filter((p) => p.clue);
      const order = P.clueOrder(m);
      if (!got.shown) problems.push(`${m.id}: the marks did not show`);
      if (JSON.stringify(got.texts) !== JSON.stringify(want.map((p) => p.text))) problems.push(`${m.id}: marked ${JSON.stringify(got.texts)}`);
      if (JSON.stringify(got.numbers) !== JSON.stringify(want.map((p) => order.indexOf(p.clue) + 1))) problems.push(`${m.id}: numbered ${got.numbers}`);
      if (got.clues !== order.length) problems.push(`${m.id}: ${got.clues} clues explained, ${order.length} marked`);
      if (got.focus !== 'verdict') problems.push(`${m.id}: focus after answering was ${got.focus}`);
      if (got.links) problems.push(`${m.id}: ${got.links} links in the message`);
      if (!got.verdict.includes(m.scam ? 'a scam' : 'real')) problems.push(`${m.id}: verdict "${got.verdict}"`);
      if (shots[m.id] === 'after') await snap(s, `practice-${label}-${m.id}`);
      await tab(s);
      if (!(await evalIn(browser, s, "Boolean(document.activeElement && document.activeElement.matches('[data-practice-next]'))"))) problems.push(`${m.id}: Tab after the verdict did not reach Next`);
      await enter(s);
      await sleep(400);
    }
    const end = await evalIn(browser, s, `(() => { const h = document.querySelector('[data-practice-end]');
      return h && { text: h.textContent, focused: document.activeElement === h, missed: document.querySelectorAll('.practice__missed li').length }; })()`);
    await snap(s, `practice-${label}-score`);
    return { problems, end };
  };

  try {
    /* A computer: all right but one, to see a missed one on the score. */
    const d = await open({});
    const truth = (m) => (m.scam ? 'scam' : 'real');
    const desk = await playThrough(d, 'desktop', (m) => (m.id === 'invoice' ? 'real' : truth(m)), { parcel: 'before', signin: 'after', library: 'after' });
    result('practice: on a computer, all twelve sort with Tab and Enter alone, each answer marks its clues where they are in the message, numbered as explained, and focus goes to the answer, then the next message',
      !desk.problems.length && desk.end && desk.end.focused && desk.end.text.startsWith('You sorted 11 of 12') && desk.end.missed === 1, { problems: desk.problems, end: desk.end });

    /* A phone: every message called a scam. Fits the width, big enough to tap, and the score does not scold. */
    const ph = await open({ phone: true });
    const fit = await evalIn(browser, ph, `(() => ({ wide: document.documentElement.scrollWidth, screen: innerWidth,
      tap: Math.min(...[...document.querySelectorAll('[data-pick]')].map((b) => b.getBoundingClientRect().height)) }))()`);
    const phone = await playThrough(ph, 'phone', () => 'scam', { parcel: 'after', reported: 'after', code: 'after' });
    const scams = P.MESSAGES.filter((m) => m.scam).length;
    const words = await evalIn(browser, ph, "document.querySelector('.practice__end').textContent");
    result('practice: on a phone, the inbox fits the screen, the answers are big enough to tap, and the same play-through works',
      fit.wide <= fit.screen && fit.tap >= 44 && !phone.problems.length && phone.end && phone.end.text.startsWith(`You sorted ${scams} of 12`) && phone.end.missed === 12 - scams, { fit, problems: phone.problems, end: phone.end });
    result('practice: the score says no unkind word', !/\b(fail|failed|wrong|bad|poor|stupid)\b/i.test(words) && words.includes(P.closing(scams, 12)), words.replace(/\s+/g, ' ').slice(0, 300));
    await evalIn(browser, ph, "document.querySelector('[data-practice-again]').click(), true");
    await sleep(300);
    const again = await evalIn(browser, ph, "({ count: document.querySelector('[data-practice-count]').textContent, focus: document.activeElement && document.activeElement.id })");
    result('practice: Sort them again starts over at the first message', again.count === 'Message 1 of 12' && again.focus === 'pmsg-h', again);

    /* Reduced motion: the message and its marks are simply there, no slide. */
    const r = await open({ reduce: true });
    await evalIn(browser, r, "document.querySelector('[data-pick=\"scam\"]').click(), true");
    await sleep(100);
    const still = await evalIn(browser, r, "(() => { const c = getComputedStyle(document.querySelector('.pmsg__card')); const v = getComputedStyle(document.querySelector('.practice__verdict')); return { card: c.animationDuration, verdict: v.animationDuration, opacity: v.opacity, lenis: document.documentElement.classList.contains('lenis') }; })()");
    result('practice: with reduced motion, nothing slides in and the answer is there at once', parseFloat(still.card) < 0.01 && parseFloat(still.verdict) < 0.01 && still.opacity === '1' && !still.lenis, still);

    const offHost = requests.filter((u) => !u.startsWith(files.base) && !u.startsWith('data:'));
    result('practice: nothing leaves the page\'s host (the answers stay in the page)', !offHost.length, offHost.length ? offHost : `${requests.length} requests, all local`);
    result('practice: no console errors', !errors.length, errors);
  } finally {
    await close();
    files.server.close();
  }
}

/* --------------------------------------------------------------------- run */

async function main() {
  const checks = { site: checkSite, motion: checkMotion, qr: checkQr, companion: checkCompanion, hover: checkHover, practice: checkPractice };
  for (const name of ONLY) {
    try { await checks[name](); } catch (err) { result(`${name}: the check itself could not run`, false, err.stack || err.message); }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const failed = report.filter((r) => !r.ok).length;
  console.log(`\n${report.length - failed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => { console.log(`FAIL  ${err.stack || err.message}`); process.exit(1); });
