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
// Name, width, height, phone, colour scheme: the site follows the system's light or dark setting, so both are photographed.
const SIZES = [['desktop', 1366, 900, false, 'dark'], ['phone', 390, 844, true, 'dark'], ['light', 1366, 900, false, 'light']];

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
  if (!r.ok) throw new Error(`sign-up was refused: ${r.status} ${await r.text()}`);
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
  // A slow runner can take a while to answer: wait for the app rather than a fixed time.
  let result = { value: '' };
  for (let i = 0; i < 30 && !String(result.value).startsWith('/app'); i++) {
    await sleep(500);
    ({ result } = await send('Runtime.evaluate', { expression: 'location.pathname' }, sessionId));
  }
  if (!String(result.value).startsWith('/app')) {
    // Say what the page said, so a failed run explains itself.
    const { result: why } = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({ url: location.href, note: (document.querySelector('[data-note]') || {}).textContent || '', toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '), fields: [...document.querySelectorAll('.field__error')].map((t) => t.textContent).filter(Boolean).join(' | '), ready: document.readyState })` }, sessionId);
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
    // A slow runner sometimes submits before the sign-in script has loaded (the plain form post lands back on
    // /login with nothing said): try again, up to three times, before giving up.
    const email = await signUp();
    for (let attempt = 1; ; attempt++) {
      try { await signIn(send, email); break; } catch (err) {
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
    // Each app page's entrance, caught mid-way: open the overview, then click through the sidebar.
    {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sessionId);
      await send('Page.navigate', { url: BASE + '/app' }, sessionId);
      await sleep(3000);
      for (const route of ['protection', 'scan', 'threats', 'history', 'sites', 'plan', 'security', 'assistants', 'home']) {
        await send('Runtime.evaluate', { expression: `document.querySelector('.side__link[data-route="${route}"]').click()` }, sessionId);
        const t0 = Date.now();
        for (const at of [180, 450]) {
          await sleep(Math.max(0, at - (Date.now() - t0)));
          const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
          fs.writeFileSync(path.join(OUT, `motion-${route}-${at}ms.png`), Buffer.from(shot.data, 'base64'));
        }
        await sleep(1400);
      }
      console.log('motion: entrances photographed');
      await send('Target.closeTarget', { targetId });
    }
    // Hover (hover.js): a real pointer moved round the home page, photographed as it goes.
    {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sessionId);
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
      // A threat plate: its mask turning on hover, then a severity chosen, and the black hole frame by frame
      // (cosmos.js, mask3d.js). The software renderer of a headless browser is slow, so the frames are approximate.
      const plate = await rect('.plate .plate__art');
      if (plate) {
        await sleep(2500);
        await move(plate.x + plate.w / 2, plate.y + plate.h / 2, 10);
        await sleep(700); await shoot('plate-spin', pad(plate, 30));
        await send('Runtime.evaluate', { expression: "document.querySelector('.plate').closest('[data-trio]').querySelector('[data-sev=\"yellow\"]').click()" }, sessionId);
        const t0 = Date.now();
        for (const ms of [250, 600, 900, 1200, 1600, 2100, 2600, 3200, 4200]) {
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
  } finally {
    try { await send('Browser.close'); } catch { /* gone */ }
    browser.kill();
    server.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked briefly */ }
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
