'use strict';
/**
 * warn      Warn a friend after a scam was found (link, text, email scans in the app, the real server behind it) draws
 *           a picture card on the device, mask included, whose words hold no clickable address, and sends nothing.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, launch, evalIn, openPage, goto, shot } = require('./_shared');

/* ------------------------------------------------------- 5. warn a friend */

// After a scan that found a scam, Warn a friend draws a picture card on the device (warncard.js): its pixels are
// there, the mask is in it, its words hold no address an app could make tappable, and pressing it sends nothing.
async function checkWarn() {
  const WarnCard = require('../../web/assets/js/warncard.js');
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const base = `http://localhost:${port}`;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-warn-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'warn-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DB_PATH: path.join(data, 'sentinel.db'), FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo', SESSION_SECRET: 'verify-web-warn-secret-0000000000000000000' }
  });
  const post = (p, body, cookie) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  let cookie = null;
  const email = `warn-${Date.now()}@example.com`;
  const password = 'Verify-Warn-2026!';
  for (let i = 0; i < 120 && !cookie; i++) {
    await sleep(500);
    try {
      if ((await post('/api/v1/auth/signup', { email, password, firstName: 'Alex', ageConfirmed: true, termsAccepted: true })).ok || i > 0) {
        const s = await post('/api/v1/auth/login', { email, password });
        if (s.ok) cookie = s.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('sentinel_session='));
      }
    } catch { /* still starting */ }
  }
  const { browser, close } = await launch();
  try {
    if (!cookie) throw new Error(`the Sentinel server did not start on ${base} (see warn-server.log)`);
    await post('/api/v1/billing/plan', { plan: 'max' }, cookie);   // the email scan is on the paid plans (demo billing)
    const { sessionId: s } = await openPage(browser);
    const requests = [];
    const errors = [];
    browser.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, method: p.request.method, body: p.request.postData || '' }));
    browser.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text));
    await browser.send('Network.enable', {}, s);
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Network.setCookie', { name: 'sentinel_session', value: cookie.slice('sentinel_session='.length), url: base, httpOnly: true }, s);

    const SCAM_LINK = 'https://paypa1-secure-login.com/account/verify?email=alex@example.com';
    const cases = [
      { name: 'link', url: `/app/scan?url=${encodeURIComponent(SCAM_LINK)}`, host: 'paypa1-secure-login', ready: "document.querySelector('#view [data-form]')" },
      { name: 'text', url: '/app/text', host: 'usps-redeliver', ready: "document.querySelector('#view [data-form] textarea')",
        fill: "const f = document.querySelector('[data-form]'); f.from.value = '+1 415 555 0199'; f.text.value = 'USPS: Your package is on hold due to an unpaid redelivery fee of $1.99. Pay at https://usps-redeliver.top/pay'; f.requestSubmit();" },
      { name: 'email', url: '/app/email', host: 'paypa1-secure-login', ready: "document.querySelector('#view form[data-form] [name=body]')",
        fill: `const f = document.querySelector('form[data-form]'); f.from.value = 'PayPal Service <service@paypa1-help.top>'; f.subject.value = 'Your account is limited'; f.body.value = 'We noticed unusual activity. Verify your account within 24 hours at ${SCAM_LINK} or it will be closed.'; f.requestSubmit();` }
    ];
    for (const c of cases) {
      await goto(browser, s, `${base}${c.url}`, c.ready);
      if (c.fill) await evalIn(browser, s, `(() => { ${c.fill} })()`);
      let ready = false;
      for (let i = 0; i < 120 && !ready; i++) { await sleep(250); ready = await evalIn(browser, s, "Boolean(document.querySelector('[data-warn]'))"); }
      if (!ready) {
        const seen = await evalIn(browser, s, "(document.querySelector('#view') || document.body).innerText.slice(0, 400)");
        result(`warn: a scam found by the ${c.name} scan offers Warn a friend`, false, seen);
        continue;
      }
      const before = requests.length;
      await evalIn(browser, s, "document.querySelector('[data-warn]').click()");
      let card = null;
      for (let i = 0; i < 40 && !card; i++) {
        await sleep(250);
        card = await evalIn(browser, s, `(() => {
          const c = document.querySelector('[data-warn-card] canvas');
          if (!c || !c.width) return null;
          const g = c.getContext('2d');
          const share = (x, y, w, h, test) => { const d = g.getImageData(x, y, w, h).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (test(d[i], d[i + 1], d[i + 2])) n++; return n / (d.length / 4); };
          const ink = (r, gr, b) => Math.abs(r - 16) + Math.abs(gr - 18) + Math.abs(b - 22) > 30;
          const colour = (r, gr, b) => Math.max(r, gr, b) - Math.min(r, gr, b) > 90;
          return { w: c.width, h: c.height, ink: share(0, 0, c.width, c.height, ink), mask: share(68, 80, 176, 176, colour), white: share(80, 280, 920, 90, (r, gr, b) => r > 230 && gr > 230 && b > 230),
            png: c.toDataURL('image/png'), label: c.getAttribute('aria-label'), panel: document.querySelector('[data-warn-card]').innerText,
            links: [...document.querySelectorAll('[data-warn-card] a[href]')].map((a) => a.getAttribute('href').slice(0, 22)),
            expanded: document.querySelector('[data-warn]').getAttribute('aria-expanded'), buttons: [...document.querySelectorAll('[data-warn-card] .btn')].map((b) => b.textContent.trim()) };
        })()`);
      }
      await sleep(700);   // the card settles in (app-lux.css) before the picture of the page
      await shot(browser, s, `warn-${c.name}-page`);
      if (!card) { result(`warn: the ${c.name} scan's Warn a friend draws a picture`, false, 'no canvas appeared'); continue; }
      fs.writeFileSync(path.join(OUT, `warn-${c.name}-card.png`), Buffer.from(card.png.split(',')[1], 'base64'));
      // The app's own reads (GET) may tick on in the background; nothing may be sent up.
      const sent = requests.slice(before).filter((r) => !r.url.startsWith('data:') && (r.method !== 'GET' || r.body)).map((r) => `${r.method} ${r.url}`);
      result(`warn: the ${c.name} scan's Warn a friend draws a real picture on the device, with the mask in it`,
        card.w === 1080 && card.h >= 1080 && card.ink > 0.04 && card.mask > 0.15 && card.white > 0.02 && card.expanded === 'true' && card.links.every((l) => l.startsWith('data:image/png')),
        { size: `${card.w}x${card.h}`, ink: card.ink.toFixed(3), mask: card.mask.toFixed(3), title: card.white.toFixed(3), buttons: card.buttons, links: card.links });
      const words = `${card.label}\n${card.panel}`;
      result(`warn: the ${c.name} card's words hold no clickable address, only the defanged one`,
        !WarnCard.linkable(words) && words.includes(`${c.host}[.]`) && !/alex@example|email=/.test(words), card.label);
      result(`warn: making the ${c.name} card sends nothing`, !sent.length, sent.length ? sent : 'no requests');
    }
    result('warn: no script errors in the app', !errors.length, errors);
  } finally {
    await close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkWarn;
