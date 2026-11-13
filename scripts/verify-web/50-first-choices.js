'use strict';
/**
 * first-choices  The first-run step on home and Text size and Spacing, as a person meets them: a new account opens
 *                home and finds "Make Sentinel yours" drawn from Settings' own rows; Larger and Light chosen there work
 *                at once and are the same choice in Settings; Done (and a reload) keeps them and the step never
 *                comes back. Home and Settings at Larger, and Larger with Compact, on a phone and a desktop, light and
 *                dark: nothing scrolls sideways, no button's words are cut, no control is under 34px.
 *                Pictures: first-<state>-<size>-<theme>.png and type-<page>-<step>-<size>-<theme>.png.
 */
const { sleep, result, launch, evalIn, openPage, goto, startServer, watchErrors, until, shot } = require('./_shared');

const SIZES = { desktop: [1366, 900, false], phone: [390, 844, true] };

/** The Windows app's bridge, as far as home reads it; every setter is recorded. As in 48-settings.js. */
const APP = `(() => {
  const info = { version: '1.20.0', platform: 'win32', embeddedServer: true, liveMode: 'fast', autoScan: true, openAtLogin: true,
    live: { supported: true, enabled: false, active: false }, downloads: { active: true, folder: 'Downloads' },
    defense: { supported: true, active: true, watched: ['Downloads'] }, mySites: true, scanMenu: { supported: true, enabled: false },
    clipboardCheck: true, commandShield: true, walletGuard: false, remoteGuard: { supported: true, enabled: true, trusted: [] },
    snip: { supported: true, enabled: true, registered: true, key: 'k', keys: [{ id: 'k', label: 'Ctrl + Shift + S' }] },
    chatSafety: { supported: true, enabled: false }, textSafety: { supported: true, enabled: false }, exposureAlerts: false, weekRecap: false,
    update: { status: 'current', supported: true } };
  window.__calls = [];
  const known = {
    info: async () => JSON.parse(JSON.stringify(info)), mySites: async () => [], lockStatus: async () => ({ supported: true, set: false, record: [] }),
    checkUpdates: async () => ({ status: 'current' }), recentDownloads: async () => [], defense: async () => ({ ledger: [] }), exposures: async () => []
  };
  window.sentinelDesktop = new Proxy(known, { get: (k, name) => {
    if (k[name]) return k[name];
    if (typeof name !== 'string') return undefined;
    if (/^on[A-Z]/.test(name)) return () => () => {};
    if (/^set[A-Z]/.test(name)) return async (v) => { window.__calls.push([name, v]); return {}; };
    return undefined;
  } });
})();`;
const THEMES = ['dark', 'light'];

// What a person would see go wrong at a bigger size: the page wider than the screen, words cut inside a control, or a
// control too small to press. Only what is on screen and not folded away counts.
const LAYOUT = `(() => {
  const seen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden], .is-out, [inert]'); };
  const controls = [...document.querySelectorAll('#view .btn, #view .seg__btn, #view .input')].filter(seen);
  return {
    wide: document.documentElement.scrollWidth - innerWidth,
    cut: controls.filter((e) => e.scrollWidth > e.clientWidth + 1 && !e.matches('input')).map((e) => e.textContent.trim().slice(0, 30)),
    small: controls.filter((e) => e.getBoundingClientRect().height < 33.5).map((e) => (e.textContent.trim() || e.className).slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().height)),
    // The side bar's rows: a name that wraps must make its row taller, never spill into the next one.
    crowd: [...document.querySelectorAll('.side__link, .side__search')].filter(seen).filter((e) => e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent.trim().slice(0, 30)),
    text: document.documentElement.dataset.text || 'standard', density: document.documentElement.dataset.density || 'comfortable',
    ui: getComputedStyle(document.querySelector('#view .btn') || document.body).fontSize
  };
})()`;
const STEP = `(() => { const f = document.querySelector('.first'); return f ? { rows: [...f.querySelectorAll('[data-set-row]')].filter((r) => !r.hidden).map((r) => r.id),
  title: f.querySelector('h2').textContent, pressed: [...f.querySelectorAll('[aria-pressed=true]')].map((b) => b.textContent) } : null; })()`;
const press = (row, value) => `document.querySelector('.first [data-set-row="${row}"] [data-seg="${value}"]').click()`;

async function checkFirstChoices() {
  const server = await startServer('first-choices');
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await goto(browser, s, `${server.base}/login`);
    const email = `first-${Date.now()}@example.com`;
    const password = 'First-Choices-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Ada', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });
    const media = (theme) => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    const size = ([width, height, mobile]) => browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
    const homeReady = "document.querySelector('[data-quick]') && document.querySelector('[data-recent] .skeleton') === null";
    const wide = [];

    /* ------------------------------------------------ the step, as a new account first sees it */
    let step = null;
    for (const [name, dims] of Object.entries(SIZES)) {
      await size(dims);
      for (const theme of THEMES) {
        await media(theme);
        await goto(browser, s, `${server.base}/app`);
        await until(browser, s, homeReady, 20000);
        await sleep(400);
        step = await evalIn(browser, s, STEP);
        const l = await evalIn(browser, s, LAYOUT);
        if (l.wide > 0 || l.cut.length || l.small.length || l.crowd.length) wide.push({ at: `first ${name} ${theme}`, ...l });
        await shot(browser, s, `first-step-${name}-${theme}`);
      }
    }
    result('first-choices: a new account finds one step on home, drawn from Settings rows (look and text size on this branch)',
      Boolean(step) && step.title === 'Make Sentinel yours' && step.rows.join() === 'theme,text-size' && step.pressed.join() === 'Auto,Standard', step);

    /* ------------------------------------- a choice works at once, and is the same choice in Settings */
    await size(SIZES.phone);
    await media('dark');
    await goto(browser, s, `${server.base}/app`);
    await until(browser, s, homeReady, 20000);
    await evalIn(browser, s, press('text-size', 'larger'));
    await evalIn(browser, s, press('theme', 'light'));
    await sleep(400);
    const picked = await evalIn(browser, s, `({ step: ${STEP}, html: { ...document.documentElement.dataset }, ui: getComputedStyle(document.querySelector('[data-quick] .btn')).fontSize,
      kept: localStorage.getItem('sentinel:type'), theme: localStorage.getItem('sentinel:theme') })`);
    result('first-choices: Larger and Light pressed in the step work at once and are kept', picked.html.text === 'larger' && picked.html.theme === 'light'
      && picked.ui === '18.2px' && /"text":"larger"/.test(picked.kept || '') && picked.theme === 'light' && picked.step.pressed.join() === 'Light,Larger', picked);
    const l1 = await evalIn(browser, s, LAYOUT);
    if (l1.wide > 0 || l1.cut.length || l1.small.length || l1.crowd.length) wide.push({ at: 'first larger phone light', ...l1 });
    await shot(browser, s, 'first-larger-phone-light');

    // Escape on the step is Done: the step goes, the cursor is in the box to paste into, and it never comes back.
    await evalIn(browser, s, "document.querySelector('.first [data-seg]').focus()");
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, s);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, s);
    await sleep(500);
    const gone = await evalIn(browser, s, "({ step: Boolean(document.querySelector('.first')), focus: document.activeElement && document.activeElement.name, done: localStorage.getItem('sentinel:first-choices') })");
    await goto(browser, s, `${server.base}/app`);
    await until(browser, s, homeReady, 20000);
    await sleep(300);
    const again = await evalIn(browser, s, "({ step: Boolean(document.querySelector('.first')), text: document.documentElement.dataset.text, theme: document.documentElement.dataset.theme })");
    result('first-choices: Escape keeps the choices, puts the cursor in the box, and the step never comes back',
      !gone.step && gone.focus === 'url' && gone.done === '1' && !again.step && again.text === 'larger' && again.theme === 'light', { gone, again });
    await shot(browser, s, 'first-after-phone-light');

    // Settings says the same: Larger is pressed there.
    await goto(browser, s, `${server.base}/app/settings#look`);
    await until(browser, s, "document.querySelector('#text-size [aria-pressed=true]')", 20000);
    const there = await evalIn(browser, s, "[...document.querySelectorAll('#text-size [aria-pressed=true], #theme [aria-pressed=true]')].map((b) => b.textContent)");
    result('first-choices: Settings shows the choices made in the step', there.join() === 'Light,Larger', there);

    /* --------------------------------- Text size and Spacing across home and Settings, every size and theme */
    const STEPS = [['larger', 'comfortable'], ['larger', 'compact'], ['standard', 'compact']];
    for (const [text, density] of STEPS) {
      for (const [name, dims] of Object.entries(SIZES)) {
        await size(dims);
        for (const theme of THEMES) {
          await media(theme);
          await evalIn(browser, s, `(localStorage.setItem('sentinel:type', JSON.stringify({ text: '${text}', density: '${density}' })), localStorage.removeItem('sentinel:theme'))`);
          for (const [page, url, ready] of [['home', '/app', homeReady], ['settings', '/app/settings', "document.querySelectorAll('[data-set-row]').length > 20 && document.querySelector('[data-sessions] .list')"]]) {
            await goto(browser, s, `${server.base}${url}`);
            await until(browser, s, ready, 20000);
            await sleep(300);
            const l = await evalIn(browser, s, LAYOUT);
            if (l.text !== text || l.density !== density || l.wide > 0 || l.cut.length || l.small.length || l.crowd.length) wide.push({ at: `${page} ${text} ${density} ${name} ${theme}`, ...l });
            // Every combination is measured; the pictures are the ones a reviewer compares.
            if (density === 'comfortable' || name === 'phone') await shot(browser, s, `type-${page}-${text}-${density}-${name}-${theme}`);
          }
        }
      }
    }
    result('first-choices: at Larger, and Larger with Compact, nothing scrolls sideways, no words are cut or crowded, no control is under 34px', !wide.length, wide);

    // Compact really is tighter, and Comfortable is the old spacing to the pixel.
    await size(SIZES.desktop);
    const heights = {};
    for (const density of ['comfortable', 'compact']) {
      await evalIn(browser, s, `localStorage.setItem('sentinel:type', JSON.stringify({ text: 'standard', density: '${density}' }))`);
      await goto(browser, s, `${server.base}/app/settings`);
      await until(browser, s, "document.querySelector('#text-size .seg__btn')", 20000);
      heights[density] = await evalIn(browser, s, "({ seg: document.querySelector('#text-size .seg__btn').getBoundingClientRect().height, input: document.querySelector('[data-set-find]').getBoundingClientRect().height, btn: getComputedStyle(document.querySelector('.btn:not(.btn--sm)') || document.querySelector('.btn')).height })");
    }
    result('first-choices: Comfortable keeps the old sizes, Compact is tighter and never under 36px',
      heights.comfortable.seg === 38 && heights.comfortable.input === 46 && heights.compact.seg >= 36 && heights.compact.seg < 38 && heights.compact.input < 46 && heights.compact.input >= 36, heights);

    /* ---------------------------- in the Windows app: the step says the tray line the old notification said */
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: APP }, s);
    await media('dark');
    await evalIn(browser, s, "(localStorage.removeItem('sentinel:first-choices'), localStorage.removeItem('sentinel:type'), 1)");
    await goto(browser, s, `${server.base}/app`);
    await until(browser, s, "document.querySelector('.first')", 20000);
    await sleep(500);
    const app = await evalIn(browser, s, "({ line: (document.querySelector('.first__end p') || {}).textContent || '', calls: window.__calls })");
    result('first-choices: in the Windows app the step says Sentinel stays in the tray, and the app is told the text size',
      /Closing this window leaves Sentinel running in the tray\. Right-click the mask there to quit\./.test(app.line)
      && app.calls.some(([n, v]) => n === 'setType' && v && v.text === 'standard'), app);
    await shot(browser, s, 'first-step-app-desktop-dark');

    result('first-choices: no errors on the page', !errors.length, errors);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkFirstChoices;
