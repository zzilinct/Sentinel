'use strict';
/**
 * companion-device  The companion checks on the device alone: no account, no scanner. A recorder stands where the scanner
 *                   would be and counts every request, in a real headless Chrome with the real extension.
 *   1. The threat list is one public file (served here), fetched on the existing alarm, kept in the browser's cache, and
 *      asked for again only to learn whether it changed.
 *   2. A listed site is stopped, a copy of a brand is marked orange, an ordinary site gets the quiet tick that says it
 *      was only checked here: on a search page, with not one request to the scanner for any result.
 *   3. The words: the options page says "on this device only", never "on".
 *   4. Pictures: the search page and the settings headline, light and dark.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot, NO_UPGRADE, until } = require('./_shared');
const { listFile } = require('../engine-bundle');

const freePort = () => new Promise((resolve) => { const sv = net.createServer().listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });
const LISTED = 'device-listed.test';
const HONEST = 'device-honest.test';
const COPY = ['paypa', '1.com'].join('');   // a look-alike of a brand, put together here so no whole address is written down

async function checkCompanionDevice() {
  // Where the scanner would be: counts everything, answers nothing.
  const scanner = [];
  const recorder = http.createServer((req, res) => { scanner.push(req.url); res.writeHead(503); res.end(); });
  const recorderPort = await freePort();
  await new Promise((resolve) => recorder.listen(recorderPort, '127.0.0.1', resolve));

  // The threat list, as the repository publishes it, with its tag.
  const file = listFile([{ host: LISTED, threat: 'scam' }, ...Array.from({ length: 2000 }, (_, i) => ({ host: `filler-${i}.device-list.test`, threat: 'scam' }))]);
  const tag = '"device-list-1"';
  const listRequests = [];
  const listServer = http.createServer((req, res) => {
    listRequests.push({ url: req.url, ifNoneMatch: req.headers['if-none-match'] || '', cookie: req.headers.cookie || '', auth: req.headers.authorization || '' });
    if (req.headers['if-none-match'] === tag) { res.writeHead(304); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', ETag: tag, 'Access-Control-Allow-Origin': '*' });
    res.end(file);
  });
  const listPort = await freePort();
  await new Promise((resolve) => listServer.listen(listPort, '127.0.0.1', resolve));

  const hits = {};
  const stand = http.createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    hits[host] = (hits[host] || 0) + 1;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body><h1>Sign in to your account</h1><input id="pw" type="password"></body></html>');
  });
  const standPort = await freePort();
  await new Promise((resolve) => stand.listen(standPort, '127.0.0.1', resolve));
  const row = (host, title) => `<div class="g" data-hveid="CA${title}"><div><a href="http://${host}/page" data-ved="2ah"><br><h3 class="LC20lb">${title}</h3><div><cite>${host}</cite></div></a></div></div>`;
  const files = await serveFiles({}, {
    '/search': `<!doctype html><html><head><meta charset="utf-8"><title>sentinel - Google Search</title></head><body><div id="search"><div id="rso">${row(LISTED, 'Listed')}${row(COPY, 'Copy')}${row(HONEST, 'Honest')}</div></div></body></html>`
  });
  const filesPort = new URL(files.base).port;
  const map = [LISTED, COPY, HONEST].map((h) => `MAP ${h}:80 127.0.0.1:${standPort},MAP ${h}:443 127.0.0.1:9`).join(',');
  const { browser, close, version } = await launch([NO_UPGRADE, `--host-resolver-rules=${map},MAP www.google.com 127.0.0.1:${filesPort}`]);
  try {
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const ext = `chrome-extension://${loaded.id}`;
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `${ext}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    // No account: the recorder is the scanner's address, and the list's address is the test's own file.
    await evalIn(browser, opt.sessionId, `chrome.storage.sync.set({ apiBase: 'http://127.0.0.1:${recorderPort}' }).then(() => chrome.storage.local.set({ listUrl: 'http://127.0.0.1:${listPort}/threats.bin' }))`);

    /* 1. The list, on the alarm that already exists. */
    const alarm = () => evalIn(browser, opt.sessionId, "chrome.alarms.create('sentinel:intel', { when: Date.now() + 200 })");
    await alarm();
    await until(browser, opt.sessionId, "chrome.storage.local.get('listEtag').then((s) => Boolean(s.listEtag))", 20000);
    const first = listRequests[0] || {};
    result('companion-device: the threat list is one public file, asked for with no cookie, no account and no address of anyone\'s', !first.ifNoneMatch && listRequests.every((r) => !r.cookie && !r.auth), { listRequests });
    await alarm();
    for (let i = 0; i < 40 && listRequests.length < 2; i++) await sleep(250);
    result('companion-device: asked again, it only asks whether the file changed, and keeps what it had', listRequests.length >= 2 && listRequests.slice(1).every((r) => r.ifNoneMatch === tag), { listRequests });

    /* 2. A search page, and a page opened. */
    const scannerBefore = scanner.filter((u) => u.includes('/api/v1/live')).length;
    const serp = await openPage(browser);
    await goto(browser, serp.sessionId, 'http://www.google.com/search?q=sentinel');
    const marks = await until(browser, serp.sessionId, `(() => { const m = [...document.querySelectorAll('.sentinel-mask')]; return m.length >= 3 ? m.map((x) => x.getAttribute('aria-label') || '') : null; })()`, 20000);
    await sleep(1500);
    const labels = await evalIn(browser, serp.sessionId, "[...document.querySelectorAll('.sentinel-masks')].map((g) => [...g.querySelectorAll('.sentinel-mask')].map((x) => x.getAttribute('aria-label') || '').join(' | '))");
    result('companion-device: on a search page the listed site and the copy of a brand are marked, and the ordinary one says it was only checked here',
      labels.length === 3 && /Confirmed scam|scam/i.test(labels[0]) && /Likely scam|scam/i.test(labels[1]) && !/no warning signs found/.test(labels[2]) && /checked on this device only/.test(labels[2]), { labels, marks });
    result('companion-device: not one search result went to the scanner', scanner.filter((u) => u.includes('/api/v1/live')).length === scannerBefore, { scanner });
    await shot(browser, serp.sessionId, 'companion-device-search');
    await browser.send('Target.closeTarget', { targetId: serp.targetId }).catch(() => {});

    const stopped = await openPage(browser);
    await goto(browser, stopped.sessionId, `http://${LISTED}/signin`);
    await until(browser, stopped.sessionId, "location.href.includes('block.html')", 15000).catch(() => {});
    const href = await evalIn(browser, stopped.sessionId, 'location.href');
    result('companion-device: a listed site opened by hand ends on the block page, with no scanner asked', href.includes('block.html') && scanner.filter((u) => u.includes('/api/v1/live')).length === scannerBefore, { href });
    // Said plainly, not asserted: the large list is hashed, so the browser's rule cannot hold it and the request can win the race.
    console.log(`      the listed site's own server was asked ${hits[LISTED] || 0} time(s) before the page was replaced`);
    await browser.send('Target.closeTarget', { targetId: stopped.targetId }).catch(() => {});

    const fine = await openPage(browser);
    await goto(browser, fine.sessionId, `http://${HONEST}/signin`, "document.getElementById('pw')");
    result('companion-device: an ordinary site is let alone', /Sign in to your account/.test(await pageText(browser, fine.sessionId)));
    await browser.send('Target.closeTarget', { targetId: fine.targetId }).catch(() => {});

    /* 3. The words. */
    const said = await evalIn(browser, opt.sessionId, `chrome.runtime.sendMessage({ type: 'state' }).then((s) => { const v = globalThis.SentinelSay.protection(s); return { tone: v.tone, title: v.title, line: v.line, device: s.device }; })`);
    result('companion-device: signed out, Sentinel says it checks on this device only, never "on"', said.tone === 'paused' && /on this device only/.test(said.title) && said.device && said.device.count > 2000, said);
    // The settings page as it opens now: the headline is read as the page loads, and the list has arrived since.
    await goto(browser, opt.sessionId, `${ext}/src/options.html`, "document.getElementById('headline') && document.getElementById('headline').textContent.length > 0");
    const headline = await evalIn(browser, opt.sessionId, "document.getElementById('headLine').textContent");
    result('companion-device: the settings headline, opened after the list arrived, no longer says the list is missing', /threat list/.test(headline) && !/not been downloaded/.test(headline), { headline });
    for (const scheme of ['dark', 'light']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, opt.sessionId);
      await sleep(300);
      await shot(browser, opt.sessionId, `companion-device-settings-${scheme}`);
    }
    console.log(`      chrome ${version}`);
  } finally {
    await close();
    recorder.close(); listServer.close(); stand.close(); files.close && files.close();
  }
}
void fs; void OUT;
module.exports = checkCompanionDevice;
