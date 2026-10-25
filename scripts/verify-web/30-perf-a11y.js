'use strict';
/**
 * perf-a11y  Speed and accessibility of every public page and every web-app page (signed in), on the real server in
 *            real Chrome: Lighthouse (performance, accessibility, best practices, SEO) at phone and desktop sizes, with
 *            LCP, CLS, TBT and the total transfer per page; and an axe-core audit of every page in dark and in light.
 *            Each page's scores are held to the floors in perf-budget.json, so a page that gets much slower or less
 *            accessible fails here.
 *
 * Lighthouse and axe-core are never project dependencies: the CI job installs them into a folder of its own and
 * names it in CI_TOOLS (.github/workflows/verify-web.yml). Without that folder, as in the main verify job, this check
 * says so and stops.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { OUT, sleep, result, launch, evalIn, openPage, goto, startServer } = require('./_shared');
const { CANDIDATES, expand } = require('../verify-companion');

const PUBLIC = ['/', '/pricing', '/download', '/privacy', '/terms', '/refunds', '/recover', '/practice', '/login', '/signup', '/forgot', '/guest', '/connect', '/reset', '/verify', '/no-such-page'];
const APP = ['/app', '/app/week', '/app/scan', '/app/threats', '/app/email', '/app/text', '/app/call', '/app/history', '/app/sites', '/app/checkup',
  '/app/protection', '/app/plan', '/app/security', '/app/assistants', '/app/recover'];
// Lighthouse often loses the start of its trace (NO_NAVSTART) when the page moves to a renderer process of its own;
// kept in one process, it reads every page (runs 40151667784 and 40153531591).
const ONE_PROCESS = '--disable-site-isolation-trials --disable-features=IsolateOrigins,site-per-process';
const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];
const BUDGET = path.join(__dirname, 'perf-budget.json');
// How far under its floor a score may fall before the check fails: performance moves a few points run to run on a
// shared runner, the others hardly at all.
const SLACK = { performance: 8, accessibility: 2, 'best-practices': 5, seo: 2 };

function lighthouse(cli, url, form, headersFile, jsonOut, extraFlags = '') {
  // A page that never lets the main thread rest runs Lighthouse to this limit; at 45 s the trace grew too long to read
  // (NO_NAVSTART), so the limit is shorter and the report says the page was still busy.
  const args = [cli, url, '--quiet', '--output=json', `--output-path=${jsonOut}`, `--only-categories=${CATS.join(',')}`,
    `--chrome-flags=--headless=new --no-first-run --no-default-browser-check ${extraFlags}`.trim(), '--disable-full-page-screenshot', '--max-wait-for-load=20000'];
  if (form === 'desktop') args.push('--preset=desktop');
  if (headersFile) args.push(`--extra-headers=${headersFile}`);
  const chrome = CANDIDATES.chrome.map(expand).find((p) => fs.existsSync(p));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, CHROME_PATH: chrome } });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('exit', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(fs.readFileSync(jsonOut, 'utf8'))); } catch { resolve({ error: err.slice(-400) || 'no report' }); }
    });
  });
}

/** What one Lighthouse report says, kept short: scores out of 100, the four numbers, and every audit that did not pass. */
function summarise(lhr) {
  if (lhr.error || !lhr.categories) return { error: lhr.error || (lhr.runtimeError && lhr.runtimeError.message) || 'no categories' };
  const a = lhr.audits;
  const num = (id) => (a[id] && typeof a[id].numericValue === 'number' ? a[id].numericValue : null);
  const failing = Object.values(a).filter((x) => typeof x.score === 'number' && x.score < 0.9 && x.scoreDisplayMode !== 'informative' && x.scoreDisplayMode !== 'manual')
    .map((x) => ({ id: x.id, score: x.score, value: x.displayValue || '', items: ((x.details && x.details.items) || []).slice(0, 6).map((i) => i.url || (i.node && (i.node.selector || i.node.snippet)) || i.label || i.source || '').map((s) => String(typeof s === 'object' ? JSON.stringify(s) : s).slice(0, 160)) }));
  return {
    scores: Object.fromEntries(CATS.map((c) => [c, lhr.categories[c] && lhr.categories[c].score !== null ? Math.round(lhr.categories[c].score * 100) : null])),
    lcp: Math.round(num('largest-contentful-paint') || 0), cls: Number((num('cumulative-layout-shift') || 0).toFixed(3)), tbt: Math.round(num('total-blocking-time') || 0),
    kb: Math.round((num('total-byte-weight') || 0) / 1024), failing
  };
}

// Recorded from the first paint in every page the browser opens: the largest paint, the layout shift and long tasks.
const OBSERVE = `window.__perf = { lcp: 0, cls: 0, long: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}`;

/**
 * Each page in Chrome's own measures, signed out for the public pages and signed in for the app's: LCP, CLS and the
 * blocking time from first paint, then how busy the page keeps the main thread once it has settled (5 s, profiled,
 * with the scripts that take the time), and axe-core in dark and in light.
 */
async function browserPass(axeSource, base, email, password) {
  const { browser, close } = await launch();
  const axe = {};
  const trace = {};
  try {
    const { sessionId: s } = await openPage(browser);
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVE }, s);
    await browser.send('Profiler.enable', {}, s);
    await browser.send('Performance.enable', {}, s);
    const busy = async () => (await browser.send('Performance.getMetrics', {}, s)).metrics.find((m) => m.name === 'TaskDuration').value;
    const visit = async (p, scheme) => {
      const t = Date.now();
      await goto(browser, s, base + p, APP.includes(p) ? "document.querySelector('#view .page-title h1, #view h1')" : 'true');
      const ready = Date.now() - t;
      await sleep(2500); // the entrance motion settles, so colours are read as they rest
      if (scheme === 'dark') {
        const b0 = await busy();
        await browser.send('Profiler.start', {}, s);
        await sleep(5000);
        const { profile } = await browser.send('Profiler.stop', {}, s);
        const idleBusy = Math.round(((await busy()) - b0) / 5 * 100);
        const dt = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length);
        const by = {};
        // A browser call (drawImage, a shader compile) counts for the page's own function that made it.
        const parent = {};
        for (const n of profile.nodes) for (const c of n.children || []) parent[c] = n;
        const own = (n) => { for (let x = n; x; x = parent[x.id]) if (x.callFrame.url) return x; return null; };
        for (const n of profile.nodes) {
          if (['(idle)', '(program)', '(root)', '(garbage collector)'].includes(n.callFrame.functionName)) continue;
          const o = own(n);
          const u = o ? `${o.callFrame.url.replace(base, '')}:${o.callFrame.lineNumber + 1} ${o.callFrame.functionName || '(anonymous)'}` : `(${n.callFrame.functionName})`;
          by[u] = (by[u] || 0) + (n.hitCount || 0) * dt;
        }
        const perf = await evalIn(browser, s, 'window.__perf');
        trace[p] = { ready, lcp: perf.lcp, cls: Number(perf.cls.toFixed(3)), tbt: Math.round(perf.long), idleBusy,
          idleBy: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([u, ms]) => `${u} ${Math.round(ms)} ms`) };
      }
      await evalIn(browser, s, `window.axe || (0, eval)(${JSON.stringify(axeSource)})`);
      return evalIn(browser, s, `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })
        .then((r) => r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, where: x.nodes.slice(0, 5).map((n) => n.target.join(' ') + (n.failureSummary ? ' :: ' + n.failureSummary.replace(/\\s+/g, ' ').slice(0, 200) : '')),
          // For a missing name, what hides the first one's words: its text and every ancestor hidden in any way.
          why: /-name$/.test(x.id) ? (() => { const e = document.querySelector(x.nodes[0].target[0]); const out = []; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n);
            if (c.visibility !== 'visible' || c.display === 'none' || c.opacity === '0' || n.inert || n.getAttribute('aria-hidden') || (c.contentVisibility && c.contentVisibility !== 'visible')) out.push(n.tagName + '.' + n.className + ' visibility=' + c.visibility + ' opacity=' + c.opacity + ' cv=' + c.contentVisibility + ' inert=' + n.inert + ' aria-hidden=' + n.getAttribute('aria-hidden')); }
            return (e ? JSON.stringify(e.textContent.slice(0, 40)) : 'gone') + ' ' + out.join(' | '); })() : undefined })))`);
    };
    const round = async (pages) => {
      for (const scheme of ['dark', 'light']) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, s);
        for (const p of pages) {
          try { axe[`${scheme} ${p}`] = await visit(p, scheme); } catch (err) { axe[`${scheme} ${p}`] = [{ id: 'could-not-run', impact: 'critical', help: err.message, nodes: 0, where: [] }]; }
        }
      }
    };
    await round(PUBLIC); // signed out: signed in, the sign-in pages move on to the app
    await goto(browser, s, `${base}/login`);
    const st = await evalIn(browser, s, `fetch('/api/v1/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ email, password, staySignedIn: true }))} }).then((r) => r.status)`);
    if (st !== 200) throw new Error(`the browser could not sign in: ${st}`);
    await round(APP);
  } finally { await close(); }
  return { axe, trace };
}

async function checkPerfA11y() {
  const tools = process.env.CI_TOOLS;
  if (!tools || !fs.existsSync(path.join(tools, 'node_modules', 'lighthouse'))) {
    result('perf-a11y: runs in its own CI job, where Lighthouse and axe-core are installed (CI_TOOLS)', true, 'not installed here, skipped');
    return;
  }
  const cli = path.join(tools, 'node_modules', 'lighthouse', 'cli', 'index.js');
  const axeSource = fs.readFileSync(path.join(tools, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
  const server = await startServer('perfa11y');
  const { base } = server;
  const dir = path.join(OUT, 'lighthouse');
  fs.mkdirSync(dir, { recursive: true });
  try {
    // One account, signed in through the API: the cookie goes to Lighthouse as a header, and the browser for axe
    // signs in the same way.
    const email = `perf-${Date.now()}@example.com`;
    const password = 'Perf-Check-Lamp-2026';
    const post = (p, body, cookie) => fetch(`${base}/api/v1${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const up = await post('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    const login = await post('/auth/login', { email, password, staySignedIn: true });
    const cookie = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get('set-cookie')]).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
    if (up.status !== 201 || login.status !== 200 || !cookie) throw new Error(`the test account could not sign in: ${up.status} ${login.status}`);
    const headersFile = path.join(dir, 'headers.json');
    fs.writeFileSync(headersFile, JSON.stringify({ Cookie: cookie }));

    /* ------------------------------------------- Chrome's own measures, and axe */

    const { axe, trace } = await browserPass(axeSource, base, email, password);
    fs.writeFileSync(path.join(OUT, 'perf-a11y-trace.json'), JSON.stringify(trace, null, 2));
    result('perf-a11y: Chrome measured every page (LCP, CLS, blocking time, main thread once settled)', true,
      Object.entries(trace).map(([p, t]) => `${p}: ready ${t.ready} ms, LCP ${t.lcp} ms, CLS ${t.cls}, TBT ${t.tbt} ms, settled busy ${t.idleBusy}% (${t.idleBy.join(', ')})`));
    fs.writeFileSync(path.join(OUT, 'perf-a11y-axe.json'), JSON.stringify(axe, null, 2));
    const found = Object.entries(axe).filter(([, v]) => v.length);
    result('perf-a11y: axe-core finds no accessibility fault on any page, in dark or light', !found.length,
      found.flatMap(([k, v]) => v.map((x) => `${k}: ${x.impact} ${x.id} x${x.nodes} (${x.help}) ${x.where.slice(0, 3).join(' | ')}${x.why ? ` WHY ${x.why}` : ''}`)));

    /* ------------------------------------------------------- Lighthouse */

    const rows = {};
    for (const form of ['mobile', 'desktop']) {
      for (const p of [...PUBLIC, ...APP].filter((x) => x !== '/no-such-page')) { // Lighthouse will not report on a 404; axe still reads it
        const file = path.join(dir, `${form}${p.replace(/\//g, '_') || '_'}.json`);
        // Lighthouse now and then loses the start of its trace (NO_NAVSTART: no performance score). Each page gets up to
        // three goes; the later ones keep the page in one renderer process, which is where the start went missing.
        let s = null;
        let tries = 0;
        for (const flags of [ONE_PROCESS, ONE_PROCESS, '']) {
          s = summarise(await lighthouse(cli, base + p, form, APP.includes(p) ? headersFile : null, file, flags));
          tries++;
          if (!s.error && s.scores.performance != null) break;
        }
        s.tries = tries;
        rows[`${form} ${p}`] = s;
        console.log(`      ${form} ${p}: ${s.error ? `ERROR ${s.error}` : `${CATS.map((c) => s.scores[c]).join('/')}  LCP ${s.lcp} ms  CLS ${s.cls}  TBT ${s.tbt} ms  ${s.kb} KB, ${tries} go(es)`}`);
      }
    }
    fs.writeFileSync(path.join(OUT, 'perf-a11y-lighthouse.json'), JSON.stringify(rows, null, 2));
    const errored = Object.entries(rows).filter(([, r]) => r.error || r.scores.performance == null);
    result('perf-a11y: Lighthouse measured every page at phone and desktop size', !errored.length, errored.map(([k, r]) => `${k}: ${r.error || 'no performance score (NO_NAVSTART)'}`));

    const budget = fs.existsSync(BUDGET) ? JSON.parse(fs.readFileSync(BUDGET, 'utf8')) : {};
    const under = [];
    for (const [k, r] of Object.entries(rows)) {
      if (r.error || !budget[k]) continue;
      for (const c of CATS) if (budget[k][c] != null && r.scores[c] != null && r.scores[c] < budget[k][c] - SLACK[c]) under.push(`${k} ${c} ${r.scores[c]}, floor ${budget[k][c]}`);
    }
    const unbudgeted = Object.keys(rows).filter((k) => !budget[k]);
    result('perf-a11y: no page scores much under its floor in perf-budget.json', !under.length && !unbudgeted.length,
      [...under, ...(unbudgeted.length ? [`no floor yet for: ${unbudgeted.join(', ')}`] : [])]);
  } finally { await server.stop(); }
}

module.exports = checkPerfA11y;
