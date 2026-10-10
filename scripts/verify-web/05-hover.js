'use strict';
/**
 * hover     Resting the pointer on a link shows the companion's mask beside it (a listed scam behind Google's
 *           wrapper, an honest site), with the real Sentinel server behind the companion; nothing while it is off.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot } = require('./_shared');

/* ---------------------------------------------------- 4. hover a link (companion) */

// A listed scam behind Google's redirect wrapper, and an honest site. Neither is ever opened: the page only lists them.
const HOVER_SCAM = `https://www.google.com/url?q=${encodeURIComponent('https://paypa1-secure-login.com/account')}&sa=D`;
const HOVER_SAFE = 'https://www.wikipedia.org/';

async function checkHover() {
  // The real Sentinel server, on its own port and database, with this computer's account (Pro in demo billing), so
  // the companion's verdicts come from the real worker, threat list and fast check.
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-hover-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'hover-server.log'), 'w');
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
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>A forum thread</title>
    <style>body{font:16px/1.6 system-ui,sans-serif;margin:60px}a{display:inline-block;padding:6px 0}</style></head><body>
    <h1>Re: my account was limited?</h1>
    <p>Someone sent me this: <a id="scam" href="${HOVER_SCAM}">PayPal account review</a></p>
    <p>And the wiki has more: <a id="safe" href="${HOVER_SAFE}">Wikipedia</a></p>
    <p id="blank" style="height:200px">Nothing here.</p></body></html>`;
  const files = await serveFiles({}, { '/thread.html': page });
  const { browser, close } = await launch();
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see hover-server.log)`);
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const paired = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(api)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return Boolean(r && r.account && r.account.signedIn);
    })()`);
    if (!paired) throw new Error('the companion could not sign in to the test server');

    const tab = await openPage(browser);
    const s = tab.sessionId;
    const mouse = (x, y) => browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s);
    const at = async (id) => evalIn(browser, s, `(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
    const tipText = async () => {
      const text = await pageText(browser, s);
      return /Nothing here\.(.*)$/.exec(text) ? /Nothing here\.(.*)$/.exec(text)[1].trim() : '';
    };
    const hover = async (id) => {
      await mouse(...await at('blank'));
      await sleep(300);
      await mouse(...await at(id));
      let text = '';
      for (let i = 0; i < 30 && !text; i++) { await sleep(200); text = await tipText(); }
      return text;
    };

    await goto(browser, s, `${files.base}/thread.html`);
    await sleep(800);   // the content script reads its settings at start
    // Not before the pointer has rested: half a second.
    await mouse(...await at('scam'));
    await sleep(200);
    const early = await tipText();
    const scam = await hover('scam');
    await shot(browser, s, 'companion-hover-scam');
    result('companion: resting on a link to a listed scam (behind Google\'s /url wrapper) shows the scam mask beside it, after the pointer rests',
      !early && /scam/i.test(scam) && /paypa1-secure-login\.com/.test(scam), { early, tip: scam });
    const safe = await hover('safe');
    await shot(browser, s, 'companion-hover-safe');
    result('companion: resting on a link to an honest site shows the quiet "no warning signs" mark', /No warning signs found|A verified site/.test(safe) && !/scam/i.test(safe), { tip: safe });
    await mouse(...await at('blank'));
    await sleep(400);
    const gone = await tipText();
    result('companion: the mark goes when the pointer leaves the link', !gone, { after: gone });

    // The companion switched off: a fresh page has nothing listening, and nothing appears.
    await evalIn(browser, opt.sessionId, 'chrome.storage.sync.set({ enabled: false }).then(() => true)');
    await goto(browser, s, `${files.base}/thread.html`);
    await sleep(800);
    await mouse(...await at('blank'));
    await sleep(300);
    await mouse(...await at('scam'));
    await sleep(2500);
    const off = await tipText();
    const host = await evalIn(browser, s, "Boolean(document.querySelector('[data-sentinel-hover]'))");
    await shot(browser, s, 'companion-hover-off');
    result('companion: with the companion turned off, resting on the same link shows nothing', !off && !host, { tip: off, host });
  } finally {
    await close();
    files.server.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkHover;
