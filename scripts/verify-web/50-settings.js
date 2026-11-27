'use strict';
/**
 * settings  The one Settings home (/app/settings) as a person uses it: every group and row there, with the Windows
 *           app and without it; a search that finds a row and one that finds nothing; old addresses
 *           (/app/protection#chat-safety, /app/security) landing on their row; an unknown address ignored; a save that
 *           works and one the app refuses, which puts the switch back. Only the Electron bridge is a stand-in.
 *           Pictures: settings-<state>-<size>-<theme>.png.
 */
const { sleep, result, launch, evalIn, openPage, goto, startServer, watchErrors, until, shot, pressKey } = require('./_shared');

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
/** Opens a section or a row as a link to it would: the address changes and the page answers, with no reload. */
const open = (browser, s, id) => evalIn(browser, s, `(() => { history.pushState({}, '', '/app/settings#${id}'); dispatchEvent(new PopStateEvent('popstate')); })()`);
const SECTIONS = ['look', 'protection', 'account', 'plan', 'data', 'help'];

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
    const ready = "document.querySelectorAll('[data-set-row]').length > 20 && !document.querySelector('.set-skel') && document.querySelector('[data-sessions] > .list')";
    const wide = [];
    let bare = null;
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        await goto(browser, s, `${server.base}/app/settings`);
        await until(browser, s, ready, 20000);
        bare = await evalIn(browser, s, `(() => ({ rows: ${ROWS}.length, shown: ${SHOWN}.length, on: document.querySelectorAll('[data-set-row] .switch:checked').length,
          switches: document.querySelectorAll('[data-set-row] .switch:not(#set-simple-view-c)').length, why: [...document.querySelectorAll('.set-why')].map((e) => e.textContent),
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
    let trust = null;
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

        // Your data and Help, each brought to the top as a link to it would. What changed is read from the download page.
        for (const g of SECTIONS) {
          await open(browser, s, g);
          await until(browser, s, ready, 20000);
          if (g === 'help') await until(browser, s, "document.querySelector('#whats-new .set-note, #whats-new .set-sub')", 10000);
          await sleep(400);
          await shot(browser, s, `settings-${g}-${size}-${theme}`);
        }
        trust = await evalIn(browser, s, `(() => ({ data: [...document.querySelectorAll('#data [data-set-row]')].map((r) => r.id),
          note: (document.querySelector('#whats-new .set-note') || {}).innerText || '', mail: (document.querySelector('#support a.btn') || {}).href || '',
          account: [...document.querySelectorAll('#account [data-set-row]')].map((r) => r.id) }))()`);

        // The search belongs to the list (a phone's section page has none): back to it, as the link back does.
        await evalIn(browser, s, "(() => { history.pushState({}, '', '/app/settings'); dispatchEvent(new PopStateEvent('popstate')); })()");
        await until(browser, s, ready, 20000);
        await sleep(300);
        await evalIn(browser, s, "(() => { const f = document.querySelector('[data-set-find]'); f.focus(); f.value = 'roblox'; f.dispatchEvent(new Event('input', { bubbles: true })); })()");
        await sleep(700);
        const found = await evalIn(browser, s, `(() => ({ shown: ${SHOWN}, said: document.querySelector('[data-set-count]').textContent, none: document.querySelector('[data-set-none]').hidden }))()`);
        result(`settings: "roblox" finds chat safety and only it (${size}, ${theme})`, found.shown.join() === 'chat-safety' && found.none && /1 setting shown/.test(found.said), found);
        await shot(browser, s, `settings-search-${size}-${theme}`);

        // Typed from far down the page, as the sticky search is used: the answer must be on screen where the person
        // is looking, above a phone's bottom bar, not somewhere they have to scroll to.
        await evalIn(browser, s, "(() => { scrollTo(0, document.documentElement.scrollHeight); const f = document.querySelector('[data-set-find]'); f.value = 'zzqx'; f.dispatchEvent(new Event('input', { bubbles: true })); })()");
        await sleep(700);
        const nothing = await evalIn(browser, s, `(() => { const side = document.querySelector('.side'); const floor = side && getComputedStyle(side).position === 'fixed' ? side.getBoundingClientRect().top : innerHeight;
          const on = (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= floor; };
          return { shown: ${SHOWN}.length, none: document.querySelector('[data-set-none]').hidden, text: document.querySelector('[data-set-none]').innerText, title: document.querySelector('#view h1').textContent,
            find: on(document.querySelector('[data-set-find]')), seen: on(document.querySelector('[data-set-none] p')) && on(document.querySelector('[data-set-clear]')), floor, y: scrollY }; })()`);
        result(`settings: a search with no match says so and offers to clear it, never a blank page (${size}, ${theme})`, nothing.shown === 0 && !nothing.none && /Nothing matches/.test(nothing.text) && /Clear search/.test(nothing.text) && nothing.title === 'Settings', nothing);
        result(`settings: typed from far down the page, the box, "Nothing matches" and Clear search are all on screen (${size}, ${theme})`, nothing.find && nothing.seen, nothing);
        await shot(browser, s, `settings-none-${size}-${theme}`);
        await evalIn(browser, s, "document.querySelector('[data-set-clear]').click()");
        const back = await evalIn(browser, s, `${SHOWN}.length === ${ROWS}.length && document.activeElement === document.querySelector('[data-set-find]')`);
        result(`settings: Clear search brings every row back and keeps the cursor in the box (${size}, ${theme})`, back === true, back);
      }
    }

    /* ------------------------------------------- the / key, on Settings and elsewhere */
    const slash = async (path) => {
      await goto(browser, s, `${server.base}${path}`, path === '/app/settings' ? ready : "document.querySelector('[data-check-text], .scanbox input')");
      await evalIn(browser, s, 'document.activeElement && document.activeElement.blur()');
      await pressKey(browser, s, '/');
      await sleep(200);
      return evalIn(browser, s, "(() => { const a = document.activeElement; return a ? (a.matches('[data-set-find]') ? 'settings search' : a.matches('[data-check-text], .scanbox input') ? 'scan box' : a.tagName) : 'none'; })()");
    };
    const slashed = { settings: await slash('/app/settings'), check: await slash('/app/check') };
    result('settings: the / key goes to the Settings search on Settings, and to the scan box elsewhere', slashed.settings === 'settings search' && slashed.check === 'scan box', slashed);
    result('settings: with the app the switches say what the app says', home.on.copied === true && home.on.wallet === false && home.on.chat === false && home.on.login === true && !home.why.length, home);
    result('settings: what chat safety and Check my texts are doing is read out as it changes', home.said.every((t) => /^status: Off. Turn it on/.test(t)), home.said);
    result('settings: Your data holds download, history, what live scanning remembers and delete, and Account no longer holds delete',
      trust.data.join() === 'download-data,history-data,live-memory,delete-account' && !trust.account.includes('delete-account'), trust);
    // Before launch the mailbox's domain does not exist, so the way to write is the GitHub page, where a message arrives.
    result('settings: Help shows the newest release note and a way to write to us that works today', /New in Sentinel \d+\.\d+\.\d+/.test(trust.note) && /^https:\/\/github\.com\/zzilinct\/Sentinel\/issues/.test(trust.mail), trust);
    result('settings: the section list names every section, and your sites are listed', home.rail.length === 6 && /Appearance/.test(home.rail[0]) && /Protection/.test(home.rail[1]) && /mycu\.org/.test(home.sites), home);
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
    const first = { marks: await evalIn(browser, s, level('marks-beside-links')), warnings: await evalIn(browser, s, level('warn-level')) };
    result('settings: marks beside links and pop-up warnings start where they always were: every link, always',
      first.marks.pressed.join() === 'Every link' && first.warnings.pressed.join() === 'Always' && first.marks.buttons.join() === 'Every link,Risky links,Serious only' && first.warnings.buttons.join() === 'Always,Danger only,Never', first);
    await press('marks-beside-links', 'Serious only');
    await sleep(900);
    const marksSet = await evalIn(browser, s, level('marks-beside-links'));
    result('settings: "Serious only" is saved through the app and says the island still counts every link',
      marksSet.pressed.join() === 'Serious only' && /island still counts every link/.test(marksSet.state) && /Only warning and danger links get a mark/.test(marksSet.toast)
      && (await evalIn(browser, s, "window.__calls.some(([n, v]) => n === 'setMarksLevel' && v === 'danger')")), marksSet);
    await press('warn-level', 'Danger only');
    await sleep(900);
    await press('warn-level', 'Never');
    await sleep(900);
    const quietRefused = await evalIn(browser, s, level('warn-level'));
    result('settings: "Never" refused by the parent lock stays on "Danger only" and says why',
      quietRefused.pressed.join() === 'Danger only' && quietRefused.toast.includes('Parent lock is on') && /without a notification or a card/.test(quietRefused.state), quietRefused);
    const fit = [];
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        await goto(browser, s, `${server.base}/app/settings`);
        await until(browser, s, ready, 20000);
        for (const [row, name] of [['marks-beside-links', 'marks'], ['warn-level', 'warnings']]) {
          await open(browser, s, row);
          await sleep(200);
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
    result('settings: /app/security opens the account group, two-factor ready to set up', account.at === '/app/settings#account' && account.top >= 0 && account.top < 400 && account.twoFactor, account);
    await goto(browser, s, `${server.base}/app/settings?from=old#not-a-setting`);   // a new page, not a jump within this one
    await until(browser, s, ready, 20000);
    await sleep(800);
    const stale = await evalIn(browser, s, '({ y: scrollY, found: document.querySelectorAll(".is-found").length })');
    result('settings: an unknown address is ignored', stale.y === 0 && stale.found === 0, stale);

    /* ----------------------------------------------- one section at a time, and every old address still lands */
    const seen = `(() => { const e = document.getElementById(%ID%); const r = e.getBoundingClientRect(); return { open: [...document.querySelectorAll('.set-sec:not([hidden])')].map((x) => x.dataset.setSec).join(), top: Math.round(r.top), h: Math.round(r.height), vh: innerHeight }; })()`;
    // Each address the app, the tray, notifications and the website use, with the section it must open.
    const LINKS = { look: 'look', accent: 'look', motion: 'look', 'simple-view': 'look', 'text-size': 'look', moving: 'look', protection: 'protection', 'chat-safety': 'protection', 'text-safety': 'protection',
      'my-sites': 'protection', 'exposure-alerts': 'protection', 'week-note': 'protection', guards: 'protection', account: 'account', 'two-factor': 'account', 'parent-lock': 'account', plan: 'plan',
      data: 'data', 'delete-account': 'data', help: 'help', 'whats-new': 'help' };
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
      await goto(browser, s, `${server.base}/app/settings`);
      await until(browser, s, ready, 20000);
      const lost = [];
      for (const [id, sec] of Object.entries(LINKS)) {
        await open(browser, s, id);
        await until(browser, s, `document.querySelector('.set-sec:not([hidden])') && document.getElementById('${id}').getBoundingClientRect().height > 0`, 5000);
        await sleep(150);
        const at = await evalIn(browser, s, seen.replace('%ID%', JSON.stringify(id)));
        if (at.open !== sec || at.h <= 0 || at.top < 0 || at.top >= at.vh) lost.push({ id, want: sec, ...at });
      }
      result(`settings: every old address (${Object.keys(LINKS).length} of them) opens its own section only, with its row on screen (${size})`, !lost.length, lost);
    }

    // Wide: opens on Appearance, the list sits beside the page, a press opens a section in place and leaves no history entry.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await goto(browser, s, `${server.base}/app/settings`);
    await until(browser, s, ready, 20000);
    const wideOpen = await evalIn(browser, s, "({ open: [...document.querySelectorAll('.set-sec:not([hidden])')].map((x) => x.dataset.setSec).join(), here: document.querySelector('.set-rail [aria-current]').textContent, index: document.querySelector('[data-set-index]').hidden, back: document.querySelector('[data-set-back]').hidden, preview: Boolean(document.querySelector('.look-prev')) })");
    result('settings: a wide screen opens on Appearance with the section list beside it and a preview of the app', wideOpen.open === 'look' && wideOpen.here === 'Appearance' && wideOpen.index && wideOpen.back && wideOpen.preview, wideOpen);
    const hist = await evalIn(browser, s, 'history.length');
    await evalIn(browser, s, "document.querySelector('.set-rail [data-set-go=protection]').click()");
    await sleep(500);
    const moved = await evalIn(browser, s, `({ open: [...document.querySelectorAll('.set-sec:not([hidden])')].map((x) => x.dataset.setSec).join(), here: document.querySelector('.set-rail [aria-current]').textContent, hash: location.hash, same: history.length === ${hist}, y: scrollY })`);
    result('settings: pressing a section in the list opens it in place, marks it, and adds no history entry', moved.open === 'protection' && moved.here === 'Protection' && moved.hash === '#protection' && moved.same, moved);
    await shot(browser, s, 'settings-section-desktop-protection');

    // Phone: the list of sections first, a press opens a page with a way back, and the browser's Back button agrees.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
    await goto(browser, s, `${server.base}/app/settings`);
    await until(browser, s, ready, 20000);
    const phoneState = () => evalIn(browser, s, "({ open: [...document.querySelectorAll('.set-sec:not([hidden])')].map((x) => x.dataset.setSec).join(), index: !document.querySelector('[data-set-index]').hidden, back: !document.querySelector('[data-set-back]').hidden, hash: location.hash, rows: document.querySelectorAll('.set-index__row').length, railShown: getComputedStyle(document.querySelector('.set-rail')).display !== 'none' })");
    const list = await phoneState();
    result('settings: a phone opens on the list of six sections, with no section open and no side list', list.index && list.rows === 6 && list.open === '' && !list.back && !list.railShown, list);
    await shot(browser, s, 'settings-index-phone-dark');
    await evalIn(browser, s, "document.querySelector('.set-index__row[href$=account]').click()");
    await until(browser, s, "location.hash === '#account'", 5000);
    await sleep(500);
    const page = await phoneState();
    result('settings: pressing a section on a phone opens that section with a link back to the list', page.open === 'account' && page.back && !page.index && page.hash === '#account', page);
    await shot(browser, s, 'settings-account-phone-dark');
    await evalIn(browser, s, "document.querySelector('[data-set-back]').click()");
    await until(browser, s, "!location.hash && !document.querySelector('[data-set-index]').hidden", 5000);
    const listAgain = await phoneState();
    result('settings: on a phone the link back goes to the list', listAgain.index && listAgain.open === '' && !listAgain.back, listAgain);
    // The browser's Back button from a section opened off the list returns to the list, and Forward to the section.
    await evalIn(browser, s, "document.querySelector('.set-index__row[href$=help]').click()");
    await until(browser, s, "location.hash === '#help'", 5000);
    await evalIn(browser, s, 'history.back()');
    await until(browser, s, "!location.hash && !document.querySelector('[data-set-index]').hidden", 5000);
    const backed = await phoneState();
    await evalIn(browser, s, 'history.forward()');
    await until(browser, s, "location.hash === '#help'", 5000);
    await sleep(300);
    const forward = await phoneState();
    result('settings: on a phone the browser Back button goes from a section to the list, and Forward returns', backed.index && backed.open === '' && forward.open === 'help' && forward.back, { backed, forward });

    // A phone section page opens on its own content, and its last row scrolls clear of the bottom bar: 360 px, default and Larger text.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: true }, s);
    const reach = [];
    for (const text of ['standard', 'larger']) {
      await evalIn(browser, s, `SentinelLook.set({ text: '${text}' }), true`);
      for (const sec of SECTIONS) {
        await open(browser, s, sec);
        await until(browser, s, ready, 20000);
        await sleep(500);
        const r = await evalIn(browser, s, `(() => { const bar = document.querySelector('.side'); const floor = bar && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top : innerHeight;
          const open = document.querySelector('.set-sec:not([hidden])'); const first = open.querySelector('.set-group__title').nextElementSibling;
          const startTop = Math.round(first.getBoundingClientRect().top); scrollTo(0, document.documentElement.scrollHeight);
          const last = [...open.querySelectorAll('.set-row:not(.is-out)')].pop(); const end = Math.round(last.getBoundingClientRect().bottom);
          scrollTo(0, 0); return { floor: Math.round(floor), startTop, end }; })()`);
        if (r.startTop > r.floor - 40 || r.end > r.floor + 1) reach.push({ sec, text, ...r });
      }
    }
    await evalIn(browser, s, "SentinelLook.set({ text: 'standard' }), true");
    result('settings: on a phone every section page starts on the first screen and its last row scrolls clear of the bottom bar (360 px, default and Larger text)', !reach.length, reach);

    // The preview is the app: its colour follows the colour chosen, its green never does, and its words follow the text size.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await goto(browser, s, `${server.base}/app/settings#look`);
    await until(browser, s, ready, 20000);
    const probe = `(() => { const p = (v, prop) => { const e = document.createElement('i'); e.style[prop] = 'var(' + v + ')'; document.body.append(e); const c = getComputedStyle(e)[prop]; e.remove(); return c; };
      const t = document.querySelector('.look-prev__page b'); return { ring: getComputedStyle(document.querySelector('.look-prev__ring')).borderTopColor, gold: p('--gold-400', 'color'), ok: getComputedStyle(document.querySelector('.look-prev__ok')).color, green: p('--green', 'color'), size: parseFloat(getComputedStyle(t).fontSize) }; })()`;
    const prev = {};
    for (const accent of ['gold', 'rose', 'teal']) {
      await evalIn(browser, s, `SentinelLook.set({ accent: '${accent}' }), true`);
      await sleep(1100);
      prev[accent] = await evalIn(browser, s, probe);
    }
    await shot(browser, s, 'settings-look-desktop-teal');
    await evalIn(browser, s, "SentinelLook.set({ text: 'larger' }), true");
    await sleep(900);
    const big = await evalIn(browser, s, probe);
    await evalIn(browser, s, "SentinelLook.set({ text: 'standard', accent: 'gold' }), true");
    result('settings: the preview wears the chosen colour and text size, and its green is the same green in every colour',
      Object.values(prev).every((p) => p.ring === p.gold) && new Set(Object.values(prev).map((p) => p.gold)).size === 3 && Object.values(prev).every((p) => p.ok === p.green) && new Set(Object.values(prev).map((p) => p.green)).size === 1 && big.size > prev.gold.size,
      { prev, larger: big.size });

    /* ------------------------------------- Download my data, and a false alarm */
    await evalIn(browser, s, `(() => { window.__saved = []; const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__saved.push(this.download); else click.call(this); }; })()`);
    await evalIn(browser, s, `(() => { const f = document.querySelector('[data-export]'); f.password.value = 'wrong-password-1'; f.requestSubmit(); })()`);
    await until(browser, s, "[...document.querySelectorAll('.toast')].some((t) => /incorrect/i.test(t.textContent))", 10000);
    const wrongPw = await evalIn(browser, s, "({ saved: window.__saved.length, said: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' ') })");
    result('settings: Download my data with a wrong password saves nothing and says why', wrongPw.saved === 0 && /incorrect/i.test(wrongPw.said), wrongPw);
    await evalIn(browser, s, `(() => { const f = document.querySelector('[data-export]'); f.password.value = ${JSON.stringify(password)}; f.requestSubmit(); })()`);
    await until(browser, s, 'window.__saved.length > 0', 10000);
    const file = await evalIn(browser, s, "window.__saved[0]");
    result('settings: Download my data saves one dated file', /^sentinel-data-\d{4}-\d{2}-\d{2}\.json$/.test(file || ''), file);
    await evalIn(browser, s, `(() => { const f = document.querySelector('[data-false-alarm]'); f.url.value = 'mybakery.example'; f.trust.checked = true; f.requestSubmit(); })()`);
    await until(browser, s, "[...document.querySelectorAll('.toast')].some((t) => /trusted for you/.test(t.textContent))", 10000);
    const rules = await evalIn(browser, s, "fetch('/api/v1/sites/overrides', { credentials: 'same-origin' }).then((r) => r.json())");
    result('settings: a false alarm with trust ticked trusts the site for this account', JSON.stringify(rules).includes('mybakery.example'), rules);

    /* ---------------------------------------------- the palette finds one setting */
    await evalIn(browser, s, "document.querySelector('[data-palette]').click()");
    await evalIn(browser, s, "(() => { const i = document.querySelector('.palette input'); i.value = 'wallet'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
    const options = await evalIn(browser, s, "[...document.querySelectorAll('.palette__list [role=option]')].map((o) => o.innerText.replace(/\\s+/g, ' ').trim())");
    result('settings: the search palette finds a single setting by its words', options.some((o) => /Wallet guard/.test(o) && /Setting/.test(o)), options);

    result('settings: no errors on the page', !errors.length, errors);

    /* ---------------- the mark, as a stranger meets it: tab, app icons, installer panel, on light and on dark */
    const i16 = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'extension', 'icons', 'icon16.png')).toString('base64');
    const i32 = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'extension', 'icons', 'icon32.png')).toString('base64');
    const bmp = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'desktop', 'build', 'installerSidebar.bmp')).toString('base64');
    await evalIn(browser, s, `(() => {
      const img = (src, px) => '<img src="' + src + '" width="' + px + '" height="' + px + '" style="image-rendering:auto">';
      const row = (bg) => '<div style="display:flex;gap:24px;align-items:center;padding:24px;background:' + bg + '">'
        // The tray's and the tab's 16 px picture at 100%, then 8 times, pixel for pixel; then the 32 px drawing a screen
        // at 200% shows (favicon.ico holds these two), as it is and 4 times.
        + '<img src="data:image/png;base64,${i16}" width="16" height="16"><img src="data:image/png;base64,${i16}" width="128" height="128" style="image-rendering:pixelated">'
        + '<img src="data:image/png;base64,${i32}" width="32" height="32"><img src="data:image/png;base64,${i32}" width="128" height="128" style="image-rendering:pixelated">'
        + img('/assets/img/icon-192.png', 96) + img('/assets/img/icon-maskable-512.png', 96).replace('<img', '<img style="border-radius:50%"')
        + '<img src="data:image/bmp;base64,${bmp}" width="164" height="314"></div>';
      document.body.innerHTML = row('#ffffff') + row('#0a0b0d');
      document.body.style.margin = '0';
    })()`);
    await sleep(500);
    await shot(browser, s, 'brand-marks');
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkSettings;
