'use strict';
/**
 * settings  The one Settings home (/app/settings) as a person uses it: every group and row there, with the Windows
 *           app and without it; a search that finds a row and one that finds nothing; old addresses
 *           (/app/protection#chat-safety, /app/security) landing on their row; an unknown address ignored; a save that
 *           works and one the app refuses, which puts the switch back. Only the Electron bridge is a stand-in.
 *           Pictures: settings-<state>-<size>-<theme>.png.
 */
const { sleep, result, launch, evalIn, openPage, goto, startServer, watchErrors, until, shot } = require('./_shared');

const SIZES = { desktop: [1366, 900, false], phone: [390, 844, true] };
const THEMES = ['dark', 'light'];
const REFUSED = 'Parent lock is on. Enter the PIN to switch this off.';

/** The app's bridge to Electron: what Settings reads, and setters that remember (one refuses, as a parent lock would). */
const standIn = `(() => {
  const info = { version: '1.20.0', platform: 'win32', embeddedServer: true, liveMode: 'fast', autoScan: true, openAtLogin: true,
    live: { supported: true, enabled: true, active: false }, downloads: { active: true, folder: 'C:\\\\Users\\\\Sam\\\\Downloads' },
    defense: { supported: true, active: true, watched: ['Downloads'] }, mySites: true, scanMenu: { supported: true, enabled: false },
    clipboardCheck: true, commandShield: true, walletGuard: false, remoteGuard: { supported: true, enabled: true, trusted: [] },
    snip: { supported: true, enabled: true, registered: true, key: 'ctrl-shift-s', keys: [{ id: 'ctrl-shift-s', label: 'Ctrl + Shift + S' }] },
    chatSafety: { supported: true, enabled: false }, textSafety: { supported: true, enabled: false }, exposureAlerts: false, weekRecap: true,
    update: { status: 'current', supported: true }, marksLevel: 'all', warningsLevel: 'all' };
  const field = { setClipboardCheck: 'clipboardCheck', setWeekRecap: 'weekRecap', setOpenAtLogin: 'openAtLogin', setMarksLevel: 'marksLevel', setWarningsLevel: 'warningsLevel' };
  window.__calls = [];
  const known = {
    info: async () => JSON.parse(JSON.stringify(info)),
    mySites: async () => [{ host: 'mycu.org', source: 'you' }],
    lockStatus: async () => ({ supported: true, set: false, record: [] }), checkUpdates: async () => ({ status: 'current' }),
    recentDownloads: async () => [], defense: async () => ({ ledger: [] }), exposures: async () => []
  };
  window.sentinelDesktop = new Proxy(known, { get: (k, name) => {
    if (k[name]) return k[name];
    if (typeof name !== 'string') return undefined;
    if (/^on[A-Z]/.test(name)) return () => () => {};
    if (/^set[A-Z]/.test(name)) return async (v) => {
      window.__calls.push([name, v]);
      if (name === 'setWalletGuard' || (name === 'setWarningsLevel' && v === 'quiet')) throw new Error(${JSON.stringify(REFUSED)});
      if (field[name]) info[field[name]] = v;
      return /Level$/.test(name) ? v : {};
    };
    return undefined;
  } });
})();`;

const ROWS = "[...document.querySelectorAll('[data-set-row]')]";
const SHOWN = `${ROWS}.filter((r) => !r.classList.contains('is-out')).map((r) => r.id)`;

async function checkSettings() {
  const server = await startServer('settings');
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await goto(browser, s, `${server.base}/login`);
    const email = `settings-${Date.now()}@example.com`;
    const password = 'Settings-Check-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });
    await api('/billing/plan', { plan: 'max' });

    /* --------------------------------------------------- without the app */
    const ready = "document.querySelectorAll('[data-set-row]').length > 20 && !document.querySelector('.set-skel') && document.querySelector('[data-sessions] .list')";
    const wide = [];
    let bare = null;
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        await goto(browser, s, `${server.base}/app/settings`);
        await until(browser, s, ready, 20000);
        bare = await evalIn(browser, s, `(() => ({ rows: ${ROWS}.length, shown: ${SHOWN}.length, on: document.querySelectorAll('[data-set-row] .switch:checked').length,
          switches: document.querySelectorAll('[data-set-row] .switch').length, why: [...document.querySelectorAll('.set-why')].map((e) => e.textContent),
          wide: document.documentElement.scrollWidth - innerWidth, download: Boolean(document.querySelector('.set-app a[href="/download"]')) }))()`);
        if (bare.wide > 0) wide.push(`no app ${size} ${theme}: ${bare.wide} px`);
        await sleep(300);
        await shot(browser, s, `settings-noapp-${size}-${theme}`);
      }
    }
    result('settings: without the app every row is still there, none hidden', bare.rows >= 25 && bare.shown === bare.rows, bare);
    result('settings: without the app no switch says on, and each one that needs the app says so', bare.on === 0 && bare.switches >= 15
      && bare.why.filter((w) => w === 'Needs the Sentinel app for Windows.').length >= bare.switches && bare.download, bare);

    /* ------------------------------------------------------ with the app */
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: standIn }, s);
    let home = null;
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        await goto(browser, s, `${server.base}/app/settings`);
        await until(browser, s, ready, 20000);
        await sleep(300);
        home = await evalIn(browser, s, `(() => { const on = (id) => (document.querySelector('#set-' + id + '-c') || {}).checked;
          return { on: { copied: on('copied-links'), wallet: on('wallet-guard'), chat: on('chat-safety'), login: on('start-with-computer') },
            why: [...document.querySelectorAll('.set-why')].map((e) => e.textContent), wide: document.documentElement.scrollWidth - innerWidth,
            rail: [...document.querySelectorAll('.set-rail a')].map((a) => a.textContent), sites: (document.querySelector('#my-sites .list') || {}).innerText || '',
            said: ['[data-chat-seen]', '[data-text-seen]'].map((q) => { const e = document.querySelector(q); return e ? e.getAttribute('role') + ': ' + e.textContent : 'none'; }) }; })()`);
        if (home.wide > 0) wide.push(`home ${size} ${theme}: ${home.wide} px`);
        await shot(browser, s, `settings-home-${size}-${theme}`);

        await evalIn(browser, s, "(() => { const f = document.querySelector('[data-set-find]'); f.focus(); f.value = 'roblox'; f.dispatchEvent(new Event('input', { bubbles: true })); })()");
        await sleep(700);
        const found = await evalIn(browser, s, `(() => ({ shown: ${SHOWN}, said: document.querySelector('[data-set-count]').textContent, none: document.querySelector('[data-set-none]').hidden }))()`);
        result(`settings: "roblox" finds chat safety and only it (${size}, ${theme})`, found.shown.join() === 'chat-safety' && found.none && /1 setting shown/.test(found.said), found);
        await shot(browser, s, `settings-search-${size}-${theme}`);

        await evalIn(browser, s, "(() => { const f = document.querySelector('[data-set-find]'); f.value = 'zzqx'; f.dispatchEvent(new Event('input', { bubbles: true })); })()");
        await sleep(700);
        const nothing = await evalIn(browser, s, `(() => ({ shown: ${SHOWN}.length, none: document.querySelector('[data-set-none]').hidden, text: document.querySelector('[data-set-none]').innerText, title: document.querySelector('#view h1').textContent, find: Boolean(document.querySelector('[data-set-find]').getBoundingClientRect().height) }))()`);
        result(`settings: a search with no match says so and offers to clear it, never a blank page (${size}, ${theme})`, nothing.shown === 0 && !nothing.none && /Nothing matches/.test(nothing.text) && /Clear search/.test(nothing.text) && nothing.title === 'Settings' && nothing.find, nothing);
        await shot(browser, s, `settings-none-${size}-${theme}`);
        await evalIn(browser, s, "document.querySelector('[data-set-clear]').click()");
        const back = await evalIn(browser, s, `${SHOWN}.length === ${ROWS}.length && document.activeElement === document.querySelector('[data-set-find]')`);
        result(`settings: Clear search brings every row back and keeps the cursor in the box (${size}, ${theme})`, back === true, back);
      }
    }
    result('settings: with the app the switches say what the app says', home.on.copied === true && home.on.wallet === false && home.on.chat === false && home.on.login === true && !home.why.length, home);
    result('settings: what chat safety and Check my texts are doing is read out as it changes', home.said.every((t) => /^status: Off. Turn it on/.test(t)), home.said);
    result('settings: the group list names every group, and your sites are listed', home.rail.length === 9 && /Appearance/.test(home.rail[0]) && /Motion/.test(home.rail[1]) && /mycu\.org/.test(home.sites), home);
    result('settings: nothing scrolls sideways', !wide.length, wide);

    /* -------------------------------------------------- saving, at desktop size */
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, s);
    await goto(browser, s, `${server.base}/app/settings`);
    await until(browser, s, ready, 20000);
    await evalIn(browser, s, "document.querySelector('#set-copied-links-c').click()");
    await sleep(900);
    const saved = await evalIn(browser, s, "({ checked: document.querySelector('#set-copied-links-c').checked, calls: window.__calls, toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ') })");
    result('settings: a switch is saved the moment it is pressed, and stays as pressed', saved.checked === false && saved.calls.some(([n, v]) => n === 'setClipboardCheck' && v === false) && /Check links I copy is off/.test(saved.toast), saved);
    await evalIn(browser, s, "document.querySelector('#set-wallet-guard-c').click()");
    await sleep(900);
    const refused = await evalIn(browser, s, "({ checked: document.querySelector('#set-wallet-guard-c').checked, disabled: document.querySelector('#set-wallet-guard-c').disabled, toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ') })");
    result('settings: a save the app refuses puts the switch back and says why', refused.checked === false && !refused.disabled && refused.toast.includes('Parent lock is on'), refused);

    /* ------------------------- marks beside links and pop-up warnings, as a person sets them */
    const level = (row) => `(() => { const r = document.getElementById(${JSON.stringify(row)}); return { pressed: [...r.querySelectorAll('[data-seg][aria-pressed="true"]')].map((b) => b.textContent),
      buttons: [...r.querySelectorAll('[data-seg]')].map((b) => b.textContent), state: r.querySelector('[data-set-state]').textContent,
      fits: [...r.querySelectorAll('[data-seg]')].every((b) => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= innerWidth),
      toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ') }; })()`;
    const press = (row, word) => evalIn(browser, s, `[...document.querySelectorAll('#${row} [data-seg]')].find((b) => b.textContent === ${JSON.stringify(word)}).click()`);
    const first = { marks: await evalIn(browser, s, level('marks-beside-links')), warnings: await evalIn(browser, s, level('pop-up-warnings')) };
    result('settings: marks beside links and pop-up warnings start where they always were: every link, always',
      first.marks.pressed.join() === 'Every link' && first.warnings.pressed.join() === 'Always' && first.marks.buttons.join() === 'Every link,Risky links,Serious only' && first.warnings.buttons.join() === 'Always,Danger only,Never', first);
    await press('marks-beside-links', 'Serious only');
    await sleep(900);
    const marksSet = await evalIn(browser, s, level('marks-beside-links'));
    result('settings: "Serious only" is saved through the app and says the island still counts every link',
      marksSet.pressed.join() === 'Serious only' && /island still counts every link/.test(marksSet.state) && /Only warning and danger links get a mark/.test(marksSet.toast)
      && (await evalIn(browser, s, "window.__calls.some(([n, v]) => n === 'setMarksLevel' && v === 'danger')")), marksSet);
    await press('pop-up-warnings', 'Danger only');
    await sleep(900);
    await press('pop-up-warnings', 'Never');
    await sleep(900);
    const quietRefused = await evalIn(browser, s, level('pop-up-warnings'));
    result('settings: "Never" refused by the parent lock stays on "Danger only" and says why',
      quietRefused.pressed.join() === 'Danger only' && quietRefused.toast.includes('Parent lock is on') && /without a notification or a card/.test(quietRefused.state), quietRefused);
    const fit = [];
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        await goto(browser, s, `${server.base}/app/settings`);
        await until(browser, s, ready, 20000);
        for (const [row, name] of [['marks-beside-links', 'marks'], ['pop-up-warnings', 'warnings']]) {
          await evalIn(browser, s, `document.getElementById(${JSON.stringify(row)}).scrollIntoView({ block: 'center' })`);
          await sleep(300);
          const r = await evalIn(browser, s, level(row));
          if (!r.fits) fit.push(`${row} ${size} ${theme}`);
          await shot(browser, s, `settings-${name}-${size}-${theme}`);
        }
      }
    }
    result('settings: the three choices fit whole on a phone and on a computer, in both themes', !fit.length, fit);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, s);

    /* ------------------------------------------------------- old addresses */
    await goto(browser, s, `${server.base}/app/protection#chat-safety`);
    await until(browser, s, `location.pathname === '/app/settings' && ${ready}`, 20000);
    await sleep(1200);
    const alias = await evalIn(browser, s, "(() => { const r = document.getElementById('chat-safety'); return { at: location.pathname + location.hash, top: Math.round(r.getBoundingClientRect().top), found: r.classList.contains('is-found') }; })()");
    result('settings: /app/protection#chat-safety opens Settings at chat safety', alias.at === '/app/settings#chat-safety' && alias.top >= 0 && alias.top < 200 && alias.found, alias);
    await shot(browser, s, 'settings-alias-desktop-dark');
    await goto(browser, s, `${server.base}/app/security`);
    await until(browser, s, `location.pathname === '/app/settings' && ${ready}`, 20000);
    await sleep(1200);
    const account = await evalIn(browser, s, "({ at: location.pathname + location.hash, top: Math.round(document.getElementById('account').getBoundingClientRect().top), twoFactor: Boolean(document.querySelector('[data-2fa] [data-setup]')) })");
    result('settings: /app/security opens the account group, two-factor ready to set up', account.at === '/app/settings#account' && account.top < 200 && account.twoFactor, account);
    await goto(browser, s, `${server.base}/app/settings?from=old#not-a-setting`);   // a new page, not a jump within this one
    await until(browser, s, ready, 20000);
    await sleep(800);
    const stale = await evalIn(browser, s, '({ y: scrollY, found: document.querySelectorAll(".is-found").length })');
    result('settings: an unknown address is ignored', stale.y === 0 && stale.found === 0, stale);

    /* ---------------------------------------------- the palette finds one setting */
    await evalIn(browser, s, "document.querySelector('[data-palette]').click()");
    await evalIn(browser, s, "(() => { const i = document.querySelector('.palette input'); i.value = 'wallet'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
    const options = await evalIn(browser, s, "[...document.querySelectorAll('.palette__list [role=option]')].map((o) => o.innerText.replace(/\\s+/g, ' ').trim())");
    result('settings: the search palette finds a single setting by its words', options.some((o) => /Wallet guard/.test(o) && /Setting/.test(o)), options);

    result('settings: no errors on the page', !errors.length, errors);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkSettings;
