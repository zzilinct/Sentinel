'use strict';
/**
 * companion-soak  The companion's memory after an hour of ordinary browsing, against the same browsing in a Chrome
 * without it: real search pages, articles and sites opened and closed one after another, and an inbox (a stand-in at
 * mail.google.com) left open the whole time with new mail arriving. Every few minutes: the memory of each browser's
 * processes, the inbox tab's script heap, the companion worker's heap (when Chrome has it running) and what the
 * companion keeps in storage. Writes companion-soak.json.
 *
 * It takes as long as SOAK_MINUTES says, so it runs in its own CI job (verify-web.yml, companion-soak); without
 * SOAK_MINUTES it does nothing.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { OUT, sleep, result, launch, evalIn, openPage, goto } = require('./_shared');
const { tlsServer, startSentinel, loadCompanion, workerTarget, pairedOptions, gmailPage } = require('./_companion');

const QUERIES = ['banana bread recipe', 'how to reset a router', 'weather tomorrow', 'library opening hours', 'cheap flights to rome', 'how to tie a tie',
  'best running shoes', 'paypal login help', 'tax return deadline', 'learn spanish online', 'used cars near me', 'printer offline windows'];
const SITES = ['https://en.wikipedia.org/wiki/Special:Random', 'https://www.bbc.com/news', 'https://github.com/explore', 'https://stackoverflow.com/questions',
  'https://www.gov.uk/', 'https://developer.mozilla.org/en-US/', 'https://www.weather.gov/', 'https://www.nasa.gov/'];
const MB = (b) => Math.round(b / 1048576);

/** Private memory of every process of the Chrome that uses this profile, in bytes. */
function processMemory(profile) {
  const needle = profile.replace(/'/g, "''");
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    `$p = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' }; "$(($p | Measure-Object -Property PrivatePageCount -Sum).Sum) $(@($p).Count)"`], { encoding: 'utf8' }).trim();
  const [bytes, count] = out.split(' ').map(Number);
  return { bytes: bytes || 0, count: count || 0 };
}

async function heap(browser, sessionId) {
  await browser.send('HeapProfiler.collectGarbage', {}, sessionId).catch(() => {});
  const h = await browser.send('Runtime.getHeapUsage', {}, sessionId).catch(() => null);
  return h ? h.usedSize : null;
}

async function checkCompanionSoak() {
  const minutes = Number(process.env.SOAK_MINUTES || 0);
  if (!minutes) { console.log('      companion-soak: runs in its own CI job (SOAK_MINUTES)'); return; }
  const sentinel = await startSentinel('companion-soak', 47821);
  const tls = await tlsServer(['mail.google.com'], (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(gmailPage(40)); });
  const flags = [`--host-resolver-rules=${tls.rules}`, '--ignore-certificate-errors'];
  const withIt = await launch(flags);
  const without = await launch(flags);
  const samples = [];
  try {
    const id = await loadCompanion(withIt.browser);
    const opt = await pairedOptions(withIt.browser, id, sentinel.base, await sentinel.deviceToken());
    const sides = { with: withIt, without };
    const inbox = {};
    for (const [k, side] of Object.entries(sides)) {
      inbox[k] = await openPage(side.browser);
      await goto(side.browser, inbox[k].sessionId, 'https://mail.google.com/mail/u/0/#inbox');
    }
    await sleep(5000);

    const sample = async (minute) => {
      const sw = await workerTarget(withIt.browser, id);
      let swHeap = null;
      if (sw) {
        const { sessionId } = await withIt.browser.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
        swHeap = await heap(withIt.browser, sessionId);
        await withIt.browser.send('Target.detachFromTarget', { sessionId }).catch(() => {});
      }
      const storage = await evalIn(withIt.browser, opt.sessionId, 'Promise.all([chrome.storage.local.getBytesInUse(null), chrome.storage.session.getBytesInUse(null)])').catch(() => [null, null]);
      const row = { minute, pages: visits, withMB: MB(processMemory(withIt.profile).bytes), withoutMB: MB(processMemory(without.profile).bytes),
        inboxWithMB: Math.round((await heap(withIt.browser, inbox.with.sessionId)) / 104857.6) / 10, inboxWithoutMB: Math.round((await heap(without.browser, inbox.without.sessionId)) / 104857.6) / 10,
        workerMB: swHeap === null ? null : Math.round(swHeap / 104857.6) / 10, storageLocalKB: Math.round((storage[0] || 0) / 1024), storageSessionKB: Math.round((storage[1] || 0) / 1024),
        inboxMarks: await evalIn(withIt.browser, inbox.with.sessionId, "document.querySelectorAll('.sentinel-masks').length").catch(() => null) };
      samples.push(row);
      console.log(`      soak ${JSON.stringify(row)}`);
      fs.writeFileSync(path.join(OUT, 'companion-soak.json'), JSON.stringify({ minutes, samples }, null, 2));
    };

    let visits = 0;
    const start = Date.now();
    let next = 0;
    for (let i = 0; Date.now() - start < minutes * 60000; i++) {
      if (Date.now() - start >= next) { await sample(Math.round((Date.now() - start) / 60000)); next += 5 * 60000; }
      const url = i % 2 ? SITES[(i >> 1) % SITES.length] : `https://www.bing.com/search?q=${encodeURIComponent(QUERIES[(i >> 1) % QUERIES.length])}&setlang=en`;
      for (const side of [withIt, without]) {
        const t = await openPage(side.browser);
        await side.browser.send('Page.navigate', { url }, t.sessionId).catch(() => {});
        await sleep(4000);
        await evalIn(side.browser, t.sessionId, 'window.scrollTo(0, document.body ? document.body.scrollHeight : 0)').catch(() => {});
        await sleep(1500);
        await side.browser.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
        await evalIn(side.browser, inbox[side === withIt ? 'with' : 'without'].sessionId, 'window.addMail(2)').catch(() => {});
      }
      visits++;
    }
    await sample(minutes);

    const first = samples[0];
    const last = samples[samples.length - 1];
    const growth = (last.withMB - first.withMB) - (last.withoutMB - first.withoutMB);
    const inboxExtra = last.inboxWithMB - last.inboxWithoutMB;
    const peakWorker = Math.max(0, ...samples.map((x) => x.workerMB || 0));
    result(`companion-soak: after ${minutes} minutes and ${visits} pages, the companion's Chrome grew ${growth} MB more than one without it (under 150 MB), the inbox tab holds ${Math.round(inboxExtra * 10) / 10} MB more (under 20 MB), the worker peaked at ${peakWorker} MB (under 40 MB), storage ${last.storageLocalKB} KB`,
      growth < 150 && inboxExtra < 20 && peakWorker < 40 && last.storageLocalKB < 1024, samples);
  } finally {
    await withIt.close();
    await without.close();
    tls.close();
    await sentinel.stop();
  }
}

module.exports = checkCompanionSoak;
