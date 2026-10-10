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
  ['home', '/'], ['pricing', '/pricing'], ['download', '/download'], ['privacy', '/privacy'], ['terms', '/terms'], ['refunds', '/refunds'], ['recover', '/recover'],
  ['signup', '/signup', { anonymous: true }], ['login', '/login', { anonymous: true }], ['not-found', '/no-such-page'],
  ['app-overview', '/app'],
  ['app-week', '/app/week'],
  ['app-scan-empty', '/app/scan'],
  ['app-scan-phishing', `/app/scan?url=${encodeURIComponent('https://paypa1-secure-login.com/account/verify')}`, { wait: 6000 }],
  ['app-scan-clean', `/app/scan?url=${encodeURIComponent('https://www.wikipedia.org/')}`, { wait: 6000 }],
  ['app-files', '/app/threats'], ['app-email', '/app/email'], ['app-text', '/app/text'], ['app-history', '/app/history'], ['app-sites', '/app/sites'],
  ['app-protection', '/app/protection'], ['app-plan', '/app/plan'], ['app-security', '/app/security'], ['app-assistants', '/app/assistants'],
  ['app-call', '/app/call'], ['practice', '/practice']
];
// Name, width, height, phone, colour scheme: the site follows the system's light or dark setting, so both are photographed.
const SIZES = [['desktop', 1366, 900, false, 'dark'], ['phone', 390, 844, true, 'dark'], ['light', 1366, 900, false, 'light']];

/** Commands over the DevTools pipe; `onEvent`, if given, hears the browser's events (messages without an id). */
function cdpPipe(child, onEvent) {
  let id = 0;
  const waiting = new Map();
  let buf = '';
  child.stdio[4].on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (!msg.id) { if (onEvent) onEvent(msg); continue; }
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

let dbFile = null;
async function startServer() {
  const db = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-shots-'));
  dbFile = path.join(db, 'sentinel.db');
  const child = spawn(process.execPath, [path.join(process.env.SENTINEL_ROOT || ROOT, 'server', 'index.js')], {
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
  if (!r.ok) throw new Error(`sign-up was refused: ${r.status} ${await r.text()}`);
  // Signing up signs nobody in: a session of its own, for the calls below.
  const s = await post('/api/v1/auth/login', { email, password: PASSWORD });
  if (!s.ok) throw new Error(`sign-in was refused: ${s.status} ${await s.text()}`);
  const cookie = (s.headers.getSetCookie ? s.headers.getSetCookie() : [s.headers.get('set-cookie')]).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  await post('/api/v1/billing/plan', { plan: 'max' }, cookie);
  await seedWeek(post, cookie, email);
  return email;
}

/**
 * Your week (server/lib/week.js) with something in it. This week's counts come through the real endpoints: live
 * scanning checks a few results and a page, and the Windows app's numbers arrive the way the app hands them over.
 * The three weeks before cannot be made to happen now, so they are written straight into this throwaway database,
 * into the same counters a real account's past weeks come from.
 */
async function seedWeek(post, cookie, email) {
  const live = await post('/api/v1/live/batch', { urls: ['https://paypa1-secure-login.com/account/verify', 'https://github.com/', 'https://www.wikipedia.org/', 'https://www.bbc.co.uk/news', 'https://example.com/'], mode: 'fast' }, cookie);
  const visit = await post('/api/v1/live/visit', { url: 'https://paypa1-secure-login.com/account/verify', mode: 'fast' }, cookie);
  const app = await post('/api/v1/week/count', { counts: { files_checked: 37, files_quarantined: 1, commands_stopped: 1, chat_checked: 212, chat_flagged: 2 } }, cookie);
  if (!live.ok || !visit.ok || !app.ok) throw new Error(`your week could not be filled in: ${live.status} ${visit.status} ${app.status} ${await app.text()}`);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbFile);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const { id } = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    const d = new Date();
    const thisWeek = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const put = db.prepare('INSERT INTO usage_counters (user_id, week, metric, used) VALUES (?, ?, ?, ?)');
    const past = [
      { live_links: 412, live_flagged: 1, files_checked: 25, chat_checked: 160 },
      { live_links: 288, files_checked: 12, chat_checked: 95, commands_stopped: 1 },
      { live_links: 530, live_flagged: 3, files_checked: 41, chat_checked: 240, chat_flagged: 1, wallet_swaps: 1 }
    ];
    past.forEach((counts, i) => {
      for (const [metric, n] of Object.entries(counts)) put.run(id, thisWeek - (3 - i) * 7 * 24 * 60 * 60 * 1000, metric, n);
    });
  } finally { db.close(); }
}

/** Sign in through the real form, as a person would, so the browser holds a real session. */
async function signIn(send, email) {
  const { targetId } = await send('Target.createTarget', { url: BASE + '/login' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  // As a person would: wait until Sign in can be pressed. The page enables it once its script has bound the form.
  const started = Date.now();
  let ready = { value: false };
  for (let i = 0; i < 120 && ready.value !== true; i++) {
    await sleep(250);
    ({ result: ready } = await send('Runtime.evaluate', { expression: "(() => { const b = document.querySelector('[data-form] button[type=submit]'); return Boolean(b && !b.disabled); })()" }, sessionId));
  }
  if (ready.value !== true) { await send('Target.closeTarget', { targetId }); throw new Error('the sign-in button never became ready'); }
  console.log(`sign-in form ready after ${Date.now() - started} ms`);
  await send('Runtime.evaluate', { expression: `(() => { const f = document.querySelector('[data-form]'); f.email.value = ${JSON.stringify(email)}; f.password.value = ${JSON.stringify(PASSWORD)}; f.requestSubmit(); })()` }, sessionId);
  // A slow runner can take a while to answer: wait for the app rather than a fixed time.
  let result = { value: '' };
  for (let i = 0; i < 30 && !String(result.value).startsWith('/app'); i++) {
    await sleep(500);
    ({ result } = await send('Runtime.evaluate', { expression: 'location.pathname' }, sessionId));
  }
  if (!String(result.value).startsWith('/app')) {
    // Say what the page said, so a failed run explains itself.
    const { result: why } = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({ url: location.href, note: (document.querySelector('[data-note]') || {}).textContent || '', toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '), fields: [...document.querySelectorAll('.field__error')].map((t) => t.textContent).filter(Boolean).join(' | '), ready: document.readyState, type: document.contentType, body: document.body ? document.body.innerText.slice(0, 160) : '', nav: (performance.getEntriesByType('navigation')[0] || {}).type })` }, sessionId);
    await send('Target.closeTarget', { targetId });
    throw new Error(`sign-in did not reach the app: ${why.value}`);
  }
  await send('Target.closeTarget', { targetId });
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
    // signIn waits for the form to be ready, so the first attempt should do. A retry is still allowed for a runner
    // hiccup, and the count is logged so a regression shows instead of hiding.
    const email = await signUp();
    for (let attempt = 1; ; attempt++) {
      try { await signIn(send, email); console.log(`signed in on attempt ${attempt}`); break; } catch (err) {
        if (attempt >= 3) throw err;
        console.log(`sign-in attempt ${attempt} failed (${err.message}); trying again`);
        await sleep(2000 * attempt);
      }
    }
    // Signed-out pages are photographed in a separate, empty browser context.
    const { browserContextId: anonymous } = await send('Target.createBrowserContext', {});
    for (const [size, width, height, mobile, scheme] of SIZES) {
      for (const [name, url, opt = {}] of PAGES) {
        const { targetId } = await send('Target.createTarget', { url: 'about:blank', ...(opt.anonymous ? { browserContextId: anonymous } : {}) });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, sessionId);
        await send('Page.navigate', { url: BASE + url }, sessionId);
        await sleep(opt.wait || 2500);
        // The whole page, top to bottom, as someone scrolling it would see it (capped for very long pages).
        // Scroll-triggered reveals are shown, and an app page whose content scrolls inside its own panel is laid out
        // at full height, so the photograph holds what someone scrolling would see.
        const { result: inner } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
          document.querySelectorAll('[data-reveal], [data-split], [data-pipeline]').forEach((el) => el.classList.add('is-in', 'is-visible'));
          document.querySelectorAll('.lux-wait').forEach((el) => { el.classList.remove('lux-wait'); el.classList.add('lux-in'); });
          let tallest = document.documentElement.scrollHeight;
          for (const el of document.querySelectorAll('main, .main, .app__main, [data-view], .view')) {
            if (el.scrollHeight > el.clientHeight + 20) { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; tallest = Math.max(tallest, el.scrollHeight + el.getBoundingClientRect().top); }
          }
          document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
          return tallest;
        })()` }, sessionId);
        // Long enough for the slowest entrance (headings rise over a second, after a stagger).
        await sleep(2500);
        const { cssContentSize } = await send('Page.getLayoutMetrics', {}, sessionId);
        const full = Math.min(Math.ceil(Math.max(cssContentSize.height, Number(inner.value) || 0)), 9000);
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.max(height, full), scale: 1 } }, sessionId);
        fs.writeFileSync(path.join(OUT, `${size}-${name}.png`), Buffer.from(shot.data, 'base64'));
        console.log(`${size}-${name}.png  ${width}x${Math.max(height, full)}`);
        // A long page also in screen-sized parts, which can be looked at without shrinking the whole page to fit.
        if (full > height * 2) {
          for (let y = 0, i = 1; y < full; y += height * 1.5, i++) {
            const part = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y, width, height: Math.min(height * 1.5, full - y), scale: 1 } }, sessionId);
            fs.writeFileSync(path.join(OUT, `${size}-${name}-part${i}.png`), Buffer.from(part.data, 'base64'));
          }
        }
        await send('Target.closeTarget', { targetId });
      }
    }
    // The opening, frame by frame, on the site and in the app (it never plays for a test browser unless asked).
    for (const [name, url] of [['site', '/?intro=1'], ['app', '/app?intro=1']]) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      // CI's Windows has animations off, which browsers report as reduced motion: these frames are about the motion.
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sessionId);
      await send('Page.navigate', { url: BASE + url }, sessionId);
      // The clock starts when the sheet is down (intro.js has run), not when the navigation was asked for.
      for (let i = 0; i < 150; i++) {
        try {
          const { result } = await send('Runtime.evaluate', { returnByValue: true, expression: "Boolean(document.querySelector('.intro-cover'))" }, sessionId);
          if (result.value) break;
        } catch { /* the new page is not attached yet */ }
        await sleep(20);
      }
      const started = Date.now();
      for (const at of [120, 350, 550, 750, 950, 1250, 1600, 2400]) {
        await sleep(Math.max(0, at - (Date.now() - started)));
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        fs.writeFileSync(path.join(OUT, `intro-${name}-${String(at).padStart(4, '0')}ms.png`), Buffer.from(shot.data, 'base64'));
      }
      console.log(`intro-${name}: 8 frames`);
      await send('Target.closeTarget', { targetId });
    }
    // A phone's one slow unmasking wipe across the hero (home.js), frame by frame.
    {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
      await send('Page.navigate', { url: BASE + '/' }, sessionId);
      const t0 = Date.now();
      for (const ms of [1400, 2000, 2600, 3200, 3800, 4800]) {
        await sleep(Math.max(0, ms - (Date.now() - t0)));
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        fs.writeFileSync(path.join(OUT, `wipe-phone-${String(ms).padStart(4, '0')}ms.png`), Buffer.from(shot.data, 'base64'));
      }
      console.log('wipe-phone: 6 frames');
      await send('Target.closeTarget', { targetId });
    }
    // Each app page's entrance, caught mid-way: open the overview, then click through the sidebar.
    {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sessionId);
      await send('Page.navigate', { url: BASE + '/app' }, sessionId);
      await sleep(3000);
      for (const route of ['week', 'protection', 'scan', 'threats', 'history', 'sites', 'plan', 'security', 'assistants', 'home']) {
        await send('Runtime.evaluate', { expression: `document.querySelector('.side__link[data-route="${route}"]').click()` }, sessionId);
        const t0 = Date.now();
        // The wipe from the link is over by about 420 ms; tiles and counts are still moving at 450 ms.
        for (const at of [90, 220, 450]) {
          await sleep(Math.max(0, at - (Date.now() - t0)));
          const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
          fs.writeFileSync(path.join(OUT, `motion-${route}-${at}ms.png`), Buffer.from(shot.data, 'base64'));
        }
        await sleep(1400);
      }
      console.log('motion: entrances photographed');
      // Toasts, as the island: one opening, a second morphing out of it, then the island folding away.
      const island = async (name) => {
        const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 383, y: 0, width: 1000, height: 160, scale: 1 } }, sessionId);
        fs.writeFileSync(path.join(OUT, `motion-island-${name}.png`), Buffer.from(shot.data, 'base64'));
      };
      await send('Runtime.evaluate', { expression: "UI.toast('Copied. Paste it into the browser\\'s address bar.', 'success', 1600)" }, sessionId);
      for (const at of [60, 180, 600]) { await sleep(at === 60 ? 60 : at === 180 ? 120 : 420); await island(`open-${at}ms`); }
      await send('Runtime.evaluate', { expression: "UI.toast('One file at a time. This one is still being checked, so the next one waits until it is done.', 'info', 1200)" }, sessionId);
      for (const at of [120, 600]) { await sleep(at === 120 ? 120 : 480); await island(`morph-${at}ms`); }
      await sleep(1000);
      await island('closing');
      await sleep(900);
      await island('gone');
      console.log('motion: island photographed');
      await send('Target.closeTarget', { targetId });
    }
    // Hover (hover.js): a real pointer moved round the home page, photographed as it goes.
    {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
      // A headless browser has no mouse to report; say there is one, as a desktop browser would.
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /hover: hover|pointer: fine/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); })();` }, sessionId);
      await send('Page.navigate', { url: BASE + '/' }, sessionId);
      await sleep(4500);
      let at = { x: 1300, y: 860 };
      const move = async (x, y, steps = 12) => {
        for (let i = 1; i <= steps; i++) {
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + (x - at.x) * i / steps, y: at.y + (y - at.y) * i / steps }, sessionId);
          await sleep(16);
        }
        at = { x, y };
      };
      const rect = async (sel) => (await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, sx: scrollX, sy: scrollY }; })()` }, sessionId)).result.value;
      const shoot = async (name, clip) => {
        const shot = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 }, captureBeyondViewport: true } : {}) }, sessionId);
        fs.writeFileSync(path.join(OUT, `hover-${name}.png`), Buffer.from(shot.data, 'base64'));
      };
      // The pointer works in the window, a clip in the page: the clip adds the scroll.
      const pad = (r, p) => ({ x: Math.max(0, r.x + r.sx - p), y: Math.max(0, r.y + r.sy - p), width: r.w + p * 2, height: r.h + p * 2 });
      const m = await rect('[data-hero-mask]');
      if (m) {
        const cx = m.x + m.w / 2;
        const cy = m.y + m.h / 2;
        await move(cx + 260, cy - 80); await sleep(1400); await shoot('gaze-right');
        await move(cx - 280, cy + 120, 20); await sleep(1400); await shoot('gaze-left');
        await move(1340, 880, 10); await sleep(700); await shoot('gaze-away');
        await sleep(3200); await shoot('gaze-rest');
      }
      // The hero unmasked (home.js): the pointer dragged across the left half of the hero, photographed mid-drag after
      // each stretch (the pointer still moving), then twice after it stops. Each frame also logs how much of the
      // canvas is revealed, so a blank frame says whether the brush painted at all.
      {
        await send('Runtime.evaluate', { expression: 'scrollTo(0, 0)' }, sessionId);
        await sleep(600);
        const revealed = async () => (await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
          const c = document.querySelector('.hero__unmask'); if (!c || !c.width) return 'no canvas';
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let solid = 0; let any = 0; const all = d.length / 64;
          for (let i = 3; i < d.length; i += 64) { if (d[i] > 200) solid++; if (d[i] > 24) any++; }
          return (100 * solid / all).toFixed(1) + '% of the hero shown solid, ' + (100 * any / all).toFixed(1) + '% touched';
        })()` }, sessionId)).result.value;
        await move(90, 260, 6);
        const path = [[240, 330], [380, 250], [520, 380], [400, 520], [220, 470], [330, 360]];
        for (let i = 0; i < path.length; i++) {
          await move(path[i][0], path[i][1], 16);
          // Read the canvas first (a screenshot on this software renderer takes a second or two, while it fades).
          const share = await revealed();
          await shoot(`unmask-drag-${i + 1}`);
          console.log(`unmask-drag-${i + 1}: ${share}`);
        }
        const t0 = Date.now();
        for (const ms of [700, 2600]) {
          await sleep(Math.max(0, ms - (Date.now() - t0)));
          await shoot(`unmask-after-${String(ms).padStart(4, '0')}ms`);
          console.log(`unmask-after-${ms}ms: ${await revealed()}`);
        }
      }
      // The demo sliding up over the held hero (stacked chapters), half way.
      {
        await move(1340, 880, 4);
        await send('Runtime.evaluate', { expression: 'scrollTo(0, Math.round(innerHeight * 0.55))' }, sessionId);
        await sleep(700);
        await shoot('stack-half');
      }
      // motion.js: a chapter's paragraph half way through its word-by-word scrub, the figures counting with their bars,
      // and the band of light (ShinyText) crossing the wordmark.
      {
        await send('Runtime.evaluate', { expression: "(() => { const s = document.querySelector('.stats').closest('[data-stack]'); scrollTo(0, Math.round(s.getBoundingClientRect().top + scrollY - innerHeight * 0.6)); })()" }, sessionId);
        const t0 = Date.now();
        for (const ms of [350, 800, 2200]) {
          await sleep(Math.max(0, ms - (Date.now() - t0)));
          await shoot(`count-${String(ms).padStart(4, '0')}ms`);
        }
        await send('Runtime.evaluate', { expression: "(() => { const p = document.querySelector('#masks .section__head > p'); scrollTo(0, Math.round(p.getBoundingClientRect().top + scrollY - innerHeight * 0.78)); })()" }, sessionId);
        await sleep(900);
        await shoot('words-scrub-half');
        await send('Runtime.evaluate', { expression: "scrollTo(0, 0); const w = document.querySelector('[data-hero-word]'); [...w.children].forEach((c, i) => c.style.setProperty('--i', i)); w.classList.remove('is-shining'); void w.offsetWidth; w.classList.add('is-shining'); true" }, sessionId);
        const t1 = Date.now();
        for (const ms of [450, 900]) {
          await sleep(Math.max(0, ms - (Date.now() - t1)));
          await shoot(`shine-${String(ms).padStart(4, '0')}ms`);
        }
        await sleep(1200);
      }
      // A chapter's laser line (motion.js) as its head arrives: wavy, straight, flaring, then the heading rising.
      {
        await send('Runtime.evaluate', { expression: "document.querySelector('#how .section__head').scrollIntoView({ block: 'center' })" }, sessionId);
        const t0 = Date.now();
        for (const ms of [120, 380, 650, 850, 1150, 1700]) {
          await sleep(Math.max(0, ms - (Date.now() - t0)));
          await shoot(`laser-${String(ms).padStart(4, '0')}ms`);
        }
        await send('Runtime.evaluate', { expression: 'scrollTo(0, 0)' }, sessionId);
        await sleep(800);
      }
      // A tab clicked: the panels, then the chapter sighted through the scope (site.js arrive), frame by frame.
      {
        await send('Runtime.evaluate', { expression: "scrollTo(0, 0); document.querySelector('.nav__links a[href=\"/#how\"]').click()" }, sessionId);
        const t0 = Date.now();
        for (const ms of [300, 700, 900, 1100, 1400, 1800, 2400]) {
          await sleep(Math.max(0, ms - (Date.now() - t0)));
          await shoot(`tab-arrive-${String(ms).padStart(4, '0')}ms`);
        }
        await send('Runtime.evaluate', { expression: 'scrollTo(0, 0)' }, sessionId);
        await sleep(800);
      }
      // Binary (binary.js): the example browser digging into its results, and a delicate "Try a link".
      {
        const stageRect = await rect('[data-stage] .window, .stage .window');
        if (stageRect) {
          await send('Runtime.evaluate', { expression: "document.querySelector('[data-stage] .window, .stage .window').scrollIntoView({ block: 'center' }); document.querySelector('[data-replay]')?.click()" }, sessionId);
          const t0 = Date.now();
          for (const ms of [900, 1500, 2200, 3200]) {
            await sleep(Math.max(0, ms - (Date.now() - t0)));
            await shoot(`binary-stage-${String(ms).padStart(4, '0')}ms`);
          }
        }
        await send('Runtime.evaluate', { expression: "document.querySelector('#try').scrollIntoView({ block: 'center' }); document.querySelector('[data-try-mode=\"delicate\"]').click(); const f = document.querySelector('[data-try-form]'); f.url.value = 'paypal-account-verify.com/login'; f.requestSubmit();" }, sessionId);
        const t1 = Date.now();
        for (const ms of [400, 1200, 6000]) {
          await sleep(Math.max(0, ms - (Date.now() - t1)));
          await shoot(`binary-try-${String(ms).padStart(4, '0')}ms`);
        }
        await send('Runtime.evaluate', { expression: 'scrollTo(0, 0)' }, sessionId);
        await sleep(600);
      }
      // A threat plate: its mask turning on hover, then a severity chosen, and the black hole frame by frame
      // (cosmos.js, mask3d.js). The software renderer of a headless browser is slow, so the frames are approximate.
      const plate = await rect('.plate .plate__art');
      if (plate) {
        await sleep(2500);
        await move(plate.x + plate.w / 2, plate.y + plate.h / 2, 10);
        await sleep(700); await shoot('plate-spin', pad(plate, 30));
        await send('Runtime.evaluate', { expression: "document.querySelector('.plate').closest('[data-trio]').querySelector('[data-sev=\"yellow\"]').click()" }, sessionId);
        const t0 = Date.now();
        for (const ms of [400, 900, 1300, 1700, 2200, 2700, 3200, 3700, 4300, 5200]) {
          await sleep(Math.max(0, ms - (Date.now() - t0)));
          await shoot(`blackhole-${String(ms).padStart(4, '0')}ms`, pad(plate, 60));
        }
        const { result: m3 } = await send('Runtime.evaluate', { returnByValue: true, expression: "[!!window.SentinelMask3D, document.querySelectorAll('.mask3d--ready').length, document.querySelectorAll('[data-mask3d]').length].join(' ')" }, sessionId);
        console.log(`3D masks (loaded, ready, total): ${m3.value}`);
      }
      for (const [name, sel, fx, fy] of [['gold-button', '.hero__cta .btn--gold', 0.25, 0.4], ['plan', '.plan--featured', 0.15, 0.12], ['kind', '.kind', 0.05, 0.5], ['footer-link', '.footer ul a', 0.02, 0.5], ['stat', '.stat', 0.85, 0.2]]) {
        const r = await rect(sel);
        if (!r) continue;
        await move(r.x - 30, r.y + r.h * fy, 4);
        await sleep(400);
        await move(r.x + r.w * fx, r.y + r.h * fy, 8);
        await sleep(name === 'footer-link' ? 220 : 900);
        await shoot(name, pad(r, 40));
        // Which hover state took, so a photograph that shows nothing can be explained.
        const { result: why } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const u = document.elementFromPoint(${Math.round(r.x + r.w * fx)}, ${Math.round(r.y + r.h * fy)}); return [el.className, (u && (u.className.baseVal ?? u.className)) || '', getComputedStyle(el).backgroundImage.slice(0, 90), document.documentElement.className].join(' | '); })()` }, sessionId);
        console.log(`hover-${name}: ${why.value}`);
        if (name === 'footer-link') { await sleep(700); await shoot(`${name}-filled`, pad(r, 40)); }
      }
      // The model picker on the link scan tab, open on its category and then on Argus's versions.
      await send('Page.navigate', { url: BASE + '/app/scan' }, sessionId);
      await sleep(3500);
      const click = (sel) => send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)})?.click()` }, sessionId);
      await click('[data-model-open]'); await sleep(900); await shoot('models-categories');
      await click('[data-model-cat]'); await sleep(900); await shoot('models-versions');
      // The email scan's screenshot tab, on Max (demo billing on this throwaway server).
      await send('Runtime.evaluate', { awaitPromise: true, expression: "fetch('/api/v1/billing/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'max' }) }).then((r) => r.status)" }, sessionId);
      await send('Page.navigate', { url: BASE + '/app/email' }, sessionId);
      await sleep(3500);
      await click('[data-emode="shot"]'); await sleep(900); await shoot('email-screenshot');
      console.log('hover: photographed');
      await send('Target.closeTarget', { targetId });
    }
    await featureShots(send);
    await textScan(send);
    await emailMarks(send);
    await weekCheck(send);
  } finally {
    try { await send('Browser.close'); } catch { /* gone */ }
    browser.kill();
    server.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked briefly */ }
  }
}

// A conversation on the path of a slow scam (server/lib/scan/slowscam.js), and an email pasted with headers that show it
// was not sent by the brand in From (server/lib/scan/sender.js). The same stand-ins verify-web uses.
const SLOW_CHAT = ['+1 917 555 0101: Hi, is this Linda?', 'Me: No, sorry, wrong number',
  '+1 917 555 0101: Oh I am so sorry! You seem kind though. I am Amy, I live in Singapore.',
  '+1 917 555 0101: I rarely use this app, add me on WhatsApp so we can keep talking',
  '+1 917 555 0101: My uncle is a financial analyst, he taught me crypto trading. I made $4,000 profit last week on a trading platform.',
  '+1 917 555 0101: I can teach you how to invest, start small'].join('\n');
const SPOOFED = ['Authentication-Results: mx.google.com;',
  '       spf=pass (google.com: domain of bounce@mailer-xyz.ru designates 198.51.100.7 as permitted sender) smtp.mailfrom=bounce@mailer-xyz.ru;',
  '       dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=paypal.com',
  'Return-Path: <bounce@mailer-xyz.ru>', 'From: PayPal <service@paypal.com>', 'Subject: Your account is limited', '',
  'Hello Alex,', 'We could not confirm a recent payment. Please review your account to restore full access.'].join('\n');

/**
 * The newest features in the state a person sees them in (an answer, a result, an open card), at every size in SIZES,
 * so each has a picture at phone width and in the light theme: feature-<size>-<name>.png, clipped to the feature.
 */
async function featureShots(send) {
  const CASES = [
    ['call', '/app/call', "document.querySelector('[data-call-answer]')",
      "document.querySelector('input[name=who][value=bank]').click(); document.querySelector('input[name=ask][value=code]').click();",
      "document.querySelector('[data-call-answer][data-verdict]')", '[data-call-answer]'],
    ['practice', '/practice', "document.querySelector('[data-practice] [data-pick]')",
      "document.querySelector('[data-pick=\"scam\"]').click();", "document.querySelector('[data-practice-verdict]')", '[data-practice]'],
    ['slow-scam', '/app/text', "document.querySelector('#view [data-form] textarea')",
      `const f = document.querySelector('[data-form]'); f.from.value = ''; f.text.value = ${JSON.stringify(SLOW_CHAT)}; f.requestSubmit();`,
      "document.querySelector('[data-slow]')", '[data-text-result]'],
    ['real-site', `/app/scan?url=${encodeURIComponent('https://paypa1-secure-login.com/account/verify')}`, "document.querySelector('#view [data-form]')",
      '', "document.querySelector('[data-warn]')", '.result__head', 260],
    ['warn-card', `/app/scan?url=${encodeURIComponent('https://paypa1-secure-login.com/account/verify')}`, "document.querySelector('#view [data-form]')",
      "document.querySelector('[data-warn]').click();", "document.querySelector('[data-warn-card] canvas') && document.querySelector('[data-warn-card] canvas').width", '[data-warn-card]'],
    ['who-sent-it', '/app/email', "document.querySelector('#view [data-emode=\"paste\"]')",
      `document.querySelector('[data-emode="paste"]').click(); document.querySelector('[data-paste] textarea').value = ${JSON.stringify(SPOOFED)}; document.querySelector('[data-parse]').click(); document.querySelector('form[data-form]').requestSubmit();`,
      "document.querySelector('[data-sender-proof]')", '#view .result']
  ];
  for (const [size, width, height, mobile, scheme] of SIZES) {
    for (const [name, url, ready, act, done, target, extra = 0] of CASES) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
      const until = async (expression, tries = 80) => { for (let i = 0; i < tries; i++) { if (await run(`Boolean(${expression})`)) return true; await sleep(250); } return false; };
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, sessionId);
      await send('Page.navigate', { url: BASE + url }, sessionId);
      if (!(await until(ready, 60))) { console.log(`feature-${size}-${name}: the page did not get ready`); await send('Target.closeTarget', { targetId }); continue; }
      await sleep(1200);   // the page's entrance (app-lux.js) settles
      if (act) await run(`(() => { ${act} })()`);
      if (!(await until(done))) { console.log(`feature-${size}-${name}: never showed`); await send('Target.closeTarget', { targetId }); continue; }
      await sleep(1200);   // the answer's own entrance settles
      // The app scrolls inside its panel: laid out at full height, so the clip is in page coordinates.
      const clip = await run(`(() => {
        document.querySelectorAll('.toast').forEach((t) => t.remove());
        for (const el of document.querySelectorAll('main, .main, .app__main, [data-view], .view')) {
          if (el.scrollHeight > el.clientHeight + 20) { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; }
        }
        document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
        const el = document.querySelector(${JSON.stringify(target)}).closest('.panel, article, [data-practice], [data-call-answer]') || document.querySelector(${JSON.stringify(target)});
        const r = (${JSON.stringify(target)} === '.result__head' ? document.querySelector('.result__head') : el).getBoundingClientRect();
        return { x: Math.max(0, r.left + scrollX - 12), y: Math.max(0, r.top + scrollY - 12), width: Math.min(r.width + 24, innerWidth), height: Math.min(r.height + 24 + ${extra}, 5000) };
      })()`);
      await sleep(300);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } }, sessionId);
      fs.writeFileSync(path.join(OUT, `feature-${size}-${name}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`feature-${size}-${name}.png`);
      await send('Target.closeTarget', { targetId });
    }
  }
}

// What Windows' text recognition returns for a phone screenshot of a scam text (desktop/src/ocr.js: lines, top to bottom).
const TEXT_SHOT = ['9:41', '5G 87', '<', '+1 (415) 555-0199 >', 'Text Message', 'Today 10:32 AM',
  'USPS: Your package is on hold due to an', 'unpaid redelivery fee of $1.99. Pay at', 'https://usps-redeliver.top/pay', 'Delivered', 'Text Message'];

/**
 * The text scan (app.js textView), at a computer's size and a phone's: a phone screenshot read the way the Windows app
 * reads one (its text recognition stood in for by what it returns for such a picture, TEXT_SHOT), then that scam text
 * and an ordinary one checked by the real server. Every step is asserted, so a broken page fails this job.
 */
async function textScan(send) {
  const check = (ok, what, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  text scan: ${what}${ok ? '' : `  got ${JSON.stringify(got)}`}`); if (!ok) throw new Error(`text scan: ${what}`); };
  for (const [size, width, height, mobile] of [['desktop', 1366, 900, false], ['phone', 390, 844, true]]) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.sentinelDesktop = { info: () => Promise.reject(new Error('stand-in')), readScreenshot: (slices) => Promise.resolve(slices.map((s, i) => (i ? '' : ${JSON.stringify(TEXT_SHOT.join('\n'))}))) };` }, sessionId);
    await send('Page.navigate', { url: BASE + '/app/text' }, sessionId);
    await sleep(3500);
    const run = async (expression) => {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (exceptionDetails) throw new Error(`text scan: ${exceptionDetails.exception ? exceptionDetails.exception.description : exceptionDetails.text}`);
      return result.value;
    };
    const page = async (name) => {
      const tall = await run(`(() => {
        let tallest = document.documentElement.scrollHeight;
        for (const el of document.querySelectorAll('main, .main, .app__main, [data-view], .view')) {
          if (el.scrollHeight > el.clientHeight + 20) { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; tallest = Math.max(tallest, el.scrollHeight + el.getBoundingClientRect().top); }
        }
        document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
        return tallest;
      })()`);
      await sleep(1200);
      const full = Math.min(Math.max(height, Math.ceil(Number(tall) || 0)), 6000);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: full, scale: 1 } }, sessionId);
      fs.writeFileSync(path.join(OUT, `text-${size}-${name}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`text-${size}-${name}.png`);
    };
    check(await run("document.title === 'Text scan · Sentinel' && Boolean(document.querySelector('.side__link[data-route=\"text\"][aria-current=\"page\"]'))"), 'its own page, title and sidebar link');
    await run("document.querySelector('[data-tmode=\"shot\"]').click()");
    await page('screenshot-tab');
    // A phone screenshot, drawn here and chosen in the file picker; the stand-in "reads" it as TEXT_SHOT.
    await run(`(async () => {
      const c = document.createElement('canvas'); c.width = 390; c.height = 420;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 390, 420); g.fillStyle = '#111'; g.font = '16px sans-serif';
      ${JSON.stringify(TEXT_SHOT)}.forEach((t, i) => g.fillText(t, 16, 30 + i * 34));
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'text.png', { type: 'image/png' }));
      const input = document.querySelector('[data-shot-file]'); input.files = dt.files; input.dispatchEvent(new Event('change'));
    })()`);
    await sleep(2000);
    const read = await run("[document.querySelector('#t-from').value, document.querySelector('#t-text').value, !document.querySelector('[data-form]').hidden]");
    check(read[0] === '+1 (415) 555-0199' && read[1].startsWith('USPS: Your package') && read[1].endsWith('usps-redeliver.top/pay') && !/Delivered|Text Message|9:41/.test(read[1]) && read[2], 'the screenshot is read into its sender and message, without the phone\'s own words', read);
    await page('screenshot-read');
    await run("document.querySelector('[data-form]').requestSubmit()");
    await sleep(3500);
    const scam = await run(`(() => { const r = document.querySelector('[data-text-result]'); const a = r && r.querySelector('a[href^="/app/recover?happened="]');
      return r && [r.dataset.textResult, r.querySelector('h2').textContent, a ? a.getAttribute('href') : '', r.querySelector('.reasons') ? r.querySelector('.reasons').textContent : '']; })()`);
    check(scam && ['orange', 'red'].includes(scam[0]) && scam[1] === 'This text looks like a scam' && scam[2].startsWith('/app/recover?happened=') && /usps-redeliver\.top/.test(scam[3]), 'the scam text gets a scam verdict, its reasons and the recovery guide', scam);
    const left = await run("document.querySelector('[data-left]').textContent");
    check(/fast scans left this week\. A text counts as one fast link scan/.test(left), 'the page says how it counts against the plan', left);
    await page('scam');
    await run("(() => { const f = document.querySelector('[data-form]'); f.from.value = 'Mom'; f.text.value = 'can you pick me up at 5'; f.requestSubmit(); })()");
    await sleep(3000);
    const clear = await run("[document.querySelector('[data-text-result]').dataset.textResult, document.querySelectorAll('[data-text-result] a[href^=\"/app/recover\"]').length]");
    check(clear[0] === 'clear' && clear[1] === 0, 'an ordinary text is left alone', clear);
    await page('clear');
    await send('Target.closeTarget', { targetId });
  }
  // From the command palette, by name.
  {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url: BASE + '/app' }, sessionId);
    await sleep(3500);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 }, sessionId);
    await sleep(400);
    await send('Input.insertText', { text: 'text' }, sessionId);
    await sleep(600);
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(OUT, 'text-palette.png'), Buffer.from(shot.data, 'base64'));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
    await sleep(1500);
    const { result } = await send('Runtime.evaluate', { returnByValue: true, expression: 'location.pathname' }, sessionId);
    check(result.value === '/app/text', 'the command palette finds Text scan and opens it', result.value);
    await send('Target.closeTarget', { targetId });
  }
}

// A phishing email typed into the email scan's fields, with each warning sign the result must mark in it.
const MARKED_EMAIL = {
  from: 'PayPal Security <alerts.paypal.security@gmail.com>',
  replyTo: 'recovery@paypal-account-verify.com',
  subject: 'URGENT: Your account has been suspended',
  body: 'Dear customer,\n\nWe detected unusual activity on your account.\nSign in at www.paypal.com <https://paypal-account-verify.com/login> to keep access.\n\nTo lift the hold, pay the $200 release fee with Google Play gift cards and send us the codes.\n\nPayPal Security Team'
};
const EXPECTED_MARKS = [
  ['subject', 'URGENT', 'Rushes you'],
  ['from', 'PayPal Security', 'Name is not the address'],
  ['replyTo', 'recovery@paypal-account-verify.com', 'Replies go elsewhere'],
  ['body', 'www.paypal.com <https://paypal-account-verify.com/login', 'Link goes somewhere else'],
  ['body', 'gift cards', 'Asks for gift cards or crypto']
];

/**
 * The email scan (app.js showMarks) shows the email itself inside the result, each warning sign marked where it is
 * and labelled, and a tap on a mark says why. Asserted at a computer's size and a phone's, and photographed.
 */
async function emailMarks(send) {
  const check = (ok, what, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  email marks: ${what}${ok ? '' : `  got ${JSON.stringify(got)}`}`); if (!ok) throw new Error(`email marks: ${what}`); };
  for (const [size, width, height, mobile, scheme] of [['desktop', 1366, 900, false, 'dark'], ['phone', 390, 844, true, 'dark'], ['light', 1366, 900, false, 'light']]) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, sessionId);
    const run = async (expression) => {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (exceptionDetails) throw new Error(`email marks: ${exceptionDetails.exception ? exceptionDetails.exception.description : exceptionDetails.text}`);
      return result.value;
    };
    await send('Page.navigate', { url: BASE + '/app/email' }, sessionId);
    await sleep(3500);
    await run(`(() => { const f = document.querySelector('[data-form]'); const m = ${JSON.stringify(MARKED_EMAIL)};
      f.from.value = m.from; f.replyTo.value = m.replyTo; f.subject.value = m.subject; f.body.value = m.body; f.attachments.value = ''; f.requestSubmit(); })()`);
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) { await sleep(500); ready = await run("Boolean(document.querySelector('[data-email-marks]'))"); }
    check(ready, `${size}: the result shows the email, marked`);
    const marks = await run(`[...document.querySelectorAll('[data-email-marks] [data-emark]')].map((m) => [m.closest('[data-efield]').dataset.efield, m.firstChild.textContent, m.querySelector('.emark__tag').textContent])`);
    for (const [field, words, label] of EXPECTED_MARKS) {
      check(marks.some((m) => m[0] === field && m[1].includes(words) && m[2].includes(label)), `${size}: "${label}" marks ${words} in ${field}`, marks);
    }
    check(await run("!/\\u2014/.test(document.querySelector('[data-email-marks]').textContent)"), `${size}: no em dashes in the marks`);
    // A real tap (or click) on the mismatched link's mark, at its place on the screen.
    // The first line of the mark: a long mark wraps, and the middle of its box can fall outside it.
    const box = await run(`(() => { const m = [...document.querySelectorAll('[data-emark]')].find((x) => x.textContent.includes('Link goes somewhere else')); m.scrollIntoView({ block: 'center' }); const r = m.getClientRects()[0]; return { x: r.left + Math.min(r.width / 2, 30), y: r.top + r.height / 2 }; })()`);
    await sleep(300);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(700);
    const why = await run(`(() => { const w = document.querySelector('[data-emark-why]'); const open = document.querySelector('[data-emark][aria-expanded="true"]');
      return w && [w.previousElementSibling && w.previousElementSibling.dataset.efield, w.textContent, open ? open.textContent : '']; })()`);
    check(why && why[0] === 'body' && /The words show one address, but the link opens a different one/.test(why[1]) && /paypal-account-verify\.com/.test(why[1]) && why[2].includes('Link goes somewhere else'), `${size}: tapping the link's mark says why, under the message`, why);
    const shoot = async (name, clip) => {
      const shot = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 }, captureBeyondViewport: true } : {}) }, sessionId);
      fs.writeFileSync(path.join(OUT, `email-marks-${size}-${name}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`email-marks-${size}-${name}.png`);
    };
    await shoot('why');
    // Tapped again, the explanation closes.
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(400);
    check(await run("!document.querySelector('[data-emark-why]') && !document.querySelector('[data-emark][aria-expanded=\"true\"]')"), `${size}: tapping the mark again closes it`);
    // The whole marked email, with the gift card ask opened, laid out at full height so all of it is in the picture.
    const clip = await run(`(() => {
      [...document.querySelectorAll('[data-emark]')].find((x) => x.textContent.includes('Asks for gift cards')).click();
      for (const el of document.querySelectorAll('main, .main, .app__main, [data-view], .view')) {
        if (el.scrollHeight > el.clientHeight + 20) { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; }
      }
      document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
      const r = document.querySelector('[data-email-marks]').getBoundingClientRect();
      return { x: Math.max(0, r.left + scrollX), y: Math.max(0, r.top + scrollY), width: Math.min(r.width, ${width}), height: Math.min(r.height, 4000) };
    })()`);
    await sleep(800);
    await shoot('section', clip);
    await send('Target.closeTarget', { targetId });
  }
}

/**
 * Your week (app.js weekView) says exactly what the server counted: the headline, a row for each count, four bars,
 * and the card on the overview. Asserted, so a page that shows anything else fails this job.
 */
async function weekCheck(send) {
  const check = (ok, what, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  your week: ${what}${ok ? '' : `  got ${JSON.stringify(got)}`}`); if (!ok) throw new Error(`your week: ${what}`); };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  await send('Page.navigate', { url: BASE + '/app/week' }, sessionId);
  await sleep(3500);
  const got = await run(`fetch('/api/v1/week').then((r) => r.json()).then((d) => {
    const w = d.weeks[d.weeks.length - 1];
    return { api: w, h: document.querySelector('[data-week-n]')?.textContent, rows: [...document.querySelectorAll('.week-rows .usage-row')].map((r) => [r.querySelector('.usage-row__l').firstChild.textContent.trim(), r.querySelector('.usage-row__n').textContent]),
      bars: [...document.querySelectorAll('.week-bars__col b')].map((b) => b.textContent), catch: document.querySelector('.week-hero__catch')?.textContent || '' };
  })`);
  check(got.h === got.api.headline && /^Sentinel caught \d+ things this week$/.test(got.h), 'the headline is the count the server keeps', [got.h, got.api.headline]);
  check(got.catch.includes(got.api.biggest) && /quarantine/.test(got.api.biggest), 'the biggest catch is the quarantined file, in plain words', got.catch);
  const row = (label) => (got.rows.find((r) => r[0] === label) || [])[1];
  check(row('Files quarantined') === String(got.api.counts.files_quarantined) && row('Links checked by live scanning') === String(got.api.counts.live_links), 'each row shows its count', got.rows);
  check(row('Wallet swaps caught') === '0' && !row('Look-alikes of your sites caught') && !row('Exposure alerts'), 'a row for each kind of count the four weeks hold, and none for what never happened', got.rows);
  check(got.bars.length === 4 && got.bars[3] === String(got.api.caught), 'four weeks of bars, this week last', got.bars);
  await send('Page.navigate', { url: BASE + '/app' }, sessionId);
  await sleep(3500);
  const card = await run("document.querySelector('.week-card h2')?.textContent || ''");
  check(card === got.api.headline, 'the overview carries the same headline', card);
  await send('Target.closeTarget', { targetId });
}

// Its browser and server helpers are shared with scripts/perf-probe.js.
if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { cdpPipe, startServer, CANDIDATES, expand, sleep, BASE };
