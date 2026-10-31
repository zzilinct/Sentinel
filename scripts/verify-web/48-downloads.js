'use strict';
/**
 * downloads  The Downloads list and the right-click answer as a person reads them, one row of each kind: read to the
 *            end, partly read, not read at all, read but with no list to ask, and flagged. Every row comes from the
 *            real download check (desktop/src/downloads.js) run on harmless test files made here; only the Electron
 *            bridge is a stand-in. Green is for the one file that earned it.
 *            A picture of each (downloads-<size>-<theme>.png, filescan-<state>-<theme>.png).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, sleep, result, launch, evalIn, openPage, goto, startServer, watchErrors, until, shot } = require('./_shared');

const SIZES = { phone: [390, 844, true], desktop: [1366, 900, false] };
const THEMES = ['dark', 'light'];
const LONG = `${'Family holiday video from the lake house, summer 2026 '.repeat(2).trim()}.mp4`;

/** Runs the real check on test files; what it would list goes to the page. */
async function realDownloads() {
  const shared = path.join(ROOT, 'desktop', 'shared');
  fs.mkdirSync(shared, { recursive: true });
  for (const file of ['filescan.js', 'lists.js', 'brands.js']) fs.copyFileSync(path.join(ROOT, 'server', 'lib', 'scan', file), path.join(shared, file));
  const downloads = require(path.join(ROOT, 'desktop', 'src', 'downloads.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-downloads-'));
  const make = (name, mb, head) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, head);
    if (mb) fs.truncateSync(file, mb * 1024 * 1024);   // sparse: no real disk used
    return file;
  };
  const run = async (file, over = {}) => {
    downloads._test.configure({ api: async () => ({ known: false }), onThreat: () => {}, log: () => {}, ...over });
    await downloads._test.scan(file, fs.statSync(file));
  };
  await run(make('Tax return 2026.txt', 0, 'Income and expenses'));
  await run(make('ZoomInstallerFull.exe', 188, 'MZ inert test program'), { signedBy: async () => 'Zoom Video Communications, Inc.' });
  await run(make(LONG, 900, 'video bytes'));
  await run(make('Holiday photos.zip', 0, 'PK\x05\x06'.padEnd(22, '\0')), { api: async () => { throw new Error('offline'); } });
  const gone = make('Budget.xlsx', 0, 'Rent,Food');
  await run(gone, { api: async () => { fs.rmSync(gone); return { known: false }; } });
  await run(make('Invoice 2026.pdf.exe', 0, 'MZ inert test program'));
  fs.rmSync(dir, { recursive: true, force: true });
  return downloads.recent();
}

/** The app's bridge to Electron, as little as this page asks of it. */
const standIn = (recent) => `window.sentinelDesktop = new Proxy({
  info: async () => ({ version: '1.19.1', platform: 'win32', downloads: { active: true, folder: 'C:\\\\Users\\\\Sam\\\\Downloads' }, defense: { supported: true, active: true, watched: ['Downloads'] }, update: { status: 'idle' } }),
  recentDownloads: async () => ${JSON.stringify(recent)},
  defense: async () => ({ ledger: [] })
}, { get: (known, name) => known[name] || (typeof name === 'string' && /^on[A-Z]/.test(name) ? () => () => {} : undefined) });`;

async function checkDownloads() {
  const recent = await realDownloads();
  const by = (name) => recent.find((d) => d.name === name);
  result('downloads: the real check gave each kind of row', by('Tax return 2026.txt').looked === 'all' && by('ZoomInstallerFull.exe').looked === 'part' && by(LONG).looked === 'part'
    && by('Holiday photos.zip').looked === 'part' && by('Budget.xlsx').looked === 'none' && Boolean(by('Invoice 2026.pdf.exe').badge), recent.map((d) => `${d.name.slice(0, 24)}: ${d.looked}, ${d.badge}, ${d.label}, ${d.reason}`));

  const server = await startServer('downloads');
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await goto(browser, s, `${server.base}/login`);
    const email = `downloads-${Date.now()}@example.com`;
    const password = 'Downloads-Check-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });
    await api('/billing/plan', { plan: 'max' });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: standIn(recent) }, s);

    const wide = [];
    let rows = null;
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        await goto(browser, s, `${server.base}/app/protection`);
        await until(browser, s, "document.querySelectorAll('#downloads .list li').length >= 6", 20000);
        rows = await evalIn(browser, s, `(() => {
          document.querySelector('#downloads').scrollIntoView({ block: 'start' });
          return { wide: document.documentElement.scrollWidth - innerWidth, rows: [...document.querySelectorAll('#downloads .list li')].map((li) => {
            const strip = li.querySelector('.read-strip');
            return { text: li.innerText.replace(/\\s+/g, ' '), green: Boolean(li.querySelector('.status.is-on')), pill: (li.querySelector('.status') || {}).textContent || '', lit: parseFloat(strip.style.getPropertyValue('--end')), hidden: strip.getAttribute('aria-hidden'), box: strip.getBoundingClientRect().width };
          }) };
        })()`);
        if (rows.wide > 0) wide.push(`${size} ${theme}: ${rows.wide} px`);
        await sleep(400);
        await shot(browser, s, `downloads-${size}-${theme}`);
      }
    }
    const list = rows.rows;
    const row = (name) => list.find((r) => r.text.includes(name));
    result('downloads: only the file read to its end, with the list asked, is green', list.filter((r) => r.green).length === 1 && row('Tax return 2026').green && !list.some((r) => /\bClear\b/.test(r.text)), list);
    result('downloads: flagged first, then not checked, then partly checked', /Quarantine/.test(list[0].text) && list[1].pill === 'Not checked' && list[2].pill === 'Partly checked' && list[list.length - 1].green, list.map((r) => r.pill || r.text.slice(0, 30)));
    result('downloads: a big file says what was read, and who signed it', /Signed by Zoom Video Communications.*not the middle/.test(row('ZoomInstaller').text) && row('ZoomInstaller').pill === 'Partly checked' && /not the middle/.test(row('Family holiday').text), [row('ZoomInstaller').text, row('Family holiday').text]);
    result('downloads: a file read but not compared with the list is not called clean', /could not reach its list/.test(row('Holiday photos').text) && !/No threats found/.test(row('Holiday photos').text), row('Holiday photos').text);
    result('downloads: a file not read says why', /moved/.test(row('Budget').text) && !/No threats found/.test(row('Budget').text), row('Budget').text);
    result('downloads: the strip shows how much was read', row('Tax return').lit === 50 && row('ZoomInstaller').lit > 4 && row('ZoomInstaller').lit < 10 && row('Family holiday').lit === 4 && row('Holiday photos').lit === 50 && row('Budget').lit === 0 && list.every((r) => r.hidden === 'true' && r.box > 50), list.map((r) => r.lit));
    result('downloads: nothing scrolls sideways', !wide.length, wide);
    result('downloads: no errors on the page', !errors.length, errors);

    // The right-click answer, its page as the app opens it.
    const pages = {
      part: { name: 'ZoomInstallerFull.exe', size: '197132288', badge: 'part', label: 'Partly checked', why: by(LONG).reason, account: '' },
      none: { name: 'Budget.xlsx', size: '0', badge: 'none', label: 'Not checked', why: by('Budget.xlsx').reason, account: '1' }
    };
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 460, height: 420, deviceScaleFactor: 1, mobile: false }, s);
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.sentinelDesktop = { menuResultAction: async () => ({}), cardFit: async () => ({}) };' }, s);
    for (const [state, query] of Object.entries(pages)) {
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, s);
        await goto(browser, s, `file:///${path.join(ROOT, 'desktop', 'src', 'pages', 'filescan.html').replace(/\\/g, '/')}?${new URLSearchParams(query)}`);
        await sleep(300);
        await shot(browser, s, `filescan-${state}-${theme}`);
      }
      const seen = await evalIn(browser, s, "({ label: document.getElementById('label').textContent, lead: document.getElementById('lead').textContent, where: document.getElementById('where').textContent, signin: document.getElementById('signin').hidden })");
      result(`downloads: the right-click answer for ${state} is plain`, seen.label === query.label && seen.lead === query.why && !/nothing harmful/.test(seen.lead) && seen.signin === Boolean(query.account) && (query.account ? /fingerprint/.test(seen.where) : /left this computer/.test(seen.where)), seen);
    }
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkDownloads;
