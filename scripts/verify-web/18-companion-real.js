'use strict';
/**
 * companion-real  The companion against real public sites, in a real headless Chrome with the real server behind it.
 *   1. Honest real sites (gift card pages, exchanges, a wallet's download page, sign-in pages, a bank, carts, articles
 *      about gift card scams) get no block, no "Go to the real", no "Did you type anything?" and no pay pause while
 *      nothing scam-like happened. The time the companion adds to each page load is measured against a Chrome without
 *      it, on the real sites and on a local page (no network noise).
 *   2. After a warning: articles, sign-in pages, carts and exchanges' front pages still get nothing. A real gift card
 *      page gets the pause (that is the feature). A page that keeps changing is measured while the pause's reader runs.
 *   3. The scam side with local stand-ins (a fake PayPal sign-in, a fake gift card checkout, a fake exchange's withdraw
 *      screen reached by pushState, a card box in a payment frame) still works, and again right after the browser stops
 *      the companion's worker, as Chrome does after about 30 seconds idle.
 * Runners may visit real public sites; the scam pages are local and harmless.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot, TYPED_PW, passBlock } = require('./_shared');

const SAYS = 'No real company, government office or bank asks to be paid in gift cards or crypto.';
const ALARMS = [SAYS, 'A moment before you pay', 'Did you type', 'Take me back to safety', 'Go to the real', 'Before you pay'];
const CARD_HOSTS = ['netflix-billing-update.top', 'amazon-refund-center.icu'];   // listed scams (server/lib/scan/lists.js)

// [kind, url]. 'gift' pages are the only ones the pause is meant for, and only after a warning.
const REAL = [
  ['article', 'https://consumer.ftc.gov/articles/avoiding-and-reporting-gift-card-scams'],
  ['article', 'https://www.aarp.org/money/scams-fraud/info-2019/gift-card.html'],
  ['help', 'https://help.coinbase.com/en/coinbase/trading-and-funding/sending-or-receiving-cryptocurrency/send-crypto'],
  ['signin', 'https://accounts.google.com/'],
  ['signin', 'https://login.live.com/'],
  ['signin', 'https://www.paypal.com/signin'],
  ['bank', 'https://www.chase.com/'],
  ['cart', 'https://www.target.com/cart'],
  ['cart', 'https://www.etsy.com/cart'],
  ['exchange', 'https://www.coinbase.com/'],
  ['exchange', 'https://www.kraken.com/'],
  ['exchange', 'https://www.binance.com/en'],
  ['wallet', 'https://metamask.io/download/'],
  ['gift', 'https://www.amazon.com/gift-cards/b?node=2238192011'],
  ['gift', 'https://www.target.com/c/gift-cards/-/N-5xsxu'],
  ['gift', 'https://www.apple.com/shop/gift-cards']
];
const median = (xs) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const ms = (x) => (Number.isFinite(x) ? Math.round(x) : null);

async function checkCompanionReal() {
  const net = require('net');
  const freePort = () => new Promise((resolve) => { const sv = net.createServer().listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-real-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'companion-real-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), SENTINEL_DEVICE_ACCOUNTS: '1', FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0' }
  });
  const api = `http://127.0.0.1:${port}`;
  let token = null;
  for (let i = 0; i < 120 && !token; i++) {
    await sleep(500);
    try {
      const r = await fetch(`${api}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: api }, body: '{}' });
      if (r.ok) token = (await r.json()).token;
    } catch { /* still starting */ }
  }

  // A proxy in front of the server that writes down what the scanner said about each page the companion asked about.
  const said = [];
  const proxy = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const up = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
        const back = [];
        r.on('data', (c) => back.push(c));
        r.on('end', () => {
          const buf = Buffer.concat(back);
          if (req.url.startsWith('/api/v1/live/visit')) {
            try {
              const j = JSON.parse(buf.toString('utf8'));
              const v = j.verdict || {};
              said.push({ host: v.host, badge: (v.overall && v.overall.badge) || null, paypage: j.paypage || null, pay: Boolean(j.pay), realSite: (v.realSite && v.realSite.host) || null, reasons: (v.reasons || []).map((x) => x.text).slice(0, 3) });
            } catch { /* not JSON */ }
          }
          res.writeHead(r.statusCode, r.headers);
          res.end(buf);
        });
      });
      up.on('error', () => { res.writeHead(502); res.end(); });
      up.end(body);
    });
  });
  const proxyPort = await freePort();
  await new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve));
  const via = `http://127.0.0.1:${proxyPort}`;

  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font:16px/1.6 system-ui,sans-serif;margin:40px;background:#fff;color:#111">${body}</body></html>`;
  const withdraw = '<div role="dialog" aria-label="Withdraw" style="border:1px solid #888;padding:20px;max-width:380px"><h2>Withdraw</h2>'
    + '<p><label>Coin <select><option>USDT</option></select></label></p><p><label>Address <input></label></p><p><label>Network <input></label></p><button>Withdraw</button></div>';
  // A local page with plenty in it, for timing without the network: 3000 elements and a frame.
  const heavy = page('Heavy', `<h1>Catalogue</h1>${Array.from({ length: 600 }, (_, i) => `<div class="row"><h3>Item ${i}</h3><p>Plain text ${i}</p><button>Add</button><label>Qty <input></label></div>`).join('')}<iframe src="/recipes.html" title="r"></iframe>`);
  // A page that keeps changing, like a live ticker or chat in a web app: 20 changes a second.
  const ticker = page('Markets', `<h1>Markets</h1><ul id="l">${Array.from({ length: 300 }, (_, i) => `<li><button>Coin ${i}</button> <span>${i}.00</span></li>`).join('')}</ul><script>
    let n = 0; setInterval(() => { const s = document.querySelectorAll('#l span'); for (let i = 0; i < 30; i++) s[(n * 30 + i) % s.length].textContent = (Math.random() * 100).toFixed(2); n++; }, 50);
  </script>`);
  const files = await serveFiles({}, {
    '/signin.html': page('Sign in', '<h1>Sign in to your account</h1><form onsubmit="return false"><p><label>Email <input></label></p><p><label>Password <input type="password"></label></p></form>'),
    '/account.html': page('Account', '<h1>Your account</h1><p>Confirm your details.</p>'),
    '/gift-cards/checkout': page('Checkout', '<h1>Gift cards</h1><p>Store gift card, 500.00</p><form onsubmit="return false"><label>Gift card amount <select><option>500</option></select></label> <button>Buy now</button></form>'),
    '/exchange/home': page('Exchange', `<main id="screen"><h1>Your assets</h1><p>USDT 1200.00</p></main><script>
      window.goWithdraw = () => { history.pushState({}, '', '/exchange/withdraw'); document.getElementById('screen').innerHTML = ${JSON.stringify(withdraw)}; };
    </script>`),
    '/checkout.html': page('Checkout', '<h1>Complete your order</h1><p>Total 14.99</p><iframe src="http://payframe.test/card.html" title="Secure payment" style="border:1px solid #ccc;width:420px;height:180px"></iframe>'),
    '/card.html': page('Card', '<form onsubmit="return false"><p><label>Card number <input name="cardnumber" autocomplete="cc-number" inputmode="numeric"></label></p><p><label>Expiry <input autocomplete="cc-exp"></label></p></form>'),
    '/recipes.html': page('Recipes', '<h1>Banana bread</h1><p>Three ripe bananas, flour, sugar, an egg and butter.</p>'),
    '/heavy.html': heavy,
    '/ticker.html': ticker
  });
  const filesPort = new URL(files.base).port;
  const locals = [TYPED_PW, ...CARD_HOSTS, 'giftshop.test', 'giftshop2.test', 'exchange.test', 'exchange2.test', 'payframe.test', 'plain.test', 'plain2.test'];
  const rules = `--host-resolver-rules=${locals.map((h) => `MAP ${h} 127.0.0.1:${filesPort}`).join(',')},MAP paypal.com 127.0.0.1:9`;
  const withIt = await launch([rules]);
  const without = await launch([rules]);
  const { browser } = withIt;
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see companion-real-server.log)`);
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const paired = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(via)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return Boolean(r && r.account && r.account.signedIn);
    })()`);
    if (!paired) throw new Error('the companion could not sign in to the test server');
    const kept = () => evalIn(browser, opt.sessionId, 'chrome.storage.session.get(null)');
    const waitText = async (b, s, re, tries = 40) => {
      let text = '';
      for (let i = 0; i < tries && !re.test(text); i++) { await sleep(250); text = await pageText(b, s); }
      return text;
    };
    const saysRe = new RegExp(SAYS.replace(/\./g, '\\.'));
    const alarmsIn = (text) => ALARMS.filter((a) => text.includes(a));

    /** One visit in a fresh tab: how long the page took, what the companion drew. A real site may never finish loading. */
    async function visit(b, url, { settle = 3000, name = null } = {}) {
      const t = await openPage(b);
      await b.send('Performance.enable', {}, t.sessionId).catch(() => {});
      await b.send('Page.navigate', { url }, t.sessionId).catch(() => {});
      let done = false;
      for (let i = 0; i < 120 && !done; i++) {
        await sleep(250);
        done = await evalIn(b, t.sessionId, "location.href !== 'about:blank' && document.readyState === 'complete'").catch(() => false);
      }
      await sleep(settle);
      const timing = await evalIn(b, t.sessionId, `(() => { const n = performance.getEntriesByType('navigation')[0];
        return n ? { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, title: document.title.slice(0, 80) } : null; })()`).catch(() => null);
      const metrics = await b.send('Performance.getMetrics', {}, t.sessionId).catch(() => ({ metrics: [] }));
      const script = ((metrics.metrics || []).find((m) => m.name === 'ScriptDuration') || {}).value;
      const text = await pageText(b, t.sessionId).catch(() => '');
      if (name) await shot(b, t.sessionId, name);
      await b.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
      return { done, timing, script: Number.isFinite(script) ? script * 1000 : null, alarms: alarmsIn(text) };
    }

    /* 1. Honest real sites, nothing scam-like has happened: nothing at all, and the added time. */
    const rows = [];
    for (const [kind, url] of REAL) {
      const row = { kind, url, runs: [] };
      for (let round = 0; round < 2; round++) {
        const plain = await visit(without.browser, url, { settle: 1000 });
        const comp = await visit(browser, url, { name: round === 0 ? `companion-real-clean-${new URL(url).hostname.replace(/^www\./, '')}-${kind}` : null });
        row.runs.push({ plain, comp });
      }
      row.alarms = [...new Set(row.runs.flatMap((r) => r.comp.alarms))];
      row.loadDelta = median(row.runs.map((r) => (r.comp.timing && r.plain.timing ? r.comp.timing.load - r.plain.timing.load : NaN)));
      row.dclDelta = median(row.runs.map((r) => (r.comp.timing && r.plain.timing ? r.comp.timing.dcl - r.plain.timing.dcl : NaN)));
      row.scriptDelta = median(row.runs.map((r) => (Number.isFinite(r.comp.script) && Number.isFinite(r.plain.script) ? r.comp.script - r.plain.script : NaN)));
      rows.push(row);
    }
    const store1 = await kept();
    const flaggedReal = said.filter((v) => v.badge === 'red' || v.badge === 'orange');
    result('companion-real: honest real sites with nothing scam-like before them get no block, no real-site button, no question and no pause',
      rows.every((r) => !r.alarms.length) && !flaggedReal.length && !store1.paySign && !Object.keys(store1).some((k) => /^(paused|typed):/.test(k)),
      rows.map((r) => ({ url: r.url, title: r.runs[0].comp.timing && r.runs[0].comp.timing.title, alarms: r.alarms })).concat([{ scanner: said.map((v) => `${v.host} ${v.badge || 'clean'}${v.paypage ? ` paypage=${v.paypage}` : ''}${v.realSite ? ` real=${v.realSite}` : ''}`) }]));
    const loads = rows.map((r) => r.loadDelta);
    const dcls = rows.map((r) => r.dclDelta);
    const scripts = rows.map((r) => r.scriptDelta);
    const timingTable = rows.map((r) => ({ url: r.url, plainLoad: r.runs.map((x) => x.plain.timing && ms(x.plain.timing.load)), companionLoad: r.runs.map((x) => x.comp.timing && ms(x.comp.timing.load)), loadDelta: ms(r.loadDelta), dclDelta: ms(r.dclDelta), scriptDelta: ms(r.scriptDelta) }));
    fs.writeFileSync(path.join(OUT, 'companion-real-timing.json'), JSON.stringify({ rows: timingTable }, null, 2));
    result(`companion-real: real sites, the companion's added time (median over sites): load ${ms(median(loads))} ms, DOMContentLoaded ${ms(median(dcls))} ms, script ${ms(median(scripts))} ms (network noise included, see companion-real-timing.json)`,
      true, timingTable);

    // The same on a local page, no network: 7 loads each, alternating.
    const local = { plain: [], comp: [] };
    for (let i = 0; i < 7; i++) {
      local.plain.push(await visit(without.browser, `http://plain${i % 2 ? '2' : ''}.test/heavy.html?${i}`, { settle: 300 }));
      local.comp.push(await visit(browser, `http://plain${i % 2 ? '2' : ''}.test/heavy.html?${i}`, { settle: 300 }));
    }
    const lm = (side, f) => median(local[side].map((x) => f(x)));
    const added = {
      dcl: ms(lm('comp', (x) => x.timing && x.timing.dcl) - lm('plain', (x) => x.timing && x.timing.dcl)),
      load: ms(lm('comp', (x) => x.timing && x.timing.load) - lm('plain', (x) => x.timing && x.timing.load)),
      script: ms(lm('comp', (x) => x.script) - lm('plain', (x) => x.script)),
      plainLoad: ms(lm('plain', (x) => x.timing && x.timing.load)), companionLoad: ms(lm('comp', (x) => x.timing && x.timing.load))
    };
    result(`companion-real: a local page with 3000 elements and a frame (no network), the companion adds ${added.load} ms to its load (under 150 ms)`, added.load !== null && added.load < 150, added);

    /* 2. After a warning. */
    const sign = await openPage(browser);
    await goto(browser, sign.sessionId, `http://${TYPED_PW}/account.html`);
    let warned = false;
    for (let i = 0; i < 80 && !warned; i++) { await sleep(250); warned = Boolean((await kept()).paySign); }
    await browser.send('Target.closeTarget', { targetId: sign.targetId }).catch(() => {});
    result(`companion-real: ${TYPED_PW} is flagged, and the companion notes when (the hour of the pay pause starts)`, warned);

    const after = [];
    for (const [kind, url] of REAL) {
      const v = await visit(browser, url, { settle: 5000, name: `companion-real-after-${new URL(url).hostname.replace(/^www\./, '')}-${kind}` });
      after.push({ kind, url, alarms: v.alarms });
    }
    const wrong = after.filter((r) => (r.kind === 'gift' ? r.alarms.some((a) => a !== SAYS && a !== 'A moment before you pay') : r.alarms.length));
    result('companion-real: after a warning, articles, help, sign-in pages, a bank, carts, exchanges and a wallet download page still get nothing',
      !wrong.length, after.map((r) => `${r.kind} ${r.url}: ${r.alarms.join(' | ') || 'nothing'}`));
    const gifts = after.filter((r) => r.kind === 'gift');
    result('companion-real: after a warning, real gift card pages get the pause (the feature), and only the pause',
      gifts.filter((r) => r.alarms.includes(SAYS)).length >= 2, gifts.map((r) => `${r.url}: ${r.alarms.join(' | ') || 'nothing'}`));

    // A page that keeps changing, while the pause's reader watches it (it runs on every page in that hour).
    const tick = async (b) => {
      const t = await openPage(b);
      await b.send('Performance.enable', {}, t.sessionId);
      await goto(b, t.sessionId, 'http://plain.test/ticker.html');
      await sleep(1000);
      const m0 = (await b.send('Performance.getMetrics', {}, t.sessionId)).metrics;
      await sleep(10000);
      const m1 = (await b.send('Performance.getMetrics', {}, t.sessionId)).metrics;
      const get = (m, n) => (m.find((x) => x.name === n) || {}).value || 0;
      await b.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
      return { script: ms((get(m1, 'ScriptDuration') - get(m0, 'ScriptDuration')) * 1000), layout: ms((get(m1, 'LayoutDuration') - get(m0, 'LayoutDuration')) * 1000), task: ms((get(m1, 'TaskDuration') - get(m0, 'TaskDuration')) * 1000) };
    };
    const tickPlain = await tick(without.browser);
    const tickComp = await tick(browser);
    const busy = tickComp.task - tickPlain.task;
    result(`companion-real: a page changing 20 times a second, after a warning, costs ${busy} ms more work over 10 s with the companion (under 500 ms)`, busy < 500, { without: tickPlain, with: tickComp });

    /* 3. The scam side, then again right after the worker is stopped. */
    const swTarget = async () => (await browser.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${loaded.id}/`)) || null;
    const stopWorker = async () => {
      const sw = await swTarget();
      if (sw) await browser.send('Target.closeTarget', { targetId: sw.targetId }).catch(() => {});
      let gone = false;
      for (let i = 0; i < 20 && !gone; i++) { await sleep(250); gone = !(await swTarget()); }
      return { was: Boolean(sw), gone };
    };
    async function scamSide(label, { gift, exchange, card, restart }) {
      const out = {};
      // A fake PayPal sign-in: the block page, with the real site.
      const a = await openPage(browser);
      if (restart) out.stopped = await stopWorker();
      await browser.send('Page.navigate', { url: `http://${TYPED_PW}/signin.html?${label}` }, a.sessionId);
      const block = await waitText(browser, a.sessionId, /Go to the real paypal\.com/, 80);
      await shot(browser, a.sessionId, `companion-real-${label}-fake-paypal`);
      out.paypal = /Take me back to safety/.test(block) && /Go to the real paypal\.com/.test(block);
      await browser.send('Target.closeTarget', { targetId: a.targetId }).catch(() => {});
      // A fake gift card checkout, after that warning.
      const g = await openPage(browser);
      if (restart) out.stopped2 = await stopWorker();
      await browser.send('Page.navigate', { url: `http://${gift}/gift-cards/checkout` }, g.sessionId);
      out.gift = (await waitText(browser, g.sessionId, saysRe, 60)).includes(SAYS);
      await shot(browser, g.sessionId, `companion-real-${label}-gift-checkout`);
      // A fake exchange whose withdraw screen comes by pushState.
      const x = await openPage(browser);
      await goto(browser, x.sessionId, `http://${exchange}/exchange/home`);
      await sleep(1500);
      out.exchangeQuiet = !(await pageText(browser, x.sessionId)).includes(SAYS);
      if (restart) out.stopped3 = await stopWorker();
      await evalIn(browser, x.sessionId, 'window.goWithdraw()');
      out.exchange = (await waitText(browser, x.sessionId, saysRe, 60)).includes(SAYS);
      await shot(browser, x.sessionId, `companion-real-${label}-exchange-withdraw`);
      // A flagged checkout whose card box is in a payment frame, then another page.
      const c = await openPage(browser);
      await goto(browser, c.sessionId, `http://${card}/checkout.html`);
      await passBlock(browser, c.sessionId, "document.querySelector('iframe')");
      let noticed = null;
      for (let i = 0; i < 80 && !noticed; i++) { await sleep(250); noticed = Object.entries(await kept()).find(([k, v]) => k.startsWith('typed:') && v && v.host === card && v.card) || null; }
      out.cardNoticed = Boolean(noticed);
      if (restart) out.stopped4 = await stopWorker();
      await browser.send('Page.navigate', { url: `${files.base}/recipes.html?${label}` }, c.sessionId);
      const asked = await waitText(browser, c.sessionId, /Did you type a card number on that page\?/, 60);
      out.card = /Did you type a card number on that page\?/.test(asked) && asked.includes(card);
      await shot(browser, c.sessionId, `companion-real-${label}-card-question`);
      for (const t of [g, x, c]) await browser.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
      return out;
    }
    const first = await scamSide('awake', { gift: 'giftshop.test', exchange: 'exchange.test', card: CARD_HOSTS[0], restart: false });
    result('companion-real: the scam side works: fake PayPal blocked with the real site, pause on a fake gift checkout and on a pushState withdraw screen, card question after a payment frame',
      first.paypal && first.gift && first.exchangeQuiet && first.exchange && first.cardNoticed && first.card, first);
    const second = await scamSide('restarted', { gift: 'giftshop2.test', exchange: 'exchange2.test', card: CARD_HOSTS[1], restart: true });
    result('companion-real: and all of it again when the browser has just stopped the companion\'s worker before each step',
      Boolean(second.stopped && second.stopped.gone) && second.paypal && second.gift && second.exchangeQuiet && second.exchange && second.cardNoticed && second.card, second);
  } finally {
    await withIt.close();
    await without.close();
    files.server.close();
    proxy.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkCompanionReal;
