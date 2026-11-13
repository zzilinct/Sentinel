'use strict';
/**
 * companion-look  The companion's own pages (popup, settings, block page) in the look the person chose, in Chrome and
 *   in Firefox. The Windows app's server on this computer says Sapphire and Light; the settings page takes it as it
 *   opens and ticks it in its Look group. A coin pressed there (mouse or arrow keys) changes the companion at once
 *   and is kept: the next popup opens in it, with no gold first. A change made in the app reaches a settings page
 *   that is already open, without a reload and without anything polling. Danger, warning and safe keep their exact
 *   colours in every accent and scheme. A switch that could not be saved goes back and says so. Photographed: the
 *   settings page wide and at phone width, the popup and the block page, dark and light, in both browsers.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, OUT, sleep, result, launch, evalIn, openPage, goto, shot, clickSel, pressKey, until } = require('./_shared');
const { startSentinel, loadCompanion, pairedOptions } = require('./_companion');
const L = require(path.join(ROOT, 'web', 'assets', 'js', 'look.js'));

const STATUS = { dark: '#ff7a7e #f08a24 #4cb782', light: '#b3261e #a84600 #1e7a3c' };
const LOOK = "(() => { const h = document.documentElement; return (h.dataset.theme || 'auto') + ' ' + h.dataset.accent; })()";

async function checkCompanionLook() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-clook-'));
  const lookFile = path.join(dir, 'look.json');
  // As main.js writes it: each setting with when it was chosen in the app.
  const chosen = (mode, accent) => { const at = Date.now(); fs.writeFileSync(lookFile, JSON.stringify({ mode, accent, at: { mode: at, accent: at } })); };
  chosen('light', 'sapphire');
  process.env.SENTINEL_LOOK_FILE = lookFile;
  const sentinel = await startSentinel('companion-look', 47821);
  const { browser, close } = await launch();
  try {
    const id = await loadCompanion(browser);
    const ext = `chrome-extension://${id}`;
    const opt = await pairedOptions(browser, id, sentinel.base, await sentinel.deviceToken());
    const s = opt.sessionId;
    const ev = (expr) => evalIn(browser, s, expr);
    const media = (sid, scheme, motion = 'reduce') => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: motion }] }, sid);
    // A phone (mobile, the page's own viewport) or a desktop window; the popup is a 360 px desktop window, never a phone.
    const size = (sid, width, height, mobile = false) => browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sid);
    const wide = (sid) => evalIn(browser, sid, 'document.documentElement.scrollWidth - innerWidth');
    await size(s, 1280, 900);
    await media(s, 'dark');

    /* ------------------------------------------- 1. the app's look, taken */

    await goto(browser, s, `${ext}/src/options.html`, "document.getElementById('lookCoins').children.length > 0");
    const fromApp = await until(browser, s, `${LOOK} === 'light sapphire'`, 8000);
    const ticked = await ev("[...document.querySelectorAll('#look input:checked')].map((i) => i.value).join(' ')");
    const named = await ev("[...document.querySelectorAll('#look fieldset')].map((f) => f.querySelector('legend').textContent + ': ' + f.querySelectorAll('input[type=radio]').length).join(', ')");
    result('companion-look: the settings page takes the look the Windows app chose (Sapphire, Light) and ticks it in Look',
      Boolean(fromApp) && ticked === 'light sapphire' && named === `Theme: 3, Colour: ${L.ACCENTS.length}`, { fromApp, ticked, named });
    await shot(browser, s, 'companion-look-chrome-options-sapphire-light');

    /* -------------------------------- 2. danger, warning and safe never move */

    const seen = await ev(`(() => {
      const html = document.documentElement, seen = { dark: [], light: [] };
      for (const mode of ['dark', 'light']) for (const a of SentinelLook.ACCENTS) {
        SentinelLook.paint(html, { mode, accent: a.id });
        const c = getComputedStyle(html);
        const v = ['--red', '--orange', '--green'].map((k) => c.getPropertyValue(k).trim()).join(' ');
        if (!seen[mode].includes(v)) seen[mode].push(v);
      }
      SentinelLook.paint(html, SentinelLookHere.get());
      return seen;
    })()`);
    result('companion-look: danger, warning and safe are the same bytes in every accent, in dark and in light (popup.css)',
      seen.dark.join() === STATUS.dark && seen.light.join() === STATUS.light, seen);

    /* ------------------------------------- 3. chosen here: mouse, then keys */

    await media(s, 'dark', 'no-preference');
    await clickSel(browser, s, '#lookCoins input[value="teal"]');
    const now = await until(browser, s, `${LOOK} === 'light teal'`, 3000);
    await sleep(900);
    const kept = await ev("chrome.storage.local.get('look').then((r) => r.look)");
    result('companion-look: a coin pressed changes the page at once and is kept for the popup, the block page and the marks',
      Boolean(now) && kept && kept.accent === 'teal' && kept.live && kept.live.rgb === L.ramp('teal', 'dark')['--live-rgb'], { now, kept: kept && { accent: kept.accent, mode: kept.mode, live: kept.live } });
    await ev("document.querySelector('#lookModes input:checked').focus(), true");
    await pressKey(browser, s, 'ArrowDown');
    const keyed = await until(browser, s, `${LOOK} === 'dark teal'`, 3000);
    await media(s, 'dark');
    await sleep(400);
    result('companion-look: the arrow keys move the theme as they move any radio group (Light, then Dark)', Boolean(keyed), { keyed: await ev(LOOK) });
    await shot(browser, s, 'companion-look-chrome-options-teal-dark');
    await size(s, 390, 844, true);
    await sleep(300);
    const phoneWide = await wide(s);
    await ev("document.getElementById('look').scrollIntoView({ block: 'start' }), true");
    await shot(browser, s, 'companion-look-chrome-options-phone-dark');
    await media(s, 'light');
    await ev("SentinelLookHere.set({ mode: 'light' }).then(() => true)");
    await sleep(500);
    const phoneWideLight = await wide(s);
    await shot(browser, s, 'companion-look-chrome-options-phone-light');
    result('companion-look: the settings page fits a phone-wide window, dark and light (nothing wider than the window)', phoneWide <= 0 && phoneWideLight <= 0, { phoneWide, phoneWideLight });
    await size(s, 1280, 900);

    /* --------------------- 4. the popup opens in the kept look, never gold first */

    const web = await openPage(browser);
    await goto(browser, web.sessionId, `${sentinel.base}/`);
    const popup = async (name, scheme) => {
      await browser.send('Target.activateTarget', { targetId: web.targetId });
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', background: true });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      await browser.send('Page.enable', {}, sessionId);
      await size(sessionId, 360, 600);
      await media(sessionId, scheme);
      await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: "document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive' && !window.__firstLook) window.__firstLook = (document.documentElement.dataset.theme || 'auto') + ' ' + document.documentElement.dataset.accent; });" }, sessionId);
      await browser.send('Page.navigate', { url: `${ext}/src/popup.html` }, sessionId);
      await until(browser, sessionId, "document.readyState === 'complete' && !document.querySelector('#view .loading')", 20000);
      await sleep(700);
      const got = { first: await evalIn(browser, sessionId, 'window.__firstLook'), now: await evalIn(browser, sessionId, LOOK), wide: await wide(sessionId) };
      await shot(browser, sessionId, name);
      await browser.send('Target.closeTarget', { targetId });
      return got;
    };
    const pop = await popup('companion-look-chrome-popup-teal-light', 'light');
    result('companion-look: the next popup opens in the look chosen in the settings (no gold first), and fits its 360 px',
      pop.first === 'light teal' && pop.now === 'light teal' && pop.wide <= 0, pop);

    /* ------------- 5. chosen later in the app: reaches the open settings page */

    await sleep(20);
    chosen('dark', 'amethyst');
    // Nothing polls: the next page of the companion that opens asks the app, and every open page hears what it kept.
    const pop2 = await popup('companion-look-chrome-popup-amethyst-dark', 'light');
    const followed = await until(browser, s, `${LOOK} === 'dark amethyst'`, 5000);
    const ticked2 = await ev("[...document.querySelectorAll('#look input:checked')].map((i) => i.value).join(' ')");
    result('companion-look: a newer choice in the app reaches a settings page that is already open, without a reload, and ticks it',
      pop2.now === 'dark amethyst' && Boolean(followed) && ticked2 === 'dark amethyst', { popup: pop2, followed, ticked2 });
    await ev("window.scrollTo(0, 0), true");
    await shot(browser, s, 'companion-look-chrome-options-amethyst-dark');

    /* ------------------------------------------------- 6. the block page */

    for (const scheme of ['dark', 'light']) {
      const b = await openPage(browser);
      await size(b.sessionId, 1280, 800);
      await media(b.sessionId, scheme);
      await ev(`SentinelLookHere.set({ mode: 'auto' }).then(() => true)`);
      await goto(browser, b.sessionId, `${ext}/src/block.html#http://paypa1-secure-login.com/signin`, "document.getElementById('title').textContent !== 'Checking this page'");
      await sleep(500);
      const blk = await evalIn(browser, b.sessionId, `({ look: ${LOOK}, tone: document.body.dataset.tone, red: getComputedStyle(document.documentElement).getPropertyValue('--red').trim() })`);
      result(`companion-look: the block page draws the chosen accent and keeps danger red (${scheme})`, blk.look === 'auto amethyst' && blk.red === STATUS[scheme].split(' ')[0], blk);
      await shot(browser, b.sessionId, `companion-look-chrome-block-${scheme}`);
      await browser.send('Target.closeTarget', { targetId: b.targetId });
    }

    /* ------------------------------------- 7. a change that is not saved */

    const failed = await ev(`(async () => {
      const box = document.getElementById('scanOverlay');
      const was = box.checked;
      chrome.storage.sync.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
      box.click();
      await new Promise((r) => setTimeout(r, 300));
      return { was, now: box.checked, said: document.getElementById('saved').textContent };
    })()`);
    result('companion-look: a switch the browser would not save springs back and says so, never a silent false "on"',
      failed.now === failed.was && /could not be saved/.test(failed.said), failed);

    /* ------------------------------------------------------- 8. Firefox */

    chosen('light', 'sapphire');
    const sync = spawnSync(process.execPath, [path.join(ROOT, 'desktop', 'scripts', 'sync-shared.js')], { cwd: ROOT, encoding: 'utf8' });
    const ff = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-companion-firefox.js'), '--server', sentinel.base, '--look', '--out', OUT], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    const ffOut = `${ff.stdout || ''}${ff.stderr || ''}`.trim().split(/\r?\n/);
    result('companion-look: in Firefox, the same pages take the app\'s look, keep danger, warning and safe, draw the switches and fit, dark and light',
      ff.status === 0, { sync: sync.status, exit: ff.status, out: ffOut.slice(0, 6) });
  } finally {
    delete process.env.SENTINEL_LOOK_FILE;
    await close();
    await sentinel.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkCompanionLook;
