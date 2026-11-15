'use strict';
/**
 * look   One look everywhere (web/assets/js/look.js): the app's picker changes the accent and light or dark by mouse
 *        and keyboard, opening out of the coin pressed; a reload draws the stored look from the first paint; danger,
 *        warning and caution keep their exact values in every accent; the Windows app's island, marks and warning card
 *        draw the same look from the query main.js gives them; and the companion's popup takes the look from the app's
 *        server (GET /api/v1/look on 127.0.0.1:47821) and keeps it. Photographed: desktop and phone, light and dark.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, sleep, result, launch, evalIn, openPage, goto, serveFiles, clickSel, pressKey, until, shot } = require('./_shared');
const { startSentinel, loadCompanion } = require('./_companion');
const L = require(path.join(ROOT, 'web', 'assets', 'js', 'look.js'));

const STATUS = "(() => { const c = getComputedStyle(document.documentElement); return ['--red', '--orange', '--yellow', '--green'].map((k) => c.getPropertyValue(k).trim()).join(' '); })()";
const VAR = (k) => `getComputedStyle(document.documentElement).getPropertyValue('${k}').trim()`;
const SIZES = { desktop: { width: 1366, height: 900, mobile: false }, phone: { width: 390, height: 844, mobile: true } };

async function checkLook() {
  const lookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-look-'));
  const lookFile = path.join(lookDir, 'look.json');
  // As main.js writes it: each setting with when it was chosen, so it is newer than the companion's untouched gold.
  fs.writeFileSync(lookFile, JSON.stringify({ mode: 'light', accent: 'sapphire', at: { mode: Date.now(), accent: Date.now() } }));
  process.env.SENTINEL_LOOK_FILE = lookFile;   // the Windows app's server, as main.js starts it
  const sentinel = await startSentinel('look', 47821);
  const files = await serveFiles({ '/shared/fonts/': path.join(ROOT, 'web', 'assets', 'fonts'), '/shared/': path.join(ROOT, 'web', 'assets', 'js'), '/d/': path.join(ROOT, 'desktop', 'src') });
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const ev = (expr) => evalIn(browser, s, expr);
    const size = (name, scheme) => Promise.all([
      browser.send('Emulation.setDeviceMetricsOverride', { ...SIZES[name], deviceScaleFactor: 1 }, s),
      browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }, s)
    ]);
    await size('desktop', 'dark');

    /* ------------------------------------------------------------- the app */

    await goto(browser, s, `${sentinel.base}/login`);
    const email = `look-${Date.now()}@example.com`;
    const api = (p, body) => ev(`fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await api('/auth/signup', { email, password: 'Look-Check-Lamp-2026', firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password: 'Look-Check-Lamp-2026' });
    const open = async () => { await goto(browser, s, `${sentinel.base}/app/settings?at=${Date.now()}#accent`, "document.querySelector('#accent .look__coin')"); await sleep(900); };
    const store = (mode, accent) => ev(`(() => { localStorage.removeItem('sentinel:theme'); localStorage.removeItem('sentinel:accent'); ${mode !== 'auto' ? `localStorage.setItem('sentinel:theme', '${mode}');` : ''} ${accent !== 'gold' ? `localStorage.setItem('sentinel:accent', '${accent}');` : ''} return true; })()`);
    const lookPhoto = async (name) => {
      // Instantly, then long enough for the app's own entrance of a part scrolled into view (app-lux.js) to finish.
      await ev("document.getElementById('accent').scrollIntoView({ block: 'center', behavior: 'instant' }), true");
      await sleep(1800);
      await shot(browser, s, name);
    };

    // Gold, untouched: no inline ramp, the stylesheets' own values.
    await open();
    const gold = { inline: await ev("document.documentElement.getAttribute('style') || ''"), g400: await ev(VAR('--gold-400')), status: await ev(STATUS) };
    result('look: gold is the default, drawn by the stylesheets alone (no ramp written over them)',
      !/--gold-/.test(gold.inline) && /^#d2ac63$/i.test(gold.g400) && (await ev("document.documentElement.dataset.accent")) === 'gold', gold);

    // Every accent, both schemes: the status colours stay the same bytes, the accent really changes.
    const seen = {};
    let statusSame = true;
    let accentMoved = true;
    for (const scheme of ['dark', 'light']) {
      for (const a of L.ACCENTS) {
        await store(scheme, a.id);
        await open();
        const st = await ev(STATUS);
        const want = ['red', 'orange', 'yellow', 'green'].map((k) => L.STATUS[scheme][k]).join(' ');
        if (st !== want) statusSame = false;
        const g = await ev(VAR('--gold-400'));
        seen[`${a.id} ${scheme}`] = `${g} | ${st}`;
        if (a.id !== 'gold' && g.toLowerCase() === (scheme === 'dark' ? '#d2ac63' : L.GOLD.light.web[400])) accentMoved = false;
        if (['gold', 'sapphire', 'rose', 'teal'].includes(a.id)) await lookPhoto(`look-app-${a.id}-${scheme}`);
      }
    }
    result('look: danger, warning, caution and safe are the same bytes in every accent, in light and in dark', statusSame, seen);
    result('look: every other accent really recolours the app', accentMoved, seen);

    // Phone, both schemes.
    for (const scheme of ['dark', 'light']) {
      await size('phone', scheme);
      await store(scheme, 'amethyst');
      await open();
      await lookPhoto(`look-app-amethyst-${scheme}-phone`);
      const fits = await ev("document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.look__coin')].every((c) => c.getBoundingClientRect().right <= innerWidth)");
      result(`look: the picker fits a phone (${scheme})`, fits);
    }
    await size('desktop', 'dark');

    // First paint: a reload draws the stored look before anything else (no gold flash). boot.js draws what look.js
    // kept on the visit before, so the page is opened once first, as a person who chose teal has.
    await store('dark', 'teal');
    await open();
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: "document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive' && !window.__firstLook) window.__firstLook = document.documentElement.dataset.accent + ' ' + getComputedStyle(document.documentElement).getPropertyValue('--gold-400').trim(); });" }, s);
    await open();
    const first = await ev('window.__firstLook');
    result('look: a page that loads draws the stored accent from its first paint, never gold first', first === `teal ${L.ramp('teal', 'dark')['--gold-400']}`, { first });

    // The picker by mouse: the new look opens out of the coin (photographed mid-reveal), and is kept.
    await store('dark', 'gold');
    await open();
    await ev("document.getElementById('accent').scrollIntoView({ block: 'center', behavior: 'instant' }), true");
    await sleep(1800);
    await clickSel(browser, s, '.look__coin input[value="rose"]');
    await sleep(260);
    await shot(browser, s, 'look-app-reveal-mid');
    await sleep(700);
    const clicked = { accent: await ev('document.documentElement.dataset.accent'), kept: await ev("localStorage.getItem('sentinel:accent')"), vt: await ev("document.documentElement.classList.contains('look-vt')") };
    result('look: a coin pressed changes the whole app, opening out from the coin, and is remembered', clicked.accent === 'rose' && clicked.kept === 'rose' && !clicked.vt, clicked);

    // The picker by keyboard: the arrow keys move along the coins, the theme radios work the same way.
    await ev("document.querySelector('.look__coin input:checked').focus(), true");
    await pressKey(browser, s, 'ArrowDown');
    await sleep(900);
    const keyed = await ev('document.documentElement.dataset.accent');
    await ev("document.querySelector('.look__mode input:checked').focus(), true");
    await pressKey(browser, s, 'ArrowUp');
    await sleep(900);
    const named = await ev("[...document.querySelectorAll('.look input')].every((i) => i.labels[0] && i.labels[0].textContent.trim()) && document.querySelectorAll('.look fieldset legend').length === 2");
    result('look: the keyboard moves the colour (arrows) and the theme (arrows), and every choice is named for a screen reader',
      keyed === 'amethyst' && (await ev('document.documentElement.dataset.theme')) === 'light' && named, { keyed, theme: await ev('document.documentElement.dataset.theme'), named });
    await lookPhoto('look-app-keyboard-light');
    const said = await ev("document.querySelector('.look__sync').textContent");
    result('look: signed in, the picker says the choice is kept with the account', /with your account/.test(said), said);

    // A second device (a separate browser profile) signs in to the same account: the look arrives by itself.
    const { browserContextId } = await browser.send('Target.createBrowserContext');
    const { targetId: t2 } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const s2 = (await browser.send('Target.attachToTarget', { targetId: t2, flatten: true })).sessionId;
    await browser.send('Page.enable', {}, s2);
    await browser.send('Emulation.setDeviceMetricsOverride', { ...SIZES.phone, deviceScaleFactor: 1 }, s2);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, s2);
    await goto(browser, s2, `${sentinel.base}/login`);
    await evalIn(browser, s2, `fetch('/api/v1/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ email, password: 'Look-Check-Lamp-2026' }))} }).then((r) => r.status)`);
    await goto(browser, s2, `${sentinel.base}/app/settings#accent`, "document.querySelector('#accent .look__coin')");
    const arrived = await until(browser, s2, "document.documentElement.dataset.accent === 'amethyst' && document.documentElement.dataset.theme === 'light' && /with your account/.test(document.querySelector('.look__sync').textContent)", 10000);
    await evalIn(browser, s2, "document.getElementById('accent').scrollIntoView({ block: 'center', behavior: 'instant' }), true");
    await sleep(1800);
    await shot(browser, s2, 'look-sync-second-device-phone');
    result('look: the same account on another device takes the look chosen on the first, with no setting made there', Boolean(arrived),
      { accent: await evalIn(browser, s2, 'document.documentElement.dataset.accent'), theme: await evalIn(browser, s2, 'document.documentElement.dataset.theme') });
    await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});

    /* ------------------------------------- the Windows app's own pages */

    await browser.send('Page.setBypassCSP', { enabled: true }, s);   // their policy names file:, and here they are served
    const overlayHook = "window.sentinelOverlay = { on(n, f) { (window.__on = window.__on || {})[n] = f; }, interact() {}, act() {} };";
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: overlayHook }, s);
    const marks = [0, 1, 2, 3, 4].map((i) => ({ k: `r${i}`, x: 80, y: 120 + i * 70, w: 380, h: 24, ...[{ badge: 'red', kind: 'malware', label: 'Malware detected' }, { badge: null, kind: 'scam', label: 'No scam signs' }, { badge: 'orange', kind: 'scam', label: 'Likely scam' }, { badge: 'yellow', kind: 'scam', label: 'Suspicious' }, { pending: true }][i] }));
    let islandOk = true;
    const islandSeen = {};
    for (const [accent, scheme] of [['gold', 'dark'], ['sapphire', 'dark'], ['sapphire', 'light'], ['teal', 'light']]) {
      await size('desktop', scheme);
      await goto(browser, s, `${files.base}/d/pages/overlay.html?theme=${scheme}&accent=${accent}`, 'window.__on && window.__on["overlay:watching"]');
      await ev(`(() => { document.body.style.background = '${scheme === 'light' ? '#ffffff' : '#202124'}'; __on['overlay:watching']({ appeared: true, browser: 'msedge' }); __on['overlay:page']({ host: 'paypa1-secure-login.example', search: false }); __on['overlay:marks']({ marks: ${JSON.stringify(marks)}, epoch: 0 }); __on['overlay:sweep']({ kind: 'search' }); return true; })()`);
      await sleep(600);
      await shot(browser, s, `look-island-${accent}-${scheme}-scanning`);
      await ev("__on['overlay:verdict']({ badge: 'red', kind: 'scam', label: 'Confirmed scam' }), true");
      await sleep(1400);
      await shot(browser, s, `look-island-${accent}-${scheme}-danger`);
      const got = await ev(`(() => { const c = document.getElementById('corner'); const seal = document.querySelector('.mark.is-red svg g[fill]'); return { corner: c.style.getPropertyValue('--c'), seal: seal && seal.getAttribute('fill'), sheet: getComputedStyle(document.querySelector('.isl__sheet')).backgroundColor, acc: ${VAR('--acc')} }; })()`);
      islandSeen[`${accent} ${scheme}`] = got;
      // The island stays dark in every theme (the owner's call): the dark red, the accent's dark-scheme shade, a dark fill.
      if (got.corner !== L.STATUS.dark.red || got.seal !== L.STATUS.dark.red || got.acc !== L.ramp(accent, 'dark')['--acc'] || got.sheet !== 'rgb(12, 13, 16)') islandOk = false;
    }
    result('look: the island draws the app\'s accent on its own dark fill in light and dark; a danger page is still red', islandOk, islandSeen);

    let cardOk = true;
    const cardSeen = {};
    for (const [accent, scheme] of [['gold', 'dark'], ['rose', 'light'], ['platinum', 'dark']]) {
      await size('desktop', scheme);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 560, deviceScaleFactor: 1, mobile: false }, s);
      const q = new URLSearchParams({ badge: 'orange', label: 'Likely scam', host: 'paypa1-secure-login.example', reasons: 'The address imitates paypal.com\nThe site is three days old', real: 'paypal.com', browser: 'Microsoft Edge', theme: scheme, accent });
      await goto(browser, s, `${files.base}/d/pages/warn.html?${q}`, "document.getElementById('real').textContent");
      await sleep(900);
      await shot(browser, s, `look-card-${accent}-${scheme}`);
      const got = await ev(`({ c: ${VAR('--c')}, theme: document.documentElement.dataset.theme, button: getComputedStyle(document.getElementById('real')).backgroundImage.slice(0, 60) })`);
      cardSeen[`${accent} ${scheme}`] = got;
      if (got.c !== L.STATUS[scheme].orange || got.theme !== scheme) cardOk = false;
    }
    result('look: the warning card opens in the app\'s light or dark and accent, its warning still orange', cardOk, cardSeen);

    /* ----------------------------------------------------- the companion */

    const id = await loadCompanion(browser);
    const pop = await openPage(browser);
    const pe = (expr) => evalIn(browser, pop.sessionId, expr);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 560, deviceScaleFactor: 1, mobile: false }, pop.sessionId);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, pop.sessionId);
    await goto(browser, pop.sessionId, `chrome-extension://${id}/src/popup.html`);
    const took = await until(browser, pop.sessionId, "document.documentElement.dataset.accent === 'sapphire' && document.documentElement.dataset.theme === 'light'", 8000);
    await sleep(700);
    await shot(browser, pop.sessionId, 'look-companion-sapphire-light');
    const cached = await pe("chrome.storage.local.get('look').then((r) => r.look)");
    result('look: the companion\'s popup takes the look the Windows app chose, from its server on this computer, and keeps it for the marks',
      Boolean(took) && cached && cached.accent === 'sapphire' && /^#[0-9a-f]{6}$/.test(cached.metal.face) && cached.live.rgb === L.ramp('sapphire', 'dark')['--live-rgb'], { cached });
    fs.writeFileSync(lookFile, JSON.stringify({ mode: 'dark', accent: 'teal', at: { mode: Date.now(), accent: Date.now() } }));
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: "document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive' && !window.__firstLook) window.__firstLook = document.documentElement.dataset.accent; });" }, pop.sessionId);
    await goto(browser, pop.sessionId, `chrome-extension://${id}/src/popup.html`);
    const firstPop = await pe('window.__firstLook');
    const changed = await until(browser, pop.sessionId, "document.documentElement.dataset.accent === 'teal'", 8000);
    await sleep(700);
    await shot(browser, pop.sessionId, 'look-companion-teal-dark');
    result('look: the popup opens in the look it kept (no gold first), then follows a change made in the app', firstPop === 'sapphire' && Boolean(changed), { firstPop });
  } finally {
    delete process.env.SENTINEL_LOOK_FILE;
    await close();
    files.server.close();
    await sentinel.stop();
    try { fs.rmSync(lookDir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkLook;
