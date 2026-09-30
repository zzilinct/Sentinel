'use strict';
/**
 * Screenshots of every page, the way a person sees them, for a human-eye review of the site and the web app.
 *
 *   node scripts/review-shots.js [--out shots] [--browser chrome|edge]
 *
 * Starts a throwaway Sentinel server (its own database, no threat-list downloads, no page research), signs a test
 * account up on it, and photographs each page with a headless browser at a desktop size and a phone size. Nothing
 * is opened on screen: meant for CI (.github/workflows/review-shots.yml), so it never runs on a person's computer.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const OUT = path.resolve(arg('--out', 'shots'));
const BROWSER = arg('--browser', 'chrome');
const ROOT = path.join(__dirname, '..');
const PORT = 48000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const expand = (p) => p.replace(/%([^%]+)%/g, (m, n) => process.env[n] || m);
const CANDIDATES = {
  chrome: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  edge: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/microsoft-edge']
};

// The pages, in the order a new person meets them. `wait` gives a scan time to finish.
const PAGES = [
  ['home', '/'], ['pricing', '/pricing'], ['download', '/download'], ['privacy', '/privacy'], ['terms', '/terms'], ['refunds', '/refunds'],
  ['signup', '/signup', { anonymous: true }], ['login', '/login', { anonymous: true }], ['not-found', '/no-such-page'],
  ['app-overview', '/app'],
  ['app-scan-empty', '/app/scan'],
  ['app-scan-phishing', `/app/scan?url=${encodeURIComponent('https://paypa1-secure-login.com/account/verify')}`, { wait: 6000 }],
  ['app-scan-clean', `/app/scan?url=${encodeURIComponent('https://www.wikipedia.org/')}`, { wait: 6000 }],
  ['app-files', '/app/threats'], ['app-email', '/app/email'], ['app-history', '/app/history'], ['app-sites', '/app/sites'],
  ['app-protection', '/app/protection'], ['app-plan', '/app/plan'], ['app-security', '/app/security'], ['app-assistants', '/app/assistants']
];
const SIZES = [['desktop', 1366, 900, false], ['phone', 390, 844, true]];

function cdpPipe(child) {
  let id = 0;
  const waiting = new Map();
  let buf = '';
  child.stdio[4].on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (!msg.id) continue;
      const w = waiting.get(msg.id);
      if (!w) continue;
      waiting.delete(msg.id);
      if (msg.error) w.rej(new Error(msg.error.message)); else w.res(msg.result);
    }
  });
  return (method, params = {}, sessionId) => new Promise((res, rej) => {
    const n = ++id;
    waiting.set(n, { res, rej });
    child.stdio[3].write(`${JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
}

async function startServer() {
  const db = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-shots-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: path.join(db, 'sentinel.db'), FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo', SESSION_SECRET: 'review-shots-secret-000000000000000000000' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try { if ((await fetch(`${BASE}/api/v1/auth/config`)).ok) return child; } catch { /* not yet */ }
  }
  child.kill();
  throw new Error(`server did not start:\n${out}`);
}

const PASSWORD = 'Review-Sentinel-2026!';
/** A test account on the throwaway server, on the Max plan (demo billing), so every page shows its full self. */
async function signUp() {
  const email = `review-${Date.now()}@example.com`;
  const post = (p, body, cookie) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const r = await post('/api/v1/auth/signup', { email, password: PASSWORD, firstName: 'Alex', ageConfirmed: true, termsAccepted: true });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  await post('/api/v1/billing/plan', { plan: 'max' }, cookie);
  return email;
}

/** Sign in through the real form, as a person would, so the browser holds a real session. */
async function signIn(send, email) {
  const { targetId } = await send('Target.createTarget', { url: BASE + '/login' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(2500);
  await send('Runtime.evaluate', { expression: `(() => { const f = document.querySelector('[data-form]'); f.email.value = ${JSON.stringify(email)}; f.password.value = ${JSON.stringify(PASSWORD)}; f.requestSubmit(); })()` }, sessionId);
  await sleep(3500);
  const { result } = await send('Runtime.evaluate', { expression: 'location.pathname' }, sessionId);
  await send('Target.closeTarget', { targetId });
  if (!String(result.value).startsWith('/app')) throw new Error(`sign-in did not reach the app (at ${result.value})`);
}

async function main() {
  const exe = (CANDIDATES[BROWSER] || []).map(expand).find((p) => fs.existsSync(p));
  if (!exe) throw new Error(`${BROWSER} is not installed here`);
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-shots-profile-'));
  const browser = spawn(exe, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  const send = cdpPipe(browser);
  try {
    await signIn(send, await signUp());
    // Signed-out pages are photographed in a separate, empty browser context.
    const { browserContextId: anonymous } = await send('Target.createBrowserContext', {});
    for (const [size, width, height, mobile] of SIZES) {
      for (const [name, url, opt = {}] of PAGES) {
        const { targetId } = await send('Target.createTarget', { url: 'about:blank', ...(opt.anonymous ? { browserContextId: anonymous } : {}) });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
        await send('Page.navigate', { url: BASE + url }, sessionId);
        await sleep(opt.wait || 2500);
        // The whole page, top to bottom, as someone scrolling it would see it (capped for very long pages).
        // Scroll-triggered reveals are shown, and an app page whose content scrolls inside its own panel is laid out
        // at full height, so the photograph holds what someone scrolling would see.
        const { result: inner } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
          document.querySelectorAll('[data-reveal], [data-split], [data-pipeline]').forEach((el) => el.classList.add('is-in', 'is-visible'));
          let tallest = document.documentElement.scrollHeight;
          for (const el of document.querySelectorAll('main, .main, .app__main, [data-view], .view')) {
            if (el.scrollHeight > el.clientHeight + 20) { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; tallest = Math.max(tallest, el.scrollHeight + el.getBoundingClientRect().top); }
          }
          document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
          return tallest;
        })()` }, sessionId);
        await sleep(600);
        const { cssContentSize } = await send('Page.getLayoutMetrics', {}, sessionId);
        const full = Math.min(Math.ceil(Math.max(cssContentSize.height, Number(inner.value) || 0)), 9000);
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.max(height, full), scale: 1 } }, sessionId);
        fs.writeFileSync(path.join(OUT, `${size}-${name}.png`), Buffer.from(shot.data, 'base64'));
        console.log(`${size}-${name}.png  ${width}x${Math.max(height, full)}`);
        await send('Target.closeTarget', { targetId });
      }
    }
  } finally {
    try { await send('Browser.close'); } catch { /* gone */ }
    browser.kill();
    server.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked briefly */ }
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
