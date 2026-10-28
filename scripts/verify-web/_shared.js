'use strict';
/**
 * What every check in scripts/verify-web/ shares: the command line, result reporting, a static file server, and a
 * headless Chrome driven over its DevTools pipe.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { cdpPipe, CANDIDATES, expand } = require('../verify-companion');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const ROOT = path.join(__dirname, '..', '..');
const ONLY = arg('--only', 'site,motion,qr,companion,hover,warn,typed,practice,call,paypause,slow,real,sender').split(',');
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
  return { browser, version: version.product, close, profile };
}

async function evalIn(browser, sessionId, expression, opts = {}) {
  // A page that never answers (hung, or its renderer gone) fails the step that asked, with what it was asked, instead
  // of holding the whole run until the job's time runs out.
  let timer;
  const r = await Promise.race([
    browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...opts }, sessionId),
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`the page did not answer in 3 minutes: ${String(expression).slice(0, 120)}`)), 180000); })
  ]).finally(() => clearTimeout(timer));
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

/* ------------------------------------------------------------ shared by checks */

// A listed scam (server/lib/scan/lists.js) that the typed and paypause checks both flag.
const TYPED_PW = 'paypa1-secure-login.com';

/** Press a button by its words, wherever it is (the companion's notes live in a closed shadow root), as a real click. */
async function clickButton(browser, sessionId, text) {
  const { root } = await browser.send('DOM.getDocument', { depth: -1, pierce: true }, sessionId);
  let found = null;
  const walk = (n) => {
    if (found) return;
    if (n.nodeName === 'BUTTON' && (n.children || []).some((c) => c.nodeType === 3 && c.nodeValue.trim() === text)) { found = n; return; }
    for (const c of [...(n.shadowRoots || []), ...(n.children || [])]) walk(c);
  };
  walk(root);
  if (!found) return false;
  const { model } = await browser.send('DOM.getBoxModel', { nodeId: found.nodeId }, sessionId);
  const q = model.content;
  const x = (q[0] + q[4]) / 2;
  const y = (q[1] + q[5]) / 2;
  for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId);
  return true;
}

/* ------------------------------------------------- the real server, signed in */

/**
 * The real Sentinel server (server/index.js) on a free port, with a throwaway accounts file and its output (where
 * development prints the emails it would send) in <name>-server.log. PUBLIC_ORIGIN is this address, so the links in
 * those emails open here.
 */
async function startServer(name, env = {}) {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), `sentinel-${name}-db-`));
  const logPath = path.join(OUT, `${name}-server.log`);
  const log = fs.openSync(logPath, 'w');
  const base = `http://127.0.0.1:${port}`;
  const dbPath = path.join(data, 'sentinel.db');
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', log, log],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath, FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo', PUBLIC_ORIGIN: base, ...env }
  });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${base}/api/v1/auth/config`)).ok; } catch { /* still starting */ } }
  const stop = async () => { child.kill(); await sleep(500); try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ } };
  if (!up) { await stop(); throw new Error(`the Sentinel server did not start on ${base} (see ${name}-server.log)`); }
  return { base, dbPath, logPath, stop, log: () => fs.readFileSync(logPath, 'utf8') };
}

/** Every exception, console error and failed load on the page, collected as they happen. */
async function watchErrors(browser, sessionId) {
  const errors = [];
  browser.on('Runtime.exceptionThrown', (p, sid) => { if (!sid || sid === sessionId) errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`); });
  browser.on('Runtime.consoleAPICalled', (p, sid) => { if ((!sid || sid === sessionId) && (p.type === 'error' || p.type === 'assert')) errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
  // Chrome logs every 4xx answer from the API as a failed load; those are answers the page shows in words (a wrong
  // password, a used link), not faults, so only other failed loads count.
  browser.on('Log.entryAdded', (p, sid) => {
    if ((!sid || sid === sessionId) && p.entry.level === 'error' && !(p.entry.source === 'network' && /status of 4\d\d/.test(p.entry.text) && /\/api\/v1\//.test(p.entry.url || ''))) errors.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url || ''}`);
  });
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Log.enable', {}, sessionId);
  return errors;
}

/** A real click in the middle of the first element matching `selector`, after bringing it into view. */
async function clickSel(browser, sessionId, selector) {
  const at = await evalIn(browser, sessionId, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
    e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  if (!at) throw new Error(`nothing on the page matches ${selector}`);
  for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', clickCount: 1 }, sessionId);
}

/** A key pressed and let go, as the keyboard sends it (Tab, Escape, Enter, ArrowDown, or a letter with ctrl). */
async function pressKey(browser, sessionId, key, { ctrl = false, shift = false } = {}) {
  const codes = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ' ': 32 };
  const code = codes[key] || key.toUpperCase().charCodeAt(0);
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const text = key === 'Enter' ? '\r' : key.length === 1 && !ctrl ? key : undefined;
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, modifiers, ...(text ? { text } : {}) }, sessionId);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, modifiers }, sessionId);
}

/** Wait until `expression` is truthy in the page (up to `ms`), returning its last value. */
async function until(browser, sessionId, expression, ms = 15000) {
  let v = null;
  for (const end = Date.now() + ms; Date.now() < end;) {
    v = await evalIn(browser, sessionId, expression).catch(() => null);
    if (v) return v;
    await sleep(150);
  }
  return v;
}

module.exports = { arg, ROOT, STATIC, QR, OUT, sleep, report, result, TYPES, serveFiles, launch, evalIn, openPage, goto, pageText, shot, typeText, pressEnter, TYPED_PW, clickButton,
  startServer, watchErrors, clickSel, pressKey, until };
