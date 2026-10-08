'use strict';
/**
 * How smoothly the site runs on a phone and on a computer, measured, with frames to look at.
 *
 *   node scripts/perf-probe.js [--out perf] [--label before]
 *
 * For CI only (.github/workflows/review-shots.yml): a headless browser plays the home page as a mid-range phone
 * (390 x 844, touch, the processor slowed four times) and as a computer. It records every frame's length, the
 * long tasks that freeze the page, how many 3D drawing contexts are open, and how much work the page does, while
 * it opens, while a finger rests on the hero mask, and while it is scrolled from top to bottom. The hero is
 * photographed every 120 ms while touched (a mask that spins or leaves its place shows up there), and each screen
 * as the scroll arrives (a section that appears late shows up there).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { cdpPipe, startServer, CANDIDATES, expand, sleep, BASE } = require('./review-shots');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const OUT = path.resolve(arg('--out', 'perf'));
const LABEL = arg('--label', 'run');

// Runs before the page's own scripts: counts frames, long tasks and WebGL contexts.
const RECORDER = `(() => {
  const P = window.__probe = { frames: [], long: [], gl: 0, mark: null };
  let last = 0;
  const tick = (t) => { if (last) P.frames.push([t, t - last]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const c = get.call(this, kind, ...rest);
    if (c && /webgl/.test(kind) && !this.__counted) { this.__counted = true; P.gl++; }
    return c;
  };
})();`;

const MOUSE = `(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /hover: hover|pointer: fine/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); })();`;

function stats(frames, long, from, to) {
  const f = frames.filter(([t]) => t >= from && t < to).map(([, d]) => d).sort((a, b) => a - b);
  const l = long.filter(([t]) => t >= from && t < to);
  const pct = (p) => (f.length ? Math.round(f[Math.min(f.length - 1, Math.floor(f.length * p))]) : 0);
  const seconds = Math.max(0.001, (to - from) / 1000);
  return {
    fps: Math.round(f.length / seconds),
    frameP50: pct(0.5), frameP95: pct(0.95), frameMax: Math.round(f[f.length - 1] || 0),
    over50ms: f.filter((d) => d > 50).length,
    longTasks: l.length, longTaskMs: Math.round(l.reduce((s, [, d]) => s + d, 0))
  };
}

async function probe(send, name, { width, height, mobile, cpu }) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Page.enable');
  await s('Performance.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
  if (mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  if (cpu > 1) await s('Emulation.setCPUThrottlingRate', { rate: cpu });
  await s('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
  // A computer has a mouse, which a headless browser does not report: said here, so what a mouse turns on (the hover
  // effects, Lenis's smooth wheel) is measured too, on the released site and this one alike.
  if (!mobile) await s('Page.addScriptToEvaluateOnNewDocument', { source: MOUSE });
  const now = async () => (await s('Runtime.evaluate', { returnByValue: true, expression: 'performance.now()' })).result.value;
  const shot = async (file, clip) => {
    const r = await s('Page.captureScreenshot', { format: 'jpeg', quality: 70, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(OUT, `${LABEL}-${name}-${file}.jpg`), Buffer.from(r.data, 'base64'));
  };

  // 1. Opening: as a first visit (the opening sketch plays), until the page has settled.
  await s('Page.navigate', { url: `${BASE}/?intro=1` });
  await sleep(9000);
  const tBoot = await now();

  // 2. A finger on the hero mask, moved a little, then lifted; the hero photographed as it reacts.
  const hero = (await s('Runtime.evaluate', { returnByValue: true, expression: "(() => { const r = document.querySelector('[data-hero-mask]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()" })).result.value;
  const clip = { x: Math.max(0, hero.x - hero.w * 0.4), y: Math.max(0, hero.y - hero.h * 0.4), width: Math.min(width, hero.w * 1.8), height: hero.h * 1.8 };
  const fx = hero.x + hero.w * 0.8;
  const fy = hero.y + hero.h * 0.3;
  const touch = (type, x, y) => s('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const pointer = (type, x, y) => s('Input.dispatchMouseEvent', { type, x, y, button: 'none' });
  const t0 = await now();
  if (mobile) await touch('touchStart', fx, fy); else await pointer('mouseMoved', fx, fy);
  for (let i = 0; i < 10; i++) {
    const x = fx - i * 12;
    const y = fy + i * 6;
    if (mobile) await touch('touchMove', x, y); else await pointer('mouseMoved', x, y);
    await shot(`hero-${String(i).padStart(2, '0')}`, clip);
    await sleep(120);
  }
  if (mobile) await touch('touchEnd', 0, 0);
  for (let i = 10; i < 16; i++) { await shot(`hero-${i}`, clip); await sleep(120); }
  const tHero = await now();

  // 3. Scrolled from top to bottom, a screen at a time, by finger or wheel, photographed as each screen arrives.
  const full = (await s('Runtime.evaluate', { returnByValue: true, expression: 'document.documentElement.scrollHeight' })).result.value;
  const steps = Math.min(14, Math.ceil(full / height));
  for (let i = 0; i < steps; i++) {
    await s('Input.synthesizeScrollGesture', { x: width / 2, y: height * 0.6, yDistance: -Math.round(height * 0.85), speed: 1600, gestureSourceType: mobile ? 'touch' : 'mouse', repeatCount: 1 });
    await sleep(250);
    await shot(`scroll-${String(i).padStart(2, '0')}`);
  }
  const tScroll = await now();
  const p = (await s('Runtime.evaluate', { returnByValue: true, expression: 'JSON.stringify(window.__probe)' })).result.value;
  const { frames, long, gl } = JSON.parse(p);
  const { metrics } = await s('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map(({ name: n, value }) => [n, value]));
  await send('Target.closeTarget', { targetId });
  return {
    name, cpu, webglContexts: gl,
    boot: stats(frames, long, 0, tBoot),
    heroTouch: stats(frames, long, t0, tHero),
    scroll: stats(frames, long, tHero, tScroll),
    totals: {
      scriptMs: Math.round((m.ScriptDuration || 0) * 1000), layoutMs: Math.round((m.LayoutDuration || 0) * 1000),
      styleMs: Math.round((m.RecalcStyleDuration || 0) * 1000), taskMs: Math.round((m.TaskDuration || 0) * 1000),
      heapMB: Math.round((m.JSHeapUsedSize || 0) / 1e6)
    }
  };
}

async function main() {
  const exe = CANDIDATES.chrome.map(expand).find((p) => fs.existsSync(p));
  if (!exe) throw new Error('chrome is not installed here');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-perf-profile-'));
  // WebGL in software, as a GPU-less runner has it: slower than a real phone's GPU, so heavy drawing shows clearly.
  const browser = spawn(exe, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--enable-unsafe-swiftshader', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  const send = cdpPipe(browser);
  try {
    const results = [];
    results.push(await probe(send, 'phone', { width: 390, height: 844, mobile: true, cpu: 4 }));
    results.push(await probe(send, 'desktop', { width: 1366, height: 900, mobile: false, cpu: 1 }));
    fs.writeFileSync(path.join(OUT, `${LABEL}-results.json`), JSON.stringify(results, null, 2));
    for (const r of results) {
      console.log(`\n${r.name} (cpu x${r.cpu}), WebGL contexts: ${r.webglContexts}`);
      for (const phase of ['boot', 'heroTouch', 'scroll']) console.log(`  ${phase.padEnd(9)} ${JSON.stringify(r[phase])}`);
      console.log(`  totals    ${JSON.stringify(r.totals)}`);
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
