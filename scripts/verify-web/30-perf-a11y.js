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
const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];
const BUDGET = path.join(__dirname, 'perf-budget.json');
// How far under its floor a score may fall before the check fails: performance moves a few points run to run on a
// shared runner, the others hardly at all.
const SLACK = { performance: 8, accessibility: 2, 'best-practices': 5, seo: 2 };

function lighthouse(cli, url, form, headersFile, jsonOut) {
  const args = [cli, url, '--quiet', '--output=json', `--output-path=${jsonOut}`, `--only-categories=${CATS.join(',')}`,
    '--chrome-flags=--headless=new --no-first-run --no-default-browser-check', '--disable-full-page-screenshot', '--max-wait-for-load=45000'];
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

async function axeAll(axeSource, base, signIn) {
  const { browser, close } = await launch();
  const out = {};
  try {
    const { sessionId: s } = await openPage(browser);
    await goto(browser, s, `${base}/login`);
    await signIn((p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`));
    // The app's pages last: signed in, the public sign-in pages may move on to the app.
    for (const scheme of ['dark', 'light']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, s);
      for (const p of [...PUBLIC, ...APP]) {
        try {
          await goto(browser, s, base + p, APP.includes(p) ? "document.querySelector('#view .page-title h1, #view h1')" : 'true');
          await sleep(2500); // the entrance motion settles, so colours are read as they rest
          await evalIn(browser, s, `window.axe || (0, eval)(${JSON.stringify(axeSource)})`);
          const v = await evalIn(browser, s, `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })
            .then((r) => r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, where: x.nodes.slice(0, 5).map((n) => n.target.join(' ') + (n.failureSummary ? ' :: ' + n.failureSummary.replace(/\\s+/g, ' ').slice(0, 200) : '')) })))`);
          out[`${scheme} ${p}`] = v;
        } catch (err) { out[`${scheme} ${p}`] = [{ id: 'could-not-run', impact: 'critical', help: err.message, nodes: 0, where: [] }]; }
      }
    }
  } finally { await close(); }
  return out;
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

    /* ------------------------------------------------------- Lighthouse */

    const rows = {};
    for (const form of ['mobile', 'desktop']) {
      for (const p of [...PUBLIC, ...APP]) {
        const file = path.join(dir, `${form}${p.replace(/\//g, '_') || '_'}.json`);
        let s = summarise(await lighthouse(cli, base + p, form, APP.includes(p) ? headersFile : null, file));
        if (s.error) s = summarise(await lighthouse(cli, base + p, form, APP.includes(p) ? headersFile : null, file)); // one more go on a stalled runner
        rows[`${form} ${p}`] = s;
        console.log(`      ${form} ${p}: ${s.error ? `ERROR ${s.error}` : `${CATS.map((c) => s.scores[c]).join('/')}  LCP ${s.lcp} ms  CLS ${s.cls}  TBT ${s.tbt} ms  ${s.kb} KB`}`);
      }
    }
    fs.writeFileSync(path.join(OUT, 'perf-a11y-lighthouse.json'), JSON.stringify(rows, null, 2));
    const errored = Object.entries(rows).filter(([, r]) => r.error);
    result('perf-a11y: Lighthouse measured every page at phone and desktop size', !errored.length, errored.map(([k, r]) => `${k}: ${r.error}`));

    const budget = fs.existsSync(BUDGET) ? JSON.parse(fs.readFileSync(BUDGET, 'utf8')) : {};
    const under = [];
    for (const [k, r] of Object.entries(rows)) {
      if (r.error || !budget[k]) continue;
      for (const c of CATS) if (budget[k][c] != null && r.scores[c] != null && r.scores[c] < budget[k][c] - SLACK[c]) under.push(`${k} ${c} ${r.scores[c]}, floor ${budget[k][c]}`);
    }
    const unbudgeted = Object.keys(rows).filter((k) => !budget[k]);
    result('perf-a11y: no page scores much under its floor in perf-budget.json', !under.length && !unbudgeted.length,
      [...under, ...(unbudgeted.length ? [`no floor yet for: ${unbudgeted.join(', ')}`] : [])]);

    /* ------------------------------------------------------------ axe */

    const axe = await axeAll(axeSource, base, async (call) => { await call('/auth/login', { email, password, staySignedIn: true }); });
    fs.writeFileSync(path.join(OUT, 'perf-a11y-axe.json'), JSON.stringify(axe, null, 2));
    const found = Object.entries(axe).filter(([, v]) => v.length);
    result('perf-a11y: axe-core finds no accessibility fault on any page, in dark or light', !found.length,
      found.flatMap(([k, v]) => v.map((x) => `${k}: ${x.impact} ${x.id} x${x.nodes} (${x.help}) ${x.where.slice(0, 3).join(' | ')}`)));
  } finally { await server.stop(); }
}

module.exports = checkPerfA11y;
