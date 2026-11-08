'use strict';
/**
 * protection  The Live protection board as a person reads it (app.js protectionView, guards.js): every guard on one
 *             board, one line each, its state read from what the app says is really running. Only the Electron bridge
 *             is a stand-in, and it answers as the app does: a switch flips what is stored, and what runs is reported
 *             apart from it. Cases: scanning stopped with auto scanning and downloads off (no row may say On that is
 *             not running), a folder that cannot be watched (partly protected), a switch pressed, a live event, and
 *             the page outside the app on Windows, with the app signed in to the account, and on a phone (never
 *             "Needs app"). Pictures: protection-<case>-<size>-<theme>.png.
 */
const { sleep, result, launch, evalIn, openPage, goto, startServer, watchErrors, until, shot, clickSel } = require('./_shared');

const SIZES = { phone: [390, 844, true], desktop: [1366, 900, false] };
const THEMES = ['dark', 'light'];
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

/** What desktop.info() answers: live scanning stopped, auto scanning off, download protection switched off. */
const stopped = () => ({
  version: '1.19.2', platform: 'win32', embeddedServer: true, origin: 'http://127.0.0.1:47821', openAtLogin: true, clipboardCheck: false, commandShield: true, walletGuard: true,
  exposureAlerts: true, mySites: true, autoScan: false, liveMode: 'fast',
  live: { supported: true, enabled: false, active: false, reason: 'Off', counts: { checked: 0, flagged: 0 } },
  downloads: { enabled: false, active: false, reason: 'Download protection: turned off', folder: 'C:\\Users\\Sam\\Downloads' },
  defense: { supported: true, enabled: true, active: true, reason: null, watched: ['Downloads', 'Desktop'] },
  chatSafety: { supported: true, enabled: true, running: true, seen: {} },
  textSafety: { supported: true, enabled: false, running: false, seen: {} },
  remoteGuard: { supported: true, enabled: true, trusted: [] },
  scanMenu: { supported: true, enabled: false },
  snip: { supported: true, enabled: true, registered: true, key: 'cs', keys: [{ id: 'cs', label: 'Ctrl+Shift+S' }, { id: 'ca', label: 'Ctrl+Alt+S' }] },
  browsers: { installed: [{ id: 'chrome', name: 'Google Chrome' }, { id: 'edge', name: 'Microsoft Edge' }], running: ['chrome'] },
  update: { status: 'current', supported: true }
});

/** The bridge, as the app answers: setters change what is stored, and downloads then really run. */
const standIn = (info) => `(() => {
  const info = ${JSON.stringify(info)};
  const cb = {};
  window.__info = info; window.__cb = cb; window.__calls = [];
  const known = {
    info: async () => JSON.parse(JSON.stringify(info)),
    recentDownloads: async () => [], defense: async () => ({ ledger: [] }), exposures: async () => [], mySites: async () => [],
    lockStatus: async () => ({ supported: false }),
    setDownloadProtection: async (on) => { window.__calls.push(['downloads', on]); info.downloads = { ...info.downloads, enabled: on, active: on, reason: on ? null : 'Download protection: turned off' }; return info.downloads; },
    liveStart: async () => { window.__calls.push(['live', true]); info.live = { ...info.live, enabled: true, active: true, reason: null }; return info.live; }
  };
  window.sentinelDesktop = new Proxy(known, { get: (k, name) => k[name] || (typeof name === 'string' && /^on[A-Z]/.test(name) ? (fn) => { cb[name] = fn; return () => {}; } : typeof name === 'string' && /^set[A-Z]/.test(name) ? async () => ({}) : undefined) });
})();`;

// Every row as it reads: id, its state class, the word and the line.
const ROWS = `[...document.querySelectorAll('.board .guard')].map((li) => ({ id: li.dataset.row, cls: li.className, word: (li.querySelector('[data-word]') || {}).textContent || '', line: (li.querySelector('.guard__line') || {}).textContent || '', on: (li.querySelector('[data-guard]') || {}).checked }))`;
const HEAD = `({ level: document.querySelector('.board').dataset.level, headline: document.querySelector('.board__say h2').textContent, sub: document.querySelector('.board__say p').textContent, wide: document.documentElement.scrollWidth - innerWidth, text: document.querySelector('#view').innerText })`;

async function pictures(browser, s, url, name, ready, after) {
  const wide = [];
  for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
    for (const theme of THEMES) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
      await goto(browser, s, url);
      await until(browser, s, ready, 20000);
      const w = await evalIn(browser, s, 'document.documentElement.scrollWidth - innerWidth');
      if (w > 0) wide.push(`${name} ${size} ${theme}: ${w} px`);
      await evalIn(browser, s, "document.querySelector('.board').scrollIntoView({ block: 'start' })");
      await sleep(300);
      await shot(browser, s, `protection-${name}-${size}-${theme}`);
      if (after) await after(size, theme);
    }
  }
  return wide;
}

async function checkProtection() {
  const server = await startServer('protection');
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await browser.send('Emulation.setUserAgentOverride', { userAgent: WINDOWS_UA }, s);
    await goto(browser, s, `${server.base}/login`);
    const email = `protection-${Date.now()}@example.com`;
    const password = 'Protection-Check-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });
    await api('/billing/plan', { plan: 'max' });
    const url = `${server.base}/app/protection`;
    const wide = [];

    /* ---------------------------------------------- outside the app, on Windows, nothing known */
    const away = 'document.querySelector(\'.board[data-level="away"] .guard\')';
    wide.push(...await pictures(browser, s, url, 'away', away));
    let seen = await evalIn(browser, s, `(() => { const h = ${HEAD}; return { ...h, words: document.querySelectorAll('.board [data-word], .board [data-guard]').length, rows: document.querySelectorAll('.board .guard').length, download: [...document.querySelectorAll('.board a')].map((a) => a.textContent) }; })()`);
    result('protection: outside the app it says to open the page in the app, not "Needs app"', seen.headline === 'Open this page in the Sentinel app' && !/Needs app|Download Sentinel/.test(seen.text) && seen.download.join('|') === 'Not installed yet? Get it for Windows', seen);
    result('protection: outside the app every guard is listed with no state and no switch', seen.rows >= 12 && seen.words === 0 && !/\bOn\b/.test(seen.text.split('Pages, searches')[1] || 'On'), seen);

    /* ---------------------------------------------- outside the app, the app signed in to this account */
    await api('/auth/client-token', { client: 'desktop' });
    await goto(browser, s, url);
    await until(browser, s, away, 20000);
    seen = await evalIn(browser, s, HEAD);
    result('protection: with the app signed in to the account, it says so and offers no download', seen.headline === 'Open this page in the Sentinel app' && /signed in to your account and was last active/.test(seen.sub) && !/Get it for Windows/.test(seen.text), seen.sub);
    await shot(browser, s, 'protection-away-signedin-desktop-dark');

    /* ---------------------------------------------- outside the app, on a phone */
    await browser.send('Emulation.setUserAgentOverride', { userAgent: PHONE_UA }, s);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
    await goto(browser, s, url);
    await until(browser, s, away, 20000);
    seen = await evalIn(browser, s, HEAD);
    result('protection: on a phone it says where protection runs, never "Open this page in the app"', seen.headline === 'Live protection runs on a Windows computer' && !/Needs app/.test(seen.text), seen.headline);
    await shot(browser, s, 'protection-away-phone-phone-dark');
    await browser.send('Emulation.setUserAgentOverride', { userAgent: WINDOWS_UA }, s);

    /* ---------------------------------------------- in the app: scanning stopped, downloads off */
    const ready = "document.querySelector('.board .guard[data-row=\"live\"]')";
    let script = await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: standIn(stopped()) }, s);
    wide.push(...await pictures(browser, s, url, 'stopped', ready, async (size, theme) => {
      if (size !== 'desktop' || theme !== 'dark') return;
      // The live row opened, as a person opens it: its own few settings and what it never does.
      await clickSel(browser, s, '[data-guard-open="live"]');
      await sleep(700);
      await evalIn(browser, s, "document.querySelector('#guard-live').scrollIntoView({ block: 'start' })");
      await shot(browser, s, 'protection-open-desktop-dark');
    }));
    const rows = Object.fromEntries((await evalIn(browser, s, ROWS)).map((r) => [r.id, r]));
    const head = await evalIn(browser, s, HEAD);
    const notOn = ['live', 'downloads', 'remote', 'exposure', 'texts', 'scanMenu', 'clip'];
    result('protection: no row says On for a guard that is not running', notOn.every((id) => rows[id] && rows[id].word !== 'On' && !/\bis-on\b/.test(rows[id].cls)), notOn.map((id) => rows[id]));
    result('protection: a guard waiting on live scanning says so and offers to start it', ['remote', 'exposure'].every((id) => rows[id].word === 'Waiting' && rows[id].line === 'Works while live scanning is on')
      && Boolean(await evalIn(browser, s, "document.querySelector('#guard-remote [data-guard-fix=\"live\"]')")), [rows.remote, rows.exposure]);
    result('protection: running guards say On, with what they are doing', rows.defense.word === 'On' && rows.chat.word === 'On' && rows.defense.line === 'Startup programs are watched', [rows.defense, rows.chat]);
    result('protection: the headline counts as the tray does', head.level === 'on' && head.headline === 'Protection is on' && head.sub === '2 of 5 protections are running.', head);
    result('protection: no "Needs app" and no old feature cards or meters in the app', !/Needs app|Optional add-on|Live scanning this week/.test(head.text) && !(await evalIn(browser, s, "document.querySelector('.feature-grid, .meters, .live__main')")), head.text.slice(0, 300));

    // A switch pressed: the app is asked, and the row then says what really runs.
    await clickSel(browser, s, '[data-guard="downloads"]');
    const after = await until(browser, s, "(() => { const li = document.querySelector('#guard-downloads'); return li && /is-on/.test(li.className) && li.querySelector('[data-word]').textContent; })()", 8000);
    const calls = await evalIn(browser, s, 'window.__calls');
    result('protection: pressing a switch asks the app, and the row follows what it reports', after === 'On' && JSON.stringify(calls) === JSON.stringify([['downloads', true]]), { after, calls });

    // A live event from the app (live scanning started from the tray): repainted in place, headline included.
    await evalIn(browser, s, "document.querySelector('[data-guard-open=\"chat\"]').focus()");
    await evalIn(browser, s, "(() => { window.__info.live = { ...window.__info.live, enabled: true, active: true, window: { x: 0 }, reason: null }; window.__cb.onLive(window.__info.live); })()");
    const live = await until(browser, s, `(() => { const r = document.querySelector('#guard-live'); return r && r.querySelector('[data-word]').textContent === 'On' && { line: r.querySelector('.guard__line').textContent, head: document.querySelector('.board__say p').textContent, focus: document.activeElement.dataset.guardOpen, remote: document.querySelector('#guard-remote [data-word]').textContent }; })()`, 8000);
    result('protection: a live event repaints the row and the headline in place, focus kept', live && live.line === 'Watching the browser in front' && live.head === '4 of 5 protections are running.' && live.focus === 'chat' && live.remote === 'On', live);

    /* ---------------------------------------------- in the app: a folder that cannot be watched */
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier }, s);
    const trouble = stopped();
    trouble.downloads = { enabled: true, active: false, reason: 'Cannot watch the Downloads folder', folder: 'C:\\Users\\Sam\\Downloads' };
    script = await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: standIn(trouble) }, s);
    wide.push(...await pictures(browser, s, url, 'partly', ready));
    const p = await evalIn(browser, s, HEAD);
    const dl = Object.fromEntries((await evalIn(browser, s, ROWS)).map((r) => [r.id, r])).downloads;
    result('protection: switched on but not working is said, with the reason, and the board is partly protected', p.level === 'partly' && p.headline === 'Partly protected' && p.sub === 'Downloads is not working right now.' && dl.word === 'Not working' && dl.line === 'Cannot watch the Downloads folder' && dl.on === true, { p: { ...p, text: '' }, dl });
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier }, s);

    result('protection: nothing scrolls sideways', !wide.length, wide);
    result('protection: no errors on the page', !errors.length, errors);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkProtection;
