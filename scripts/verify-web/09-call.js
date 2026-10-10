'use strict';
/**
 * call      Is this call a scam? (/app/call): real clicks on what the caller says answer at once, at desktop and
 *           phone width, and nothing ticked is sent.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, launch, evalIn, openPage, goto, shot } = require('./_shared');

/* ----------------------------------------------------- 8. is this call a scam? */

// /app/call in the real app on the real server, signed in as a throwaway account: real clicks on what the caller
// says give the answer at once, at desktop and phone width, and nothing ticked leaves the page.
async function checkCall() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-call-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'call-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo' }
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${base}/api/v1/auth/config`)).ok; } catch { /* still starting */ } }
  const { browser, close } = await launch();
  try {
    if (!up) throw new Error(`the Sentinel server did not start on ${base} (see call-server.log)`);
    const { sessionId: s } = await openPage(browser);
    const errors = [];
    const requests = [];
    browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
    browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
    browser.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, method: p.request.method, post: p.request.postData || '' }));
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Network.enable', {}, s);
    // A throwaway account, made and signed in from the page itself, so the browser holds a real session.
    await goto(browser, s, `${base}/login`);
    const signed = await evalIn(browser, s, `(async () => {
      const post = (p, body) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const email = 'call-' + Date.now() + '@example.com', password = 'Call-Check-2026!';
      const a = await post('/api/v1/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
      const b = await post('/api/v1/auth/login', { email, password });
      return a.ok && b.ok;
    })()`);
    if (!signed) throw new Error('the test account could not sign in');
    await goto(browser, s, `${base}/app/call`, "document.querySelector('[data-call-answer] .call__empty')").catch(async (err) => {
      const where = await evalIn(browser, s, "location.href + ' | ' + (document.body ? document.body.innerText.slice(0, 300) : '')").catch(() => '');
      throw new Error(`${err.message}: ${where} | ${errors.join(' | ')}`);
    });
    await sleep(1200);   // the page's entrance (app-lux.js) settles
    const answer = () => evalIn(browser, s, `(() => { const a = document.querySelector('[data-call-answer]');
      const t = (sel) => (a.querySelector(sel) || {}).textContent || '';
      const more = a.querySelector('.call__more a');
      return { verdict: a.dataset.verdict, big: t('.call__verdict'), reason: t('.call__reason'), next: t('.call__next'), empty: t('.call__empty'), recover: more ? more.getAttribute('href') : '',
        size: parseFloat(getComputedStyle(a.querySelector('.call__verdict') || a).fontSize) }; })()`);
    const click = async (name, value) => {
      const [x, y] = await evalIn(browser, s, `(() => { const l = document.querySelector('input[name="${name}"][value="${value}"]').closest('label'); l.scrollIntoView({ block: 'center' }); const r = l.getBoundingClientRect(); return [Math.round(r.left + 24), Math.round(r.top + r.height / 2)]; })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, s);
      await sleep(250);
    };

    const empty = await answer();
    result('call: the page opens with nothing ticked and asks what the caller says', !empty.verdict && /Tick what the caller says/.test(empty.empty), empty);
    const before = requests.length;
    await click('who', 'bank');
    const fine = await answer();
    await evalIn(browser, s, "document.querySelector('[data-call-answer]').scrollIntoView({ block: 'center' })");
    await shot(browser, s, 'call-fine');
    result('call: "your bank" with nothing asked is probably fine, with what to do if unsure', fine.verdict === 'fine' && fine.big === 'This is probably fine.' && /back of your card/.test(fine.next), fine);
    await click('ask', 'code');
    const hang = await answer();
    await evalIn(browser, s, "document.querySelector('[data-call-answer]').scrollIntoView({ block: 'center' })");
    await shot(browser, s, 'call-hangup');
    result('call: the bank asking for the code sent to your phone says hang up at once, in big words, with the one reason and the number on the card',
      hang.verdict === 'hangup' && hang.big === 'Hang up now.' && hang.size >= 36 && /Your bank never asks for a code/.test(hang.reason) && /back of your card/.test(hang.next) && hang.recover === '/app/recover?happened=code', hang);
    await click('ask', 'giftcards');
    const more = await answer();
    result('call: a second sign keeps the deciding reason and adds its part of the recovery guide', more.verdict === 'hangup' && /Your bank never asks for a code/.test(more.reason) && more.recover === '/app/recover?happened=code,giftcard', more);

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
    await sleep(500);
    const fits = await evalIn(browser, s, 'document.documentElement.scrollWidth <= innerWidth + 1');
    await evalIn(browser, s, "document.querySelector('[data-call-answer]').scrollIntoView({ block: 'center' })");
    await shot(browser, s, 'call-phone');
    result('call: at phone width the page fits with no sideways scroll', fits);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);

    await evalIn(browser, s, "document.querySelector('[data-call] button[type=reset]').click()");
    await sleep(300);
    const reset = await answer();
    result('call: Start over clears every tick and the answer', !reset.verdict && Boolean(reset.empty) && await evalIn(browser, s, "!document.querySelector('[data-call] input:checked')"), reset);

    const sent = requests.slice(before);
    const carried = sent.filter((r) => r.method !== 'GET' || /bank|code|giftcard|happened/i.test(r.url + r.post));
    result('call: nothing ticked is sent anywhere', !carried.length, [`requests while ticking: ${sent.map((r) => `${r.method} ${r.url.replace(base, '')}`).join(', ') || 'none'}`, ...carried.map((r) => `sent: ${r.method} ${r.url}`)]);
    result('call: no console errors', !errors.length, errors);
  } finally {
    await close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkCall;
