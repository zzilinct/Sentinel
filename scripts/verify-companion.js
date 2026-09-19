'use strict';
/**
 * Loads the built companion into a real Chromium browser and watches it work
 * on a real search page. Headless, in a throwaway profile, so it never touches
 * (or shows up in) the browser you actually use.
 *
 *   node scripts/verify-companion.js [--browser edge|chrome|brave|opera|vivaldi] [--server http://127.0.0.1:47821]
 *
 * It needs a running Sentinel to ask for verdicts: by default the desktop app's
 * own server, whose device account provides a token. Nothing is installed and
 * the profile is deleted afterwards.
 *
 * What it proves: the extension loads without errors in that browser, its
 * service worker starts, the content script runs on the results page, the
 * scanning overlay appears, and every result ends up with a mark.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BROWSER = arg('--browser', 'edge');
const SERVER = arg('--server', 'http://127.0.0.1:47821').replace(/\/$/, '');
const QUERY = arg('--query', 'paypal account login help');
const WAIT_S = Number(arg('--wait', '30'));   // a slow machine (a small VM mid feed-import) needs longer
const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');

const expand = (p) => p.replace(/%([^%]+)%/g, (m, n) => process.env[n] || m);
const CANDIDATES = {
  edge: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/microsoft-edge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  chrome: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  brave: ['%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', '%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', '/usr/bin/brave-browser'],
  opera: ['%LocalAppData%\\Programs\\Opera\\opera.exe', '%ProgramFiles%\\Opera\\opera.exe', '/usr/bin/opera'],
  vivaldi: ['%LocalAppData%\\Vivaldi\\Application\\vivaldi.exe', '/usr/bin/vivaldi']
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Honest sites, and made-up addresses in the style of scams. None is ever opened:
// the page is only a list of links, and the desktop app's scanner never fetches.
const RESULTS = [
  ['https://www.paypal.com/signin', 'Log in to your PayPal account'],
  ['https://en.wikipedia.org/wiki/PayPal', 'PayPal - Wikipedia'],
  ['https://paypal-account-verify-center.com/login', 'PayPal Account Verification Center'],
  ['https://www.paypal.com.login.verify-user.info/', 'PayPal: Restore Your Account Access'],
  ['https://github.com/paypal', 'PayPal on GitHub'],
  ['https://metamask-wallet-restore.io/', 'MetaMask Wallet Restore'],
  ['https://www.bbc.co.uk/news/technology', 'Technology news - BBC'],
  ['https://secure-login-portal.net/session/', 'Secure Login Portal'],
  ['https://support.microsoft.com/en-us/windows', 'Windows help and learning'],
  ['https://usps-tracking-update-fee.com/', 'USPS: Pay Your Redelivery Fee']
];

/** A tiny Chrome DevTools Protocol client over Node's built-in WebSocket. */
function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waiting = new Map();
    const listeners = [];
    ws.addEventListener('open', () => resolve({
      on(method, fn) { listeners.push({ method, fn }); },
      send(method, params = {}, sessionId) {
        return new Promise((res, rej) => {
          const n = ++id;
          waiting.set(n, { res, rej });
          ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
      },
      close: () => ws.close()
    }));
    ws.addEventListener('error', () => reject(new Error('could not reach the browser over DevTools')));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.id) { for (const l of listeners) if (l.method === msg.method) l.fn(msg.params, msg.sessionId); return; }
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      if (msg.error) w.rej(new Error(msg.error.message)); else w.res(msg.result);
    });
  });
}

/** The same client over the DevTools pipe, which is what allows Extensions.loadUnpacked. */
function cdpPipe(child) {
  let id = 0;
  const waiting = new Map();
  const listeners = [];
  let buf = '';
  child.stdio[4].on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (!msg.id) { for (const l of listeners) if (l.method === msg.method) l.fn(msg.params, msg.sessionId); continue; }
      const w = waiting.get(msg.id);
      if (!w) continue;
      waiting.delete(msg.id);
      if (msg.error) w.rej(new Error(msg.error.message)); else w.res(msg.result);
    }
  });
  return {
    on(method, fn) { listeners.push({ method, fn }); },
    send(method, params = {}, sessionId) {
      return new Promise((res, rej) => {
        const n = ++id;
        waiting.set(n, { res, rej });
        child.stdio[3].write(`${JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
    close() { /* the pipe closes with the browser */ }
  };
}

async function main() {
  const exe = (CANDIDATES[BROWSER] || []).map(expand).find((p) => fs.existsSync(p));
  if (!exe) { console.log(`SKIP  ${BROWSER} is not installed on this computer`); return 2; }
  if (!fs.existsSync(path.join(EXT, 'src', 'background.js'))) throw new Error('build the companion first: npm run build:ext');

  // A token from the running Sentinel (the desktop app's device account).
  let token;
  try {
    const r = await fetch(`${SERVER}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SERVER }, body: '{}' });
    token = (await r.json()).token;
  } catch { /* handled below */ }
  if (!token) { console.log(`SKIP  no Sentinel answering at ${SERVER} with a device account (start the desktop app)`); return 2; }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-companion-'));
  // Loaded over the DevTools pipe with Extensions.loadUnpacked: the supported way
  // now that branded Chrome ignores --load-extension on the command line.
  const child = spawn(exe, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,900', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

  const result = { browser: BROWSER, exe };
  try {
    const browser = cdpPipe(child);
    // A browser's very first launch after an install can take a minute on a slow machine.
    let exited = null;
    child.once('exit', (code, signal) => { exited = `it exited first (code ${code}${signal ? `, ${signal}` : ''})`; });
    const version = await Promise.race([browser.send('Browser.getVersion'), sleep(90000).then(() => { throw new Error(`the browser did not answer on its DevTools pipe; ${exited || 'it was still running after 90 s'}`); })]);
    result.version = version.product;

    let loaded;
    try { loaded = await browser.send('Extensions.loadUnpacked', { path: EXT }); }
    catch (err) { throw new Error(`the browser would not load the extension: ${err.message}`); }
    result.extensionId = loaded.id;

    // The service worker is the extension's heartbeat: it must come up.
    let sw;
    for (let i = 0; i < 40 && !sw; i++) {
      const { targetInfos } = await browser.send('Target.getTargets');
      sw = targetInfos.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${loaded.id}/src/background.js`);
      if (!sw) await sleep(250);
    }
    if (!sw) throw new Error('the extension loaded but its service worker never started');

    const evalIn = async (sessionId, expression) => {
      const r = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
      return r.result.value;
    };

    // Pair it with the running Sentinel from one of the extension's own pages
    // (where the extension APIs live), then ask the worker to sign in.
    const opt = await browser.send('Target.createTarget', { url: `chrome-extension://${result.extensionId}/src/options.html` });
    const optSession = (await browser.send('Target.attachToTarget', { targetId: opt.targetId, flatten: true })).sessionId;
    // Wait for the page itself, not for a fixed time: a first launch on a slow machine takes a while.
    let apisReady = false;
    for (let i = 0; i < 120 && !apisReady; i++) {
      apisReady = await evalIn(optSession, "location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && Boolean(chrome.storage && chrome.runtime && chrome.runtime.id)").catch(() => false);
      if (!apisReady) await sleep(250);
    }
    if (!apisReady) throw new Error('the extension\'s options page never got its extension APIs (the browser may block extension pages in this mode)');
    const paired = await evalIn(optSession, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(SERVER)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return { ok: r && r.ok, signedIn: Boolean(r && r.account && r.account.signedIn), plan: r && r.account && r.account.plan ? r.account.plan.id : null };
    })()`);
    result.paired = paired;
    if (!paired.signedIn) throw new Error(`the companion could not sign in to ${SERVER}: ${JSON.stringify(paired)}`);

    // A results page at a real search address, so the real match pattern and the
    // real content script run. Search engines show headless browsers a bot check,
    // so the one request is answered here with a results page in the engine's own
    // markup. The links are the interesting part: honest sites and made-up
    // scam-style addresses, each judged by the running Sentinel.
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(QUERY)}`;
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const page = (await browser.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, page);   // headless pages are never "focused" otherwise
    await browser.send('Page.enable', {}, page);
    const body = Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>${QUERY} at DuckDuckGo</title></head><body><div id="links" class="results">${
      RESULTS.map(([href, title]) => `<div class="result results_links"><h2 class="result__title"><a rel="nofollow" class="result__a" href="${href}">${title}</a></h2><a class="result__snippet" href="${href}">A result about ${title}.</a></div>`).join('')
    }</div></body></html>`).toString('base64');
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://html.duckduckgo.com/*' }] }, page);
    browser.on('Fetch.requestPaused', (params, sessionId) => {
      browser.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body }, sessionId).catch(() => {});
    });
    await browser.send('Page.navigate', { url }, page);

    let seenOverlay = false;
    let snapshot = null;
    for (let i = 0; i < WAIT_S * 2; i++) {
      await sleep(500);
      snapshot = await evalIn(page, `(() => {
        const groups = [...document.querySelectorAll('.sentinel-masks')];
        const results = document.querySelectorAll('a.result__a').length;
        const kinds = { clear: 0, yellow: 0, orange: 0, red: 0 };
        for (const g of groups) for (const m of g.querySelectorAll('.sentinel-mask')) for (const k of Object.keys(kinds)) if (m.classList.contains('sentinel-mask--' + k)) kinds[k]++;
        return { ready: document.readyState, results, marked: groups.length, kinds, overlay: Boolean(document.querySelector('[data-sentinel-overlay]')), title: document.title };
      })()`).catch(() => null);
      if (snapshot && snapshot.overlay) seenOverlay = true;
      if (snapshot && snapshot.results && snapshot.marked >= snapshot.results) break;
    }
    Object.assign(result, snapshot || {}, { seenOverlay });
    browser.close();
  } finally {
    child.kill();
    await sleep(800);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still be letting go */ }
  }

  const ok = result.results > 0 && result.marked >= result.results && result.seenOverlay;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${result.browser} ${result.version || ''}`);
  console.log(`      extension ${result.extensionId || '-'} loaded, service worker running, signed in on the ${result.paired ? result.paired.plan : '?'} plan`);
  console.log(`      results on the page: ${result.results}, marked: ${result.marked} (clear ${result.kinds ? result.kinds.clear : 0}, yellow ${result.kinds ? result.kinds.yellow : 0}, orange ${result.kinds ? result.kinds.orange : 0}, red ${result.kinds ? result.kinds.red : 0})`);
  console.log(`      scanning overlay seen: ${result.seenOverlay}`);
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => { console.log(`FAIL  ${BROWSER}: ${err.message}`); process.exit(1); });
