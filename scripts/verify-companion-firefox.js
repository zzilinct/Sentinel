'use strict';
/**
 * The Firefox counterpart of verify-companion.js: installs the Firefox build of
 * the companion as a temporary add-on in a headless Firefox with a throwaway
 * profile, and checks that it marks every result on a search page.
 *
 *   node scripts/verify-companion-firefox.js [--firefox "C:\path\firefox.exe"] [--server http://127.0.0.1:47821]
 *
 * Firefox is driven over Marionette, its own automation protocol (length-prefixed
 * JSON on a local TCP port). The results page is served by a tiny local proxy at
 * the search engine's real address, so the real match pattern and content script
 * run; nothing reaches the network and none of the links is ever opened.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const SERVER = arg('--server', 'http://127.0.0.1:47821').replace(/\/$/, '');
const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'desktop', 'companion-firefox');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expand = (p) => p.replace(/%([^%]+)%/g, (m, n) => process.env[n] || m);
const FIREFOX = arg('--firefox', ['%ProgramFiles%\\Mozilla Firefox\\firefox.exe', '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe', '%ProgramFiles%\\LibreWolf\\librewolf.exe', '/usr/bin/firefox', '/Applications/Firefox.app/Contents/MacOS/firefox'].map(expand).find((p) => fs.existsSync(p)));

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
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>results at DuckDuckGo</title></head><body><div id="links" class="results">${
  RESULTS.map(([href, title]) => `<div class="result results_links"><h2 class="result__title"><a rel="nofollow" class="result__a" href="${href}">${title}</a></h2></div>`).join('')
}</div></body></html>`;

/** Marionette: "<length>:<json>" frames; [0, id, command, params] out, [1, id, error, result] back. */
function marionette(port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0);
    let id = 0;
    let greeted = false;
    const waiting = new Map();
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const colon = buf.indexOf(0x3a);
        if (colon < 0) return;
        const len = Number(buf.subarray(0, colon).toString());
        if (buf.length < colon + 1 + len) return;
        const msg = JSON.parse(buf.subarray(colon + 1, colon + 1 + len).toString('utf8'));
        buf = buf.subarray(colon + 1 + len);
        if (!greeted) { greeted = true; resolve(api); continue; }
        const [, mid, error, result] = msg;
        const w = waiting.get(mid);
        if (!w) continue;
        waiting.delete(mid);
        if (error) w.rej(new Error(`${error.error}: ${error.message}`)); else w.res(result);
      }
    });
    const api = {
      send(command, params = {}) {
        return new Promise((res, rej) => {
          const n = ++id;
          waiting.set(n, { res, rej });
          const body = JSON.stringify([0, n, command, params]);
          sock.write(`${Buffer.byteLength(body)}:${body}`);
        });
      },
      close: () => sock.destroy()
    };
  });
}

async function main() {
  if (!FIREFOX) { console.log('SKIP  Firefox is not installed on this computer'); return 2; }
  if (!fs.existsSync(path.join(ADDON, 'manifest.json'))) throw new Error('build the Firefox companion folder first: node desktop/scripts/sync-shared.js');

  let token;
  try {
    const r = await fetch(`${SERVER}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SERVER }, body: '{}' });
    token = (await r.json()).token;
  } catch { /* handled below */ }
  if (!token) { console.log(`SKIP  no Sentinel answering at ${SERVER} with a device account (start the desktop app)`); return 2; }

  // The "search engine": a local proxy that answers the results page and nothing else.
  const proxy = http.createServer((req, res) => {
    if (/^http:\/\/html\.duckduckgo\.com\//.test(req.url)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
    res.writeHead(502); res.end();
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-firefox-'));
  const mport = 2900 + Math.floor(Math.random() * 300);
  fs.writeFileSync(path.join(profile, 'user.js'), [
    ['marionette.port', mport],
    ['network.proxy.type', 1], ['network.proxy.http', '127.0.0.1'], ['network.proxy.http_port', proxy.address().port],
    ['network.proxy.no_proxies_on', ''], ['network.proxy.allow_hijacking_localhost', false],
    // The results page is plain http at the engine's address; keep Firefox from upgrading it.
    ['network.stricttransportsecurity.preloadlist', false], ['dom.security.https_only_mode', false], ['dom.security.https_first', false],
    // A headless window is never "focused"; the companion only scans a tab that is in use.
    ['focusmanager.testmode', true], ['widget.windows.window_occlusion_tracking.enabled', false], ['dom.min_background_timeout_value', 4],
    ['browser.shell.checkDefaultBrowser', false], ['datareporting.policy.dataSubmissionEnabled', false], ['app.update.enabled', false],
    ['extensions.webextensions.restrictedDomains', '']
  ].map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));

  const child = spawn(FIREFOX, ['-headless', '-no-remote', '-marionette', '-remote-allow-system-access', '-profile', profile], { stdio: 'ignore' });
  const result = {};
  let m;
  try {
    for (let i = 0; i < 80 && !m; i++) { await sleep(500); m = await marionette(mport).catch(() => null); }
    if (!m) throw new Error('Firefox did not open its Marionette port');
    const session = await m.send('WebDriver:NewSession', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
    result.version = `Firefox/${session.capabilities.browserVersion}`;

    const addonId = await m.send('Addon:Install', { path: ADDON, temporary: true });
    result.addonId = addonId.value || addonId;

    // Firefox asks the person before an add-on may read sites. The popup makes
    // that request; here the same permission is granted from the browser side.
    await m.send('Marionette:SetContext', { value: 'chrome' });
    const info = await m.send('WebDriver:ExecuteAsyncScript', {
      script: `const [id, done] = arguments;
        (async () => {
          const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
          const policy = WebExtensionPolicy.getByID(id);
          await ExtensionPermissions.add(id, { permissions: [], origins: ['<all_urls>'] }, policy.extension);
          return { host: policy.mozExtensionHostname, background: Boolean(policy.extension.backgroundContext || true), version: policy.extension.version };
        })().then(done, (e) => done({ error: String(e) }));`,
      args: [result.addonId], sandbox: 'system'
    });
    const ext = info.value;
    if (ext.error) throw new Error(`could not grant site access: ${ext.error}`);
    result.companion = ext.version;
    await m.send('Marionette:SetContext', { value: 'content' });

    // Pair from the add-on's own options page, exactly as a person's browser would hold the token.
    await m.send('WebDriver:Navigate', { url: `moz-extension://${ext.host}/src/options.html` });
    await sleep(1200);
    const paired = await m.send('WebDriver:ExecuteAsyncScript', {
      script: `const [token, server, done] = arguments;
        (async () => {
          const b = window.browser || window.wrappedJSObject.browser;
          await b.storage.local.set({ authToken: token });
          await b.storage.sync.set({ apiBase: server });
          const r = await b.runtime.sendMessage({ type: 'refresh' });
          return { signedIn: Boolean(r && r.account && r.account.signedIn), plan: r && r.account && r.account.plan ? r.account.plan.id : null };
        })().then(done, (e) => done({ error: String(e) }));`,
      args: [token, SERVER], sandbox: null
    });
    result.paired = paired.value;
    if (!result.paired || !result.paired.signedIn) throw new Error(`the companion could not sign in: ${JSON.stringify(result.paired)}`);

    // Bring the (headless) window to the front the way a person's click would.
    const handle = await m.send('WebDriver:GetWindowHandle');
    await m.send('WebDriver:SwitchToWindow', { handle: handle.value || handle, focus: true }).catch(() => {});
    await m.send('WebDriver:Navigate', { url: 'http://html.duckduckgo.com/html/?q=paypal+account+login+help' });
    let seenOverlay = false;
    let snap = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const r = await m.send('WebDriver:ExecuteScript', {
        script: `const groups = [...document.querySelectorAll('.sentinel-masks')];
          const kinds = { clear: 0, yellow: 0, orange: 0, red: 0 };
          for (const g of groups) for (const x of g.querySelectorAll('.sentinel-mask')) for (const k of Object.keys(kinds)) if (x.classList.contains('sentinel-mask--' + k)) kinds[k]++;
          return { results: document.querySelectorAll('a.result__a').length, marked: groups.length, kinds, overlay: Boolean(document.querySelector('[data-sentinel-overlay]')), focused: document.hasFocus(), visible: document.visibilityState };`,
        args: []
      }).catch(() => null);
      snap = r && r.value;
      if (snap && snap.overlay) seenOverlay = true;
      if (snap && snap.results && snap.marked >= snap.results) break;
    }
    Object.assign(result, snap || {}, { seenOverlay });
  } finally {
    if (m) { await m.send('Marionette:Quit', { flags: ['eForceQuit'] }).catch(() => {}); m.close(); }
    child.kill();
    proxy.close();
    await sleep(1200);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Firefox may still be letting go */ }
  }

  const ok = result.results > 0 && result.marked >= result.results && result.seenOverlay;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${result.version || 'firefox'}`);
  console.log(`      companion ${result.companion || '-'} installed as a temporary add-on (event page), signed in on the ${result.paired ? result.paired.plan : '?'} plan`);
  console.log(`      results on the page: ${result.results}, marked: ${result.marked} (clear ${result.kinds ? result.kinds.clear : 0}, yellow ${result.kinds ? result.kinds.yellow : 0}, orange ${result.kinds ? result.kinds.orange : 0}, red ${result.kinds ? result.kinds.red : 0})`);
  console.log(`      scanning overlay seen: ${result.seenOverlay}`);
  if (!ok) console.log(`      tab in use: focused=${result.focused} visibility=${result.visible}`);
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => { console.log(`FAIL  firefox: ${err.message}`); process.exit(1); });
