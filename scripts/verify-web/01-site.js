'use strict';
/**
 * site      Try a link on the static website (npm run build:static) gives real verdicts in the browser, with no
 *           console errors and no request that carries the typed link.
 */
const fs = require('fs');
const path = require('path');
const { STATIC, sleep, result, serveFiles, launch, evalIn, openPage, goto, shot, typeText, pressEnter } = require('./_shared');

/* -------------------------------------------------------------- 1. the site */

const SCAM = 'paypa1-account-verify.top';
const HONEST = 'https://www.wikipedia.org';

async function checkSite() {
  if (!fs.existsSync(path.join(STATIC, 'assets', 'js', 'engine.js'))) throw new Error(`no static build in ${STATIC}: run npm run build:static`);
  const files = await serveFiles({ '/': STATIC });
  const { browser, version, close } = await launch();
  try {
    const { sessionId } = await openPage(browser);
    const requests = [];
    const errors = [];
    browser.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, post: p.request.postData || '' }));
    browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
    browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
    browser.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url || ''}`); });
    await browser.send('Network.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Log.enable', {}, sessionId);
    await goto(browser, sessionId, `${files.base}/index.html`, "document.querySelector('[data-try-form]') && window.SENTINEL_STATIC");
    await sleep(1500);   // the page's own start-up (3D masks, demo) has its say in the console first

    const before = requests.length;
    const verdicts = {};
    for (const link of [SCAM, HONEST]) {
      await evalIn(browser, sessionId, `(() => { const f = document.querySelector('[data-try-form]'); document.querySelector('[data-try-out]').innerHTML = ''; f.elements.url.value = ''; f.elements.url.scrollIntoView({ block: 'center' }); f.elements.url.focus(); })()`);
      await typeText(browser, sessionId, link);
      await pressEnter(browser, sessionId);
      let v = null;
      for (let i = 0; i < 60 && !v; i++) {
        await sleep(250);
        v = await evalIn(browser, sessionId, `(() => {
          const r = document.querySelector('[data-try-out] .try__result');
          if (!r) { const e = document.querySelector('[data-try-out] .try__empty'); return e ? { error: e.textContent.trim() } : null; }
          return { title: r.querySelector('h3').textContent, host: r.querySelector('.try__head p').textContent, colour: r.style.getPropertyValue('--c'),
            caveat: [...r.querySelectorAll('.try__caveat')].map((p) => p.textContent),
            threats: [...r.querySelectorAll('.try__threat')].map((t) => t.textContent.trim().replace(/\\s+/g, ' ')),
            why: [...r.querySelectorAll('.try__why li')].map((li) => li.textContent), foot: r.querySelector('.try__foot span').textContent };
        })()`);
      }
      verdicts[link] = v;
      await shot(browser, sessionId, `site-${link.replace(/\W+/g, '-')}`);
    }

    const scam = verdicts[SCAM] || {};
    const honest = verdicts[HONEST] || {};
    const needles = ['paypa1', 'account-verify', 'wikipedia'];
    const leaks = requests.slice(before).filter((r) => needles.some((n) => (r.url + r.post).toLowerCase().includes(n)));
    // Requests after typing: only the checker itself (engine.js and its word list) may load, from this host.
    const offHost = requests.slice(before).filter((r) => !r.url.startsWith(files.base) && !r.url.startsWith('data:'));
    const CLEAN = 'No warning signs in the address';
    result(`site: ${SCAM} gets a warning`, Boolean(scam.title) && scam.title !== CLEAN && scam.title !== 'No threats found' && !/green/.test(scam.colour), scam);
    // Checked in the browser, with no threat list: never "No threats found" in green, and it says what was left out.
    result(`site: ${HONEST} shows no warning signs, without claiming the threat lists were checked`,
      honest.title === CLEAN && !/green/.test(honest.colour) && (honest.caveat || []).some((c) => /Threat lists were not checked here/.test(c)) && !(honest.caveat || []).some((c) => /did not run/.test(c)), honest);
    result('site: no request carries the typed link, and none leaves the page\'s host', !leaks.length && !offHost.length,
      [`requests after typing: ${requests.slice(before).map((r) => r.url.replace(files.base, '')).join(', ') || 'none'}`, ...leaks.map((r) => `leak: ${r.url}`), ...offHost.map((r) => `off host: ${r.url}`)]);
    result('site: no console errors', !errors.length, errors.length ? errors : `${version}, ${requests.length} requests`);
  } finally {
    await close();
    files.server.close();
  }
}

module.exports = checkSite;
