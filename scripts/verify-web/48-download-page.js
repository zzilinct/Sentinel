'use strict';
/**
 * download-page  The download page as a person meets it, with GitHub's answer played back: the warning is on the first
 *                screen at phone and desktop width, in dark and light; the practice warning goes all the way through by
 *                keyboard and by pointer; a real file is checked against the published fingerprint (match, a wrong file
 *                of the same size, another size, GitHub unreachable); a phone is not sold a Windows file; a release
 *                newer than the site's note says so; no release hides the check.
 *                A picture of each (download-<state>-<size>-<theme>.png).
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sleep, result, launch, evalIn, openPage, goto, startServer, watchErrors, pressKey, clickSel, until, shot } = require('./_shared');

const SIZES = { phone: [390, 844, true], desktop: [1366, 900, false] };
const THEMES = ['dark', 'light'];

async function checkDownloadPage() {
  const server = await startServer('download');
  const { base } = server;
  const { browser, close } = await launch();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-download-'));
  try {
    const real = path.join(dir, 'Sentinel-Setup.exe');
    const sameSize = path.join(dir, 'other.exe');
    const otherSize = path.join(dir, 'small.exe');
    const bytes = crypto.randomBytes(3 * 1048576);
    fs.writeFileSync(real, bytes);
    fs.writeFileSync(sameSize, crypto.randomBytes(bytes.length));
    fs.writeFileSync(otherSize, bytes.subarray(1));
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const noteVersion = require('../../package.json').version;

    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const release = (tag) => JSON.stringify({ tag_name: `v${tag}`, assets: [{ name: 'Sentinel-Setup.exe', size: bytes.length, digest: `sha256:${sha256}` }] });
    let answer = { code: 200, body: release(noteVersion) };
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.github.com/*' }] }, s);
    browser.on('Fetch.requestPaused', (p, sid) => {
      if (sid !== s) return;
      browser.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: answer.code, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(answer.body).toString('base64') }, s).catch(() => {});
    });
    const open = async () => { await goto(browser, s, `${base}/download`); await sleep(900); };
    const choose = async (file) => {
      const { result: input } = await browser.send('Runtime.evaluate', { expression: "document.querySelector('[data-check-file]')" }, s);
      await browser.send('DOM.setFileInputFiles', { files: [file], objectId: input.objectId }, s);
      await until(browser, s, "!document.querySelector('[data-check-pick]').disabled && !/Reading/.test(document.querySelector('[data-check-result]').textContent)");
      return evalIn(browser, s, "(() => { const r = document.querySelector('[data-check-result]'); return { words: r.textContent, tone: r.className }; })()");
    };
    const look = (extra = '') => evalIn(browser, s, `(() => { const ss = document.querySelector('[data-ss]'); const seen = (e) => e.checkVisibility({ visibilityProperty: true, opacityProperty: true });
      const q = (x) => document.querySelector(x); const ring = q('.ss__ring').getBoundingClientRect();
      return { state: ss.dataset.state, more: seen(q('[data-ss-more]')), run: seen(q('[data-ss-run]')), facts: seen(q('.ss__facts')), after: seen(q('[data-ss-again]')), say: q('[data-ss-say]').textContent,
        focus: document.activeElement.textContent.trim(), ringW: Math.round(ring.width), wide: document.documentElement.scrollWidth - innerWidth ${extra} }; })()`);

    /* ------------------------------------------------- the first screen, in every size */

    const wide = [];
    const above = [];
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        await open();
        const tall = await evalIn(browser, s, "(() => { const r = (x) => Math.round(document.querySelector(x).getBoundingClientRect().bottom + scrollY); return { button: r('[data-installer]'), warning: r('.get__moment h2'), body: document.documentElement.scrollHeight, wide: document.documentElement.scrollWidth - innerWidth }; })()");
        above.push({ size, theme, height, ...tall });
        if (tall.wide > 0) wide.push(`${size} ${theme}: ${tall.wide} px`);
        await shot(browser, s, `download-top-${size}-${theme}`);
        await clickSel(browser, s, '[data-ss-more]');
        await sleep(300);
        await shot(browser, s, `download-warning-more-${size}-${theme}`);
        await clickSel(browser, s, '[data-ss-run]');
        await sleep(300);
        await shot(browser, s, `download-warning-done-${size}-${theme}`);
        await evalIn(browser, s, "(document.querySelector('.relnote__all').open = true, document.querySelector('[data-check]').scrollIntoView(), 1)");
        await choose(real);
        await sleep(200);
        await shot(browser, s, `download-check-${size}-${theme}`);
      }
    }
    result('download-page: the Download button and the warning\'s heading are both on the first screen', above.every((a) => a.button < a.height && a.warning < a.height), above);
    result('download-page: nothing runs off the side of the page', !wide.length, wide);
    result('download-page: the page is short now (under 7,500 px on a phone, under 4,300 on a computer)', above.every((a) => a.body < (a.size === 'phone' ? 7500 : 4300)), above.map((a) => `${a.size} ${a.theme}: ${a.body}`));

    /* ------------------------------------------------- the practice warning */

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }, s);
    await open();
    const first = await look();
    result('download-page: the practice starts on More info, with nothing else to press', first.state === 'first' && first.more && !first.run && !first.facts && !first.after, first);
    await evalIn(browser, s, "(document.querySelector('[data-ss-more]').focus(), 1)");
    await pressKey(browser, s, 'Enter');
    await sleep(800);
    const second = await look();
    result('download-page: Enter on More info names the file and the unknown publisher, and moves to Run anyway', second.state === 'more' && !second.more && second.run && second.facts && second.focus === 'Run anyway' && /not signed/.test(second.say), second);
    await pressKey(browser, s, 'Enter');
    await sleep(800);
    const third = await look();
    result('download-page: Enter on Run anyway finishes, and focus lands on Start over', third.state === 'done' && third.after && third.focus === 'Start over', third);
    await pressKey(browser, s, 'Enter');
    await sleep(800);
    const back = await look();
    result('download-page: Start over goes back to the beginning, with the focus not lost', back.state === 'first' && back.more && !back.run && back.focus === 'More info', back);
    await clickSel(browser, s, '[data-ss-more]');
    await clickSel(browser, s, '[data-ss-more]'); // A second press lands on nothing: More info has gone.
    await sleep(800);
    const press = await look();
    result('download-page: a pointer gets there too, and a double press does no harm', press.state === 'more' && press.run, press);

    /* ------------------------------------------------- the check of a file */

    const shown = await evalIn(browser, s, "document.querySelector('[data-check-print]').textContent");
    result('download-page: the published fingerprint is on the page, read from GitHub', shown.includes(sha256) && shown.includes(noteVersion), shown);
    const match = await choose(real);
    result('download-page: the right file says it matches', /^It matches\./.test(match.words) && /is-match/.test(match.tone), match);
    const same = await choose(sameSize);
    result('download-page: a different file of the same size does not', /^This is not the/.test(same.words) && /is-wrong/.test(same.tone), same);
    const size = await choose(otherSize);
    result('download-page: nor does a file of another size', /^This is not the/.test(size.words) && /is-wrong/.test(size.tone), size);
    const twice = await choose(real);
    result('download-page: the same file can be chosen again after a wrong one', /^It matches\./.test(twice.words), twice);

    answer = { code: 403, body: '{"message":"refused"}' };
    await open();
    const lost = await choose(real);
    const lostHash = await evalIn(browser, s, "document.querySelector('[data-check-hash]').textContent");
    await shot(browser, s, 'download-no-github');
    result('download-page: with GitHub out of reach it claims no match, shows the fingerprint and points to the list', !/matches\b(?!.*nothing)/i.test(lost.words) && /nothing to compare/.test(lost.words) && !/is-match/.test(lost.tone) && lostHash === sha256, { lost, lostHash });

    /* ------------------------------------------------- the other answers */

    answer = { code: 200, body: release('99.0.0') };
    await open();
    const newer = await evalIn(browser, s, "(() => { const n = document.querySelector('[data-release-newer]'); return { hidden: n.hidden, words: n.textContent, href: n.querySelector('a').href }; })()");
    result('download-page: a release newer than the site\'s note says so, and links its notes', !newer.hidden && /version 99\.0\.0/.test(newer.words) && /changelog\/99\.0\.0\.md$/.test(newer.href), newer);

    answer = { code: 200, body: release(noteVersion) };
    await open();
    const same2 = await evalIn(browser, s, "document.querySelector('[data-release-newer]').hidden");
    result('download-page: the same version says nothing extra', same2 === true);

    answer = { code: 404, body: '{"message":"Not Found"}' };
    await open();
    const none = await evalIn(browser, s, "document.querySelector('[data-check]').checkVisibility()");
    result('download-page: with no release there is no file to check, and the check is gone', none === false, none);
    answer = { code: 200, body: release(noteVersion) };

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
    await browser.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' }, s);
    await open();
    const phone = await evalIn(browser, s, "(() => { const q = (x) => document.querySelector(x); return { note: q('[data-not-windows]').checkVisibility(), goldFile: q('[data-installer]').classList.contains('btn--gold'), goldWeb: q('[data-webapp]').classList.contains('btn--gold'), file: q('[data-installer]').getAttribute('href') }; })()");
    await shot(browser, s, 'download-iphone');
    result('download-page: a phone is told the file is for Windows, gold goes to the web app, and the file can still be fetched', phone.note && !phone.goldFile && phone.goldWeb && /Sentinel-Setup\.exe$/.test(phone.file), phone);

    const ours = errors.filter((e) => !/api\.github\.com/.test(e));
    result('download-page: no errors on the page', !ours.length, ours.slice(0, 5));
  } finally {
    await close();
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = checkDownloadPage;
