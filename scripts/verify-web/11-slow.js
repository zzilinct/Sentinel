'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, launch, evalIn, openPage, goto, shot } = require('./_shared');

/* --------------------------------------- 8. a whole conversation, a slow scam (/app/text) */

const SLOW_CHAT = [
  '[10/6/26, 09:12] +1 917 555 0101: Hi, is this Linda?',
  '[10/6/26, 09:40] Me: No, sorry, wrong number',
  '[10/6/26, 09:41] +1 917 555 0101: Oh I am so sorry! You seem kind though. I am Amy, I live in Singapore.',
  '[10/7/26, 10:02] +1 917 555 0101: I rarely use this app, add me on WhatsApp so we can keep talking',
  '[10/9/26, 20:15] +1 917 555 0101: My uncle is a financial analyst, he taught me crypto trading. I made $4,000 profit last week on a trading platform.',
  '[10/9/26, 20:16] +1 917 555 0101: I can teach you how to invest, start small'
].join('\n');

async function checkSlow() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-slow-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'slow-server.log'), 'w');
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
    if (!up) throw new Error(`the Sentinel server did not start on ${base} (see slow-server.log)`);
    const { sessionId: s } = await openPage(browser);
    const errors = [];
    const requests = [];
    browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
    browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
    browser.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, method: p.request.method, post: p.request.postData || '' }));
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Network.enable', {}, s);
    await goto(browser, s, `${base}/login`);
    const signed = await evalIn(browser, s, `(async () => {
      const post = (p, body) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const email = 'slow-' + Date.now() + '@example.com', password = 'Slow-Scam-2026!';
      const a = await post('/api/v1/auth/signup', { email, password, firstName: 'Pat', ageConfirmed: true, termsAccepted: true });
      const b = await post('/api/v1/auth/login', { email, password });
      return a.ok && b.ok;
    })()`);
    if (!signed) throw new Error('the test account could not sign in');
    await goto(browser, s, `${base}/app/text`, "document.querySelector('#view [data-form] textarea')");
    await sleep(1000);   // the page's entrance (app-lux.js) settles

    const scan = async (text) => {
      // The last scan's result goes first: read too soon, it was taken for this one's (an ordinary chat "flagged").
      await evalIn(browser, s, `(() => { document.querySelectorAll('#view [data-result]').forEach((r) => r.remove()); const f = document.querySelector('[data-form]'); f.from.value = ''; f.text.value = ${JSON.stringify(text)}; f.requestSubmit(); })()`);
      let r = null;
      for (let i = 0; i < 80 && !r; i++) {
        await sleep(250);
        r = await evalIn(browser, s, `(() => { const res = document.querySelector('#view [data-result]'); if (!res) return null;
          const slow = res.querySelector('[data-slow]');
          return { title: res.querySelector('h2').textContent, tone: res.dataset.textResult, at: slow ? slow.dataset.slow : null,
            steps: slow ? [...slow.querySelectorAll('.slow__step')].map((li) => ({ label: li.textContent.replace(/\\s+/g, ' ').trim(), seen: li.classList.contains('is-seen'), current: li.getAttribute('aria-current') })) : [],
            next: slow ? slow.querySelector('.slow__next').textContent : '', recover: (res.querySelector('.next-steps__more a') || {}).href || '' }; })()`);
      }
      return r;
    };

    const before = requests.length;
    const slow = await scan(SLOW_CHAT);
    await sleep(800);   // the steps settle in
    await evalIn(browser, s, "document.querySelector('[data-slow]') && document.querySelector('[data-slow]').scrollIntoView({ block: 'center' })");
    await shot(browser, s, 'slow-desktop');
    const seen = slow ? slow.steps.filter((x) => x.seen).map((x) => x.label.replace(/ \(seen.*$/, '')) : [];
    result('slow: a pasted conversation shows which steps of a slow scam it has, where it is now, and what usually comes next',
      Boolean(slow) && slow.title === 'This conversation follows a slow scam' && slow.at === 'invest' && slow.steps.length === 5
        && seen.join('|') === 'A wrong number|A move to another app|An investment' && slow.steps[3].current === 'step' && /fee or a tax/.test(slow.next) && /happened=bank/.test(slow.recover), slow);
    const lit = await evalIn(browser, s, `(() => { const dots = [...document.querySelectorAll('.slow__dot')].map((d) => getComputedStyle(d).backgroundColor); return { dots, words: document.querySelector('[data-slow]').innerText }; })()`);
    result('slow: the steps seen are lit and the rest are not, in calm words with no em dashes', new Set(lit.dots).size >= 2 && lit.dots[0] === lit.dots[1] && lit.dots[0] !== lit.dots[2] && !/—/.test(lit.words), lit.dots);

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
    await sleep(500);
    const fits = await evalIn(browser, s, 'document.documentElement.scrollWidth <= innerWidth + 1');
    const stacked = await evalIn(browser, s, "(() => { const li = [...document.querySelectorAll('.slow__step')].map((x) => x.getBoundingClientRect()); return li.every((r, i) => !i || r.top > li[i - 1].top); })()");
    await evalIn(browser, s, "document.querySelector('[data-slow]').scrollIntoView({ block: 'center' })");
    await shot(browser, s, 'slow-phone');
    result('slow: at phone width the steps stack top to bottom and the page fits with no sideways scroll', fits && stacked, { fits, stacked });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);

    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    const still = await evalIn(browser, s, "getComputedStyle(document.querySelector('.slow__step')).animationName");
    result('slow: with reduced motion the steps do not slide in', still === 'none', still);
    await browser.send('Emulation.setEmulatedMedia', { features: [] }, s);

    const ordinary = await scan('Mia: did you see bitcoin today lol\nMe: yeah crazy\nMia: anyway dinner at 7?');
    result('slow: an ordinary chat that mentions crypto once is left alone', Boolean(ordinary) && !ordinary.at && ordinary.tone === 'clear', ordinary);

    const sent = requests.slice(before).filter((r) => r.method !== 'GET' || r.post);
    const carried = sent.filter((r) => /Linda|WhatsApp|bitcoin/i.test(decodeURIComponent(r.url) + r.post) && r.url !== `${base}/api/v1/scan/text`);
    result('slow: the conversation goes only to Sentinel\'s own text scan, and nowhere else', !carried.length, sent.map((r) => `${r.method} ${r.url.replace(base, '')}`));
    result('slow: no console errors', !errors.length, errors);
  } finally {
    await close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkSlow;
