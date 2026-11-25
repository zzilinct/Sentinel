'use strict';
/**
 * dig-colour  The faint digits of a delicate scan (web/assets/js/binary.js), read as pixels: while a real delicate scan
 *             of the Check page waits, the digits on its canvas are drawn in the chosen colour and none in gold's hue
 *             (the verdict colours only arrive with a verdict). Until 1.21.5 only the --live token they are drawn from
 *             was checked, because a delicate scan is locked on the free plan. Here the plan is raised the way every
 *             check does it: the server these checks start runs BILLING_MODE=demo (_shared.js startServer), which the
 *             real server never does (config.js: production is 'disabled', and the route answers 501).
 *             A gold control proves the reading finds gold when it is there. Pictures: dig-<theme>-<accent>.png.
 */
const { result, launch, evalIn, goto, shot, startServer, watchErrors, until, openPage, clickSel, sleep } = require('./_shared');

const LOOKS = [['dark', 'gold'], ['dark', 'sapphire'], ['light', 'rose'], ['dark', 'teal']];
const SCAN = 'paypa1-secure-login.com';
// Holds each line of the scan's answer apart, so the wait lasts long enough to read the canvas.
const PACE = `(() => { const real = window.fetch; window.fetch = async (url, init) => {
  const res = await real(url, init);
  if (!/\\/api\\/v1\\/scan\\//.test(String(url))) return res;
  const reader = res.body.getReader(), text = new TextDecoder(), bytes = new TextEncoder();
  return new Response(new ReadableStream({ async pull(c) {
    const { value, done } = await reader.read();
    if (done) { c.close(); return; }
    for (const line of text.decode(value, { stream: true }).split(/(?<=\\n)/)) { await new Promise((r) => setTimeout(r, 900)); c.enqueue(bytes.encode(line)); }
  } }), { status: res.status, headers: res.headers });
}; })();`;

/* Runs in the page: the veil's pixels that are solid enough to carry their colour, how many are coloured, and how many of those are gold's hue. */
function reading() {
  const c = document.querySelector('.binary-veil');
  if (!c) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let coloured = 0, gold = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 30) continue;   // fainter than this, rounding to 8 bits has lost the colour
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
    if (dd < 0.12 * mx || mx < 0.25) continue;
    coloured++;
    const h = (mx === r ? ((g - b) / dd + 6) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4) * 60;
    if (h >= 25 && h <= 65) gold++;
  }
  return { coloured, gold, accent: document.documentElement.dataset.accent || 'gold' };
}

async function checkDig() {
  const server = await startServer('digcolour');
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, s);
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: PACE }, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await goto(browser, s, `${server.base}/login`);
    const email = `dig-${Date.now()}@example.com`, password = 'Dig-Colour-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });
    const plan = await api('/billing/plan', { plan: 'max' });
    result('dig-colour: the test server lets the plan be raised (delicate scans are open), as the real one never does', plan === 200, { plan });
    const out = [];
    for (const [theme, accent] of LOOKS) {
      await evalIn(browser, s, `(() => { localStorage.setItem('sentinel:theme', '${theme}'); ${accent === 'gold' ? "localStorage.removeItem('sentinel:accent');" : `localStorage.setItem('sentinel:accent', '${accent}');`} return true; })()`);
      await goto(browser, s, `${server.base}/app/check`, "document.querySelector('[data-form]')");
      await evalIn(browser, s, `(() => { const t = document.querySelector('[data-check-text]'); t.value = ${JSON.stringify(SCAN)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      if (!(await evalIn(browser, s, "document.querySelector('[data-deeper]').getAttribute('aria-pressed') === 'true'"))) await clickSel(browser, s, '[data-deeper]');
      await evalIn(browser, s, "(() => { const f = document.querySelector('[data-form]'); f.requestSubmit(); return true; })()");
      // The veil comes after its grace period; the digits it draws first are faint, and the band brightens them as stages finish.
      let best = null;
      for (let k = 0; k < 40; k++) {
        await sleep(250);
        const r = await evalIn(browser, s, `(${reading})()`);
        if (r && (!best || r.coloured > best.coloured)) best = r;
        if (best && best.coloured >= 200) break;
      }
      if (best) await shot(browser, s, `dig-${theme}-${accent}`);
      out.push({ theme, accent, ...best });
      await until(browser, s, "document.querySelector('[data-result]')", 60000).catch(() => {});
    }
    for (const o of out) {
      const ok = o.coloured >= 50 && (o.accent === 'gold' ? o.gold / o.coloured > 0.9 : o.gold / o.coloured < 0.05);
      result(`dig-colour: a delicate scan's digits are drawn in ${o.accent} (${o.theme}), ${o.accent === 'gold' ? 'gold' : 'none of them gold'}`, ok, o);
    }
    const noise = errors.filter((e) => !/favicon.ico/.test(e));
    result('dig-colour: no error on the page', noise.length === 0, noise.slice(0, 3));
  } finally { await close(); await server.stop(); }
}

module.exports = checkDig;
