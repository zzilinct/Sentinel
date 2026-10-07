'use strict';
/**
 * The browser checkup (desktop/src/checkup.js) against real browser profiles: meant for CI
 * (.github/workflows/checkup-e2e.yml), never a person's computer, because it changes the browsers' own default
 * profiles.
 *
 *   node scripts/verify-checkup.js prepare [--out dir]   Chrome and Edge: their default profile, over the DevTools
 *                                                        pipe: a site allowed (and one blocked) to send
 *                                                        notifications, a start page, Bing as the search engine, and
 *                                                        test add-ons. Opera and Opera GX, when installed: an add-on.
 *                                                        Firefox: a profile listed in profiles.ini with the same
 *                                                        notification permissions, a home page, a search engine
 *                                                        nobody knows, a store add-on (and an unsigned one, which
 *                                                        release Firefox refuses), and a left-behind profile folder.
 *   node scripts/verify-checkup.js check [--out dir]     Runs checkup.collectAside() (on a worker thread, as the app
 *                                                        does), collect() and addressesOf() on those profiles,
 *                                                        asserts what they find and how they judge it, and that not
 *                                                        one byte of any browser file changed.
 *
 * `check` also runs under Electron's own Node (ELECTRON_RUN_AS_NODE=1), the one the app ships.
 * Nothing here is harmful: the add-ons do nothing, the sites are .test addresses that do not exist.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { cdpPipe, CANDIDATES, expand, sleep } = require('./review-shots');
const { marionette, FIREFOX } = require('./verify-companion-firefox');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const MODE = process.argv[2];
const OUT = path.resolve(arg('--out', 'e2e-checkup'));
const LOCAL = process.env.LOCALAPPDATA;
const ROAMING = process.env.APPDATA;

const C = {
  allow: 'https://example-notify.test:443', block: 'https://blocked-notify.test:443',
  startup: 'https://startup-page.test/',
  search: 'https://find.search-checkup.test/q?s={searchTerms}',
  amo: 'https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi'
};
// Opera installs a launcher beside its version folders: the browser itself is the newest version's opera.exe (the
// launcher would not pass the DevTools pipe on).
function operaExe(folder) {
  for (const base of [path.join(LOCAL, 'Programs', folder), path.join(process.env.ProgramFiles || 'C:\\Program Files', folder)]) {
    let versions = [];
    try { versions = fs.readdirSync(base).filter((n) => /^\d+\.\d+/.test(n) && fs.existsSync(path.join(base, n, 'opera.exe'))); } catch { continue; }
    versions.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (versions.length) return path.join(base, versions[versions.length - 1], 'opera.exe');
    if (fs.existsSync(path.join(base, 'opera.exe'))) return path.join(base, 'opera.exe');
  }
  return null;
}
// `lite`: Opera's settings pages are its own, so only an add-on is put in. Its one profile is the folder itself.
const BROWSERS = [
  { id: 'chrome', userData: path.join(LOCAL, 'Google', 'Chrome', 'User Data'), settings: 'chrome://settings' },
  { id: 'edge', userData: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data'), settings: 'edge://settings' },
  { id: 'opera', exe: operaExe('Opera'), userData: path.join(ROAMING, 'Opera Software', 'Opera Stable'), lite: true },
  { id: 'operagx', exe: operaExe('Opera GX'), userData: path.join(ROAMING, 'Opera Software', 'Opera GX Stable'), lite: true }
];
const FF_ROOT = path.join(ROAMING, 'Mozilla', 'Firefox');
const FF_PROFILE = path.join(FF_ROOT, 'Profiles', 'chk00001.default-release');
// A profile folder profiles.ini does not list: what a removed profile leaves behind. Its add-on must not be shown.
const FF_STALE = path.join(FF_ROOT, 'Profiles', 'chk00002.left-behind');
const FF_ADDON_ID = 'video-saver@checkup.test';

// The test add-ons. A: from a folder, every site and cookies. B: forced in by a start command, a bank's name.
// C: from a folder, changes the search engine to one nobody knows. D (Firefox): unsigned, every site and cookies.
const EXT = {
  A: { manifest_version: 3, name: 'Coupon Helper Checkup', version: '1.0', permissions: ['cookies', 'storage'], host_permissions: ['<all_urls>'] },
  B: { manifest_version: 3, name: 'PayPal Wallet Checkup', version: '1.0', content_scripts: [{ matches: ['<all_urls>'], js: ['c.js'] }] },
  C: {
    manifest_version: 3, name: 'Weather Tab Checkup', version: '1.0',
    chrome_settings_overrides: { search_provider: { name: 'Weather Search', keyword: 'wthr', search_url: 'https://find.weather-tab.test/q?s={searchTerms}', favicon_url: 'https://find.weather-tab.test/favicon.ico', encoding: 'UTF-8', is_default: true } }
  },
  D: { manifest_version: 2, name: 'Video Saver Checkup', version: '1.0', permissions: ['<all_urls>', 'cookies'], browser_specific_settings: { gecko: { id: FF_ADDON_ID } } }
};
const extDir = (k) => path.join(OUT, 'ext', k);
function writeExtensions() {
  for (const [k, manifest] of Object.entries(EXT)) {
    fs.mkdirSync(extDir(k), { recursive: true });
    fs.writeFileSync(path.join(extDir(k), 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (k === 'B') fs.writeFileSync(path.join(extDir(k), 'c.js'), '// does nothing\n');
  }
}

const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);
process.on('exit', (code) => console.log(`exit ${code}`));
const exited = (child, ms) => new Promise((resolve) => {
  if (child.exitCode !== null) return resolve(true);
  const t = setTimeout(() => resolve(false), ms);
  child.once('exit', () => { clearTimeout(t); resolve(true); });
});

/* -------------------------------------------------------------------- prepare: Chromium */

// Run in the browser's own settings page, one at a time (a handler given arguments it does not expect can take
// the whole browser down, and then the log says which). Through the page's own browser proxies when the page
// exports them (Chrome's settings.js), else the raw messages the same handlers listen to.
const STEPS = {
  init: `(async () => {
    const k = window.__chk = {};
    try { k.settings = await import(location.origin + '/settings.js'); } catch (e) { k.settingsError = String(e.message || e); }
    for (const u of [location.protocol + '//resources/js/cr.js', 'chrome://resources/js/cr.js']) { try { k.cr = await import(u); break; } catch { /* next */ } }
    try { k.lazy = await import(location.origin + '/lazy_load.js'); } catch { /* none */ }
    const SiteProxy = (k.settings && k.settings.SiteSettingsPrefsBrowserProxyImpl) || (k.lazy && k.lazy.SiteSettingsPrefsBrowserProxyImpl);
    k.site = SiteProxy ? SiteProxy.getInstance() : null;
    k.engines = k.settings && k.settings.SearchEnginesBrowserProxyImpl ? k.settings.SearchEnginesBrowserProxyImpl.getInstance() : null;
    k.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    return { settingsModule: k.settingsError || 'ok', cr: Boolean(k.cr), site: Boolean(k.site), engines: Boolean(k.engines), settingsPrivate: Boolean(chrome.settingsPrivate) };
  })()`,
  notifications: (C) => `(async (C) => {
    const k = window.__chk;
    // Read first: that is what lets the handler answer the page at all (a handler that may not yet talk to its
    // page takes the browser down when it tries).
    await (k.site ? k.site.getExceptionList('notifications') : k.cr.sendWithPromise('getExceptionList', 'notifications'));
    for (const [p, v] of [[C.allow, 'allow'], [C.block, 'block']]) {
      if (k.site) k.site.setCategoryPermissionForPattern(p, '', 'notifications', v, false);
      else chrome.send('setCategoryPermissionForPattern', [p, '', 'notifications', v, false]);
    }
    await k.wait(800);
    const list = k.site ? await k.site.getExceptionList('notifications') : await k.cr.sendWithPromise('getExceptionList', 'notifications');
    return JSON.parse(JSON.stringify(list));
  })(${JSON.stringify(C)})`,
  startup: (C) => `(async (C) => {
    const sp = (key, v) => new Promise((r) => chrome.settingsPrivate.setPref(key, v, '', r));
    const gp = (key) => new Promise((r) => chrome.settingsPrivate.getPref(key, r));
    const a = await sp('session.restore_on_startup', 4);
    const b = await sp('session.startup_urls', [C.startup]);
    return { setRestore: a, setUrls: b, restore: (await gp('session.restore_on_startup') || {}).value, urls: (await gp('session.startup_urls') || {}).value };
  })(${JSON.stringify(C)})`,
  searchList: `(async () => {
    const k = window.__chk;
    if (!k.engines && !k.cr) throw new Error('this settings page has neither a search engines proxy nor cr.js');
    k.list = () => k.engines ? k.engines.getSearchEnginesList() : k.cr.sendWithPromise('getSearchEnginesList');
    k.all = (l) => [...(l.defaults || []), ...(l.actives || []), ...(l.others || []), ...(l.extensions || [])];
    // A made-up engine cannot be added from script: Chrome 154 ignores the edit messages, or crashes on them once
    // the handler is live (seen on CI). Another engine than the one it came with, then, so the file holds a choice
    // the person made; unknown engines are judged by the add-on that sets one.
    k.mine = k.all(await k.list()).find((e) => /bing\.com/.test(String(e.url)));
    if (!k.mine) throw new Error('Bing is not among the engines');
    return { mine: JSON.parse(JSON.stringify(k.mine)), setter: k.engines ? String(k.engines.setDefaultSearchEngine) : null };
  })()`,
  search: `(async () => {
    const k = window.__chk;
    // As the page itself calls it: setDefaultSearchEngine(id, choiceMadeLocation, saveGuestChoice), the id as the
    // number the list gives (Chrome 154 crashes on a string), 2 = kSearchEngineSettings (anything else is a CHECK).
    k.engines.setDefaultSearchEngine(k.mine.id, 2, null);
    await k.wait(800);
    const now = k.all(await k.list()).find((e) => e.default);
    if (!now || now.url !== k.mine.url) throw new Error('the default did not change: ' + (now && now.url));
    return { defaultNow: now.url };
  })()`
};

async function prepareChromium(b) {
  const exe = b.exe !== undefined ? b.exe : (CANDIDATES[b.id] || []).map(expand).find((p) => fs.existsSync(p));
  if (!exe) return { id: b.id, error: 'not installed' };
  const out = { id: b.id, exe, userData: b.userData, lite: Boolean(b.lite) };
  // The default profile of the runner's own user: the real files, where a person's browser keeps them. Chrome and
  // Edge 136+ refuse DevTools on their default folder (so other programs cannot steal cookies through it); the same
  // folder is reached here through a junction, which they do not take for the default.
  fs.mkdirSync(b.userData, { recursive: true });
  const via = path.join(os.tmpdir(), `checkup-${b.id}-userdata`);
  try { fs.rmSync(via, { force: true, recursive: false }); } catch { /* none */ }
  fs.symlinkSync(b.userData, via, 'junction');
  out.via = via;
  const child = spawn(exe, [
    '--headless=new', `--user-data-dir=${via}`, ...(b.lite ? [] : ['--profile-directory=Default']),
    '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    ...(b.lite ? [] : ['--disable-features=DisableLoadExtensionCommandLineSwitch', `--load-extension=${extDir('B')}`]),
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--enable-logging=stderr', 'about:blank'
  ], { stdio: ['ignore', 'ignore', fs.openSync(path.join(OUT, `${b.id}-stderr.txt`), 'w'), 'pipe', 'pipe'] });
  child.on('error', (e) => log(`${b.id}: ${e.message}`));
  child.on('exit', (code, signal) => log(`${b.id}: exited ${code} ${signal || ''}`));
  const gone = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  const raw = cdpPipe(child);
  // A browser that dies takes its pipe with it: every call still waiting fails then, instead of waiting forever.
  const send = (...a) => Promise.race([raw(...a), gone.then((code) => { throw new Error(`the browser exited (${code}) during ${a[0]}`); })]);
  const evalIn = async (sessionId, expression) => {
    const r = await Promise.race([send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId), sleep(20000).then(() => { throw new Error('no answer in 20 s'); })]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value;
  };
  const step = async (name, fn) => {
    log(`${b.id}: ${name}`);
    out[name] = await fn().then((value) => ({ ok: true, value }), (e) => ({ ok: false, error: e.message }));
    log(`${b.id}: ${name} ${JSON.stringify(out[name]).slice(0, 600)}`);
  };
  try {
    out.version = (await Promise.race([send('Browser.getVersion'), sleep(90000).then(() => { throw new Error('no answer on the DevTools pipe'); })])).product;
    log(`${b.id}: ${out.version}`);
    // CDP's own grant, for completeness: an in-memory override, so the settings page below is what writes the file.
    out.grantPermissions = await send('Browser.grantPermissions', { permissions: ['notifications'], origin: 'https://example-notify.test' }).then(() => 'ok', (e) => e.message);
    await step('extA', () => send('Extensions.loadUnpacked', { path: extDir('A') }).then((r) => r.id));
    // Preferences are committed about ten seconds after a change: a later step that crashes the browser then
    // does not take what was set before it along.
    await sleep(11000);

    // Opera: an add-on only; its settings pages are its own.
    if (!b.lite) {
      // Each setting on its own page of the browser's settings, the way a person gets there, so the page itself
      // has started the handler it needs (Chrome crashes when a handler is driven before its page started it).
      const open = async (page) => {
        const { targetId } = await send('Target.createTarget', { url: `${b.settings}/${page}` });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        let ready = false;
        for (let i = 0; i < 80 && !ready; i++) {
          await sleep(250);
          ready = await send('Runtime.evaluate', { expression: "document.readyState === 'complete' && typeof chrome !== 'undefined' && typeof chrome.send === 'function'", returnByValue: true }, sessionId).then((r) => r.result.value, () => false);
        }
        await sleep(1500);
        return sessionId;
      };
      let sessionId = await open('content/notifications');
      await step('init', () => evalIn(sessionId, STEPS.init));
      await step('notifications', () => evalIn(sessionId, STEPS.notifications(C)));
      await step('startup', () => evalIn(sessionId, STEPS.startup(C)));
      await sleep(11000);
      sessionId = await open('searchEngines');
      await step('initSearch', () => evalIn(sessionId, STEPS.init));
      await step('searchList', () => evalIn(sessionId, STEPS.searchList));
      if (out.searchList.ok) await step('search', () => evalIn(sessionId, STEPS.search));
      else out.search = out.searchList;
      await step('extC', () => send('Extensions.loadUnpacked', { path: extDir('C') }).then((r) => r.id));
      await sleep(2000);
    }
    await send('Browser.close').catch(() => {});
  } catch (err) {
    out.error = err.message;
  }
  log(`${b.id}: closing${out.error ? `, error ${out.error}` : ''}`);
  out.cleanExit = await exited(child, 30000);
  if (!out.cleanExit) child.kill();
  await sleep(3000);   // helper processes letting go of the profile
  // What the browser wrote, for the record (and the artifact).
  for (const f of ['Preferences', 'Secure Preferences']) {
    // Opera keeps its profile in the folder itself, or a Default in it.
    const src = [path.join(b.userData, 'Default', f), path.join(b.userData, f)].find((x) => fs.existsSync(x));
    if (src) { fs.copyFileSync(src, path.join(OUT, `${b.id}-${f.replace(' ', '-')}.json`)); out[`where ${f}`] = src; }
  }
  return out;
}

/* -------------------------------------------------------------------- prepare: Firefox */

async function prepareFirefox() {
  if (!FIREFOX) return { id: 'firefox', error: 'not installed' };
  const out = { id: 'firefox', exe: FIREFOX, profile: FF_PROFILE };
  fs.mkdirSync(path.join(FF_PROFILE, 'extensions'), { recursive: true });
  // The profile is listed in profiles.ini, as Firefox's profile manager lists the ones it made; the left-behind one
  // is not, and holds an add-on the checkup would flag if it read that folder.
  const ini = path.join(FF_ROOT, 'profiles.ini');
  const had = fs.existsSync(ini) ? fs.readFileSync(ini, 'utf8') : '[General]\r\nStartWithLastProfile=1\r\nVersion=2\r\n';
  const n = (had.match(/^\[Profile\d+\]/gm) || []).length;
  fs.writeFileSync(ini, `${had.replace(/\s*$/, '')}\r\n\r\n[Profile${n}]\r\nName=checkup\r\nIsRelative=1\r\nPath=Profiles/${path.basename(FF_PROFILE)}\r\n`);
  out.profilesIni = fs.readFileSync(ini, 'utf8');
  fs.mkdirSync(FF_STALE, { recursive: true });
  fs.writeFileSync(path.join(FF_STALE, 'extensions.json'), JSON.stringify({ addons: [{ id: 'stale@checkup.test', type: 'extension', location: 'app-profile', active: true, signedState: 0, defaultLocale: { name: 'Stale Toolbar Checkup' }, userPermissions: { permissions: ['cookies'], origins: ['<all_urls>'] } }] }));
  fs.writeFileSync(path.join(FF_STALE, 'prefs.js'), 'user_pref("browser.startup.homepage", "https://stale-home.test/");\n');
  // An unsigned add-on, put in the profile's own add-on folder the way other programs side-load them.
  const zip = path.join(OUT, 'd.zip');
  execFileSync(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', extDir('D'), 'manifest.json']);
  fs.copyFileSync(zip, path.join(FF_PROFILE, 'extensions', `${FF_ADDON_ID}.xpi`));
  const mport = 2900 + Math.floor(Math.random() * 300);
  fs.writeFileSync(path.join(FF_PROFILE, 'user.js'), [
    ['marionette.port', mport], ['browser.shell.checkDefaultBrowser', false], ['datareporting.policy.dataSubmissionEnabled', false], ['app.update.enabled', false]
  ].map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
  const child = spawn(FIREFOX, ['-headless', '-no-remote', '-marionette', '-remote-allow-system-access', '-profile', FF_PROFILE], { stdio: 'ignore' });
  let m;
  try {
    for (let i = 0; i < 80 && !m; i++) { await sleep(500); m = await marionette(mport).catch(() => null); }
    if (!m) throw new Error('Firefox did not open its Marionette port');
    const session = await m.send('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } });
    out.version = session.capabilities.browserVersion;
    await m.send('WebDriver:SetTimeouts', { script: 180000 });
    await m.send('Marionette:SetContext', { value: 'chrome' });
    const r = await m.send('WebDriver:ExecuteAsyncScript', {
      script: `const [C, id, done] = arguments;
        (async () => {
          const pm = Services.perms, ssm = Services.scriptSecurityManager;
          pm.addFromPrincipal(ssm.createContentPrincipalFromOrigin('https://example-notify.test'), 'desktop-notification', pm.ALLOW_ACTION);
          pm.addFromPrincipal(ssm.createContentPrincipalFromOrigin('https://blocked-notify.test'), 'desktop-notification', pm.DENY_ACTION);
          Services.prefs.setIntPref('browser.startup.page', 1);
          Services.prefs.setStringPref('browser.startup.homepage', C.startup);
          const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
          const brief = (a) => a ? { id: a.id, name: a.name, location: a.location, signedState: a.signedState, appDisabled: a.appDisabled, userDisabled: a.userDisabled, isActive: a.isActive, sourceURI: a.sourceURI && a.sourceURI.spec } : null;
          const unsigned = brief(await AddonManager.getAddonByID(id));
          // A real store add-on, installed the way the store's own page installs it.
          let store = null;
          try {
            const install = await AddonManager.getInstallForURL(C.amo, { telemetryInfo: { source: 'amo' } });
            store = brief(await install.install());
          } catch (e) { store = { error: String(e) }; }
          // A search engine nobody knows, made the default the way the person would (Firefox writes
          // search.json.mozlz4). addUserEngine took (name, url, alias) before it took one object: both are tried.
          const search = { tried: [] };
          try {
            // Firefox 156 has neither Services.search nor the old XPCOM contract here: the search service is a
            // module of its own. Each way is tried, and what was found is reported.
            const ways = [
              () => Services.search,
              () => ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs').Services.search,
              () => { const m = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs'); search.exports = Object.keys(m); return m.SearchService && (typeof m.SearchService.init === 'function' ? m.SearchService : null); },
              () => { const m = ChromeUtils.importESModule('resource://gre/modules/SearchService.sys.mjs'); search.exports = Object.keys(m); return m.SearchService && (typeof m.SearchService.init === 'function' ? m.SearchService : null); },
              () => Cc['@mozilla.org/browser/search-service;1'].getService(Ci.nsISearchService)
            ];
            let ss = null;
            for (const way of ways) { try { ss = way(); } catch (e) { search.tried.push(String(e).slice(0, 160)); } if (ss) break; }
            if (!ss) throw new Error('no search service');
            await ss.init();
            for (const call of [() => ss.addUserEngine({ name: 'Find Checkup', url: C.search, alias: '' }), () => ss.addUserEngine('Find Checkup', C.search, '')]) {
              try { await call(); } catch (e) { search.tried.push(String(e).slice(0, 200)); }
              if (ss.getEngineByName('Find Checkup')) break;
            }
            let engine = ss.getEngineByName('Find Checkup');
            // Without it, one of Firefox's own engines: the file is still decoded, judged as Firefox's own.
            if (!engine) { engine = ss.getEngineByName('Bing'); search.fallback = 'Bing'; }
            const reason = ss.CHANGE_REASON_USER !== undefined ? ss.CHANGE_REASON_USER : Ci.nsISearchService.CHANGE_REASON_USER;
            await ss.setDefault(engine, reason);
            search.name = (await ss.getDefault()).name;
            const { setTimeout } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
            await new Promise((r) => setTimeout(r, 3000));
          } catch (e) { search.error = String(e); }
          return { unsigned, store, search };
        })().then(done, (e) => done({ error: String(e) }));`,
      args: [C, FF_ADDON_ID], sandbox: 'system'
    });
    out.result = r.value;
    await m.send('Marionette:Quit', { flags: ['eAttemptQuit'] }).catch(() => {});
  } catch (err) {
    out.error = err.message;
  } finally {
    if (m) m.close();
  }
  out.cleanExit = await exited(child, 30000);
  if (!out.cleanExit) child.kill();
  await sleep(2000);
  for (const f of ['extensions.json', 'prefs.js', 'search.json.mozlz4']) {
    const src = path.join(FF_PROFILE, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, `firefox-${f}`));
  }
  return out;
}

/* -------------------------------------------------------------------- check */

function hashTree(roots) {
  const map = new Map();
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true, recursive: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const f = path.join(e.parentPath || e.path, e.name);
      try { map.set(f, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')); } catch (err) { map.set(f, `unreadable ${err.code}`); }
    }
  }
  return map;
}
const diff = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
const tempLeftovers = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('sentinel-checkup-'));

async function check() {
  const runtime = process.versions.electron ? `Electron ${process.versions.electron} (Node ${process.versions.node})` : `Node ${process.versions.node}`;
  const prep = JSON.parse(fs.readFileSync(path.join(OUT, 'prepare.json'), 'utf8'));
  const checkup = require('../desktop/src/checkup.js');
  const failures = [];
  const expect = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };

  // A policy that forces an add-on in, set the way unwanted software sets it (HKCU, no admin needed).
  const POLICY = 'HKCU\\Software\\Policies\\Google\\Chrome\\ExtensionInstallForcelist';
  execFileSync('reg', ['add', POLICY, '/v', '1', '/t', 'REG_SZ', '/d', 'abcdefghijklmnopabcdefghijklmnop;https://updates.checkup.test/u.xml', '/f']);

  const roots = [...BROWSERS.map((b) => b.userData), FF_ROOT, path.join(OUT, 'ext')];
  const before = hashTree(roots);
  await sleep(3000);
  const settled = hashTree(roots);
  const noise = new Set(diff(before, settled));
  const tmpBefore = tempLeftovers();

  let result;
  let inThread;
  try {
    // As the app runs it: on a worker thread. Then on this thread, which must find the same.
    result = await checkup.collectAside({ managed: false });
    inThread = await checkup.collect({ managed: false });
  } finally {
    execFileSync('reg', ['delete', 'HKCU\\Software\\Policies\\Google\\Chrome', '/f']);
  }
  const urls = checkup.addressesOf(result);
  const after = hashTree(roots);
  fs.writeFileSync(path.join(OUT, `result-${process.versions.electron ? 'electron' : 'node'}.json`), JSON.stringify({ runtime, managedDetected: checkup._test.isManaged(), result, urls }, null, 2));
  console.log(`\n${runtime}: ${result.browsers.length} browser(s); detected managed=${checkup._test.isManaged()}; not checked: ${result.unchecked.join(', ') || 'none'}`);
  expect(JSON.stringify(result) === JSON.stringify(inThread), 'the worker thread finds what the main thread finds');
  expect(['Opera', 'Opera GX'].every((n) => result.looked.includes(n)), `Opera and Opera GX are looked for (${result.looked.join(', ')})`);
  const everyAddon = result.browsers.flatMap((b) => b.profiles.flatMap((p) => p.addons));
  expect(!everyAddon.some((a) => a.name === 'Stale Toolbar Checkup'), 'a Firefox profile folder profiles.ini does not list is left out');

  const ours = new Set(['Coupon Helper Checkup', 'PayPal Wallet Checkup', 'Weather Tab Checkup', 'Video Saver Checkup', 'uBlock Origin']);
  // Edge's settings page is its own: Chromium's site settings and search engine handlers do not answer there.
  const unsupported = (st) => Boolean(st && !st.ok && /no answer in 20 s/.test(st.error));
  const wanted = ['https://example-notify.test/', C.startup];
  const reasonIds = (a) => (a.reasons || []).map((r) => r.id).sort().join(',');
  for (const p of prep.browsers) {
    const label = p.id;
    if (p.error === 'not installed') { console.log(`SKIP  ${label}: not installed on this runner`); continue; }
    const b = result.browsers.find((x) => x.id === p.id);
    expect(Boolean(b), `${label}: found by the checkup`);
    if (!b) continue;
    const profiles = b.profiles;
    console.log(`      ${label} ${p.version || ''}: profiles ${profiles.map((x) => x.name).join(', ')}`);
    const prof = profiles.find((x) => x.addons.some((a) => ours.has(a.name))) || profiles[0];
    expect(Boolean(prof), `${label}: a profile was read`);
    if (!prof) continue;
    for (const a of prof.addons) console.log(`      add-on ${a.name} [${a.id}] source=${a.source} store=${a.fromStore} enabled=${a.enabled} signed=${a.signed} badge=${a.badge} reasons=${reasonIds(a)}`);
    console.log(`      notifications ${JSON.stringify(prof.notifications)} search ${JSON.stringify(prof.search)} startup ${JSON.stringify(prof.startup)}`);
    const addon = (name) => prof.addons.find((a) => a.name === name);
    const others = profiles.flatMap((x) => x.addons).filter((a) => !ours.has(a.name));
    expect(others.every((a) => !a.badge), `${label}: nothing the browser came with is flagged (${others.map((a) => `${a.name}=${a.badge}`).join(', ') || 'no other add-ons'})`);

    if (p.id === 'firefox') {
      const r = p.result || {};
      const u = addon('uBlock Origin');
      expect(Boolean(u), `firefox: the add-on installed from the store is found in extensions.json (${JSON.stringify(r.store)})`);
      if (u) {
        expect(u.source === 'store' && u.fromStore && u.signed === true && u.enabled, `firefox: it is read as from the store, signed, enabled (source=${u.source} store=${u.fromStore} signed=${u.signed} enabled=${u.enabled})`);
        expect(u.hosts.includes('<all_urls>') && u.permissions.includes('webRequestBlocking'), `firefox: its sites and powers are read (hosts=${u.hosts} permissions=${u.permissions})`);
        expect(!u.badge && reasonIds(u) === 'A07', `firefox: a store ad blocker is left alone, what it can do still said (${u.badge} ${reasonIds(u)})`);
      }
      const d = addon('Video Saver Checkup');
      if (!r.unsigned) console.log('NOTE  firefox: release Firefox refused the side-loaded unsigned add-on (AddonManager does not know it), so there is none to find');
      else expect(Boolean(d), `firefox: the side-loaded unsigned add-on Firefox kept is found (${JSON.stringify(r.unsigned)})`);
      if (d) {
        expect(d.source === 'outside' && d.fromStore === false, `firefox: it is judged not from the store (source=${d.source})`);
        expect(d.signed === false, `firefox: it is known to be unsigned (signed=${d.signed})`);
        expect(d.hosts.includes('<all_urls>') && d.permissions.includes('cookies'), `firefox: its sites and powers are read (hosts=${d.hosts} permissions=${d.permissions})`);
        expect(d.badge === 'orange' && ['A02', 'A06', 'A07'].every((id) => reasonIds(d).includes(id)), `firefox: judged orange for A02, A06, A07 (${d.badge} ${reasonIds(d)})`);
      }
      expect(prof.name === 'checkup', `firefox: the profile carries its name from profiles.ini (${prof.name})`);
      // search.json.mozlz4, written by Firefox itself, decoded and judged.
      const s = r.search || {};
      if (s.name === 'Find Checkup') {
        expect(prof.search && prof.search.name === 'Find Checkup' && prof.search.host === 'find.search-checkup.test' && prof.search.badge === 'yellow', `firefox: the search engine it was set to is read from search.json.mozlz4 and judged yellow (${JSON.stringify(prof.search)})`);
        wanted.push('https://find.search-checkup.test/');
      } else if (s.name === 'Bing') {
        console.log(`NOTE  firefox: no engine of its own could be added (${JSON.stringify(s.tried)}), so Bing, one of Firefox's own, was set`);
        expect(prof.search && prof.search.name === 'Bing' && prof.search.known === true && !prof.search.badge, `firefox: Bing is read from search.json.mozlz4 and left alone (${JSON.stringify(prof.search)})`);
      } else {
        expect(false, `firefox: a default search engine could be set (${JSON.stringify(s)})`);
      }
    } else if (p.lite) {
      // Opera and Opera GX: the profile in the folder itself, an add-on put in over DevTools.
      expect(b.places.addons === 'opera://extensions' && b.open === 'opera', `${label}: its pages are Opera's, and "Open" opens Opera (${b.places.addons}, ${b.open})`);
      console.log(`      ${label}: Preferences at ${p['where Preferences'] || 'nowhere'}`);
      const a = addon('Coupon Helper Checkup');
      if (p.extA && p.extA.ok) {
        expect(Boolean(a) && a.source === 'unpacked' && a.badge === 'yellow' && reasonIds(a) === 'A03,A07', `${label}: the add-on loaded from a folder is found and judged yellow for A03 and A07 (${a ? `${a.source} ${a.badge} ${reasonIds(a)}` : 'not found'})`);
      } else {
        console.log(`NOTE  ${label}: no add-on could be loaded over DevTools (${JSON.stringify(p.extA || p.error)}), so only its own add-ons were read`);
      }
      continue;
    } else {
      const a = addon('Coupon Helper Checkup');
      expect(Boolean(a), `${label}: the add-on loaded from a folder is found (${JSON.stringify(p.extA)})`);
      if (a) {
        expect(a.source === 'unpacked' && a.enabled, `${label}: it is read as loaded from a folder, enabled (source=${a.source} enabled=${a.enabled})`);
        expect(a.hosts.includes('<all_urls>') && a.permissions.includes('cookies'), `${label}: its sites and powers are read from its manifest`);
        expect(a.badge === 'yellow' && reasonIds(a) === 'A03,A07', `${label}: judged yellow for A03 and A07 (${a.badge} ${reasonIds(a)})`);
      }
      const c = addon('Weather Tab Checkup');
      expect(Boolean(c), `${label}: the search-changing add-on is found (${JSON.stringify(p.extC)})`);
      if (c) expect(c.searchUrl && c.badge === 'orange' && reasonIds(c) === 'A03,A09', `${label}: its search engine is read and judged orange for A03 and A09 (${c.searchUrl} ${c.badge} ${reasonIds(c)})`);
      // --load-extension: branded Chrome dropped it (137+); whether it was taken at all is the browser's call.
      const rawB = JSON.stringify(readJsonQuiet(path.join(OUT, `${p.id}-Preferences.json`))) + JSON.stringify(readJsonQuiet(path.join(OUT, `${p.id}-Secure-Preferences.json`)));
      const bTaken = rawB.includes(extDir('B').replace(/\\/g, '\\\\'));
      const bAddon = addon('PayPal Wallet Checkup');
      if (bTaken || bAddon) {
        expect(Boolean(bAddon) && bAddon.source === 'commandline' && bAddon.badge === 'orange' && reasonIds(bAddon) === 'A04,A08,A10', `${label}: the add-on forced in by a start command is judged orange for A04, A08, A10 (${bAddon ? `${bAddon.source} ${bAddon.badge} ${reasonIds(bAddon)}` : 'not found'})`);
      } else {
        console.log(`NOTE  ${label}: the browser ignored --load-extension, so there is no start-command add-on to find`);
      }
      if (p.search && p.search.ok) {
        expect(prof.search && prof.search.host === 'www.bing.com' && prof.search.known === true && prof.search.engine === 'Bing' && !prof.search.badge, `${label}: the default search engine the person chose (Bing) is read and left alone (${JSON.stringify(prof.search)})`);
        wanted.push('https://www.bing.com/');
      } else if (p.id === 'edge' && unsupported(p.search)) {
        console.log(`NOTE  ${label}: its settings page has no search engine handler a script can call (${p.search.error}), so its default search engine stays as installed`);
      } else {
        expect(false, `${label}: the default search engine could be set through the settings page (${JSON.stringify(p.search)})`);
      }
      const startSet = p.startup && p.startup.ok;
      expect(startSet && prof.startup.includes(C.startup), `${label}: the start page is read (set by the browser: ${JSON.stringify(p.startup)})`);
      if (p.id === 'chrome') {
        expect(b.policies && b.policies.badge === 'orange' && b.policies.risky.includes('ExtensionInstallForcelist'), `chrome: the forced-install policy in the registry is read and judged orange (${JSON.stringify(b.policies)})`);
      }
    }
    const notifSet = p.id === 'firefox' ? !p.error : p.notifications && p.notifications.ok;
    if (!notifSet && p.id === 'edge' && unsupported(p.notifications)) console.log(`NOTE  ${label}: its settings page has no site settings handler a script can call (${p.notifications.error}), so no notification permission could be given`);
    else expect(notifSet && Array.isArray(prof.notifications) && prof.notifications.includes('https://example-notify.test'), `${label}: the site allowed to send notifications is read (${JSON.stringify(prof.notifications)})`);
    expect(Array.isArray(prof.notifications) && !prof.notifications.includes('https://blocked-notify.test'), `${label}: the blocked site is not listed as allowed`);
    if (p.id === 'firefox') expect(prof.startup.includes(C.startup), `firefox: the home page is read (${JSON.stringify(prof.startup)})`);
  }

  for (const u of wanted) expect(urls.includes(u), `addressesOf lists ${u}`);
  expect(urls.every((u) => /^https?:\/\//.test(u)), 'addressesOf lists web addresses only');

  const changed = diff(settled, after).filter((f) => !noise.has(f));
  expect(changed.length === 0, `not one browser file changed while the checkup read them (${settled.size} files hashed${changed.length ? `; changed: ${changed.slice(0, 10).join(', ')}` : ''}${noise.size ? `; ${noise.size} file(s) already changing on their own, left out` : ''})`);
  const leftovers = tempLeftovers().filter((n) => !tmpBefore.includes(n));
  expect(leftovers.length === 0, `the private copy of permissions.sqlite is deleted (${leftovers.join(', ') || 'none left'})`);

  console.log(`\n${failures.length ? 'FAIL' : 'PASS'}  checkup on real profiles, ${runtime}: ${failures.length} failure(s)`);
  return failures.length ? 1 : 0;
}
function readJsonQuiet(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (MODE === 'prepare') {
    writeExtensions();
    const browsers = [];
    const save = () => fs.writeFileSync(path.join(OUT, 'prepare.json'), JSON.stringify({ browsers }, null, 2));
    for (const b of BROWSERS) { log(`${b.id}: preparing`); browsers.push(await prepareChromium(b)); save(); }
    log('firefox: preparing');
    browsers.push(await prepareFirefox());
    fs.writeFileSync(path.join(OUT, 'prepare.json'), JSON.stringify({ browsers }, null, 2));
    for (const b of browsers) console.log(`${b.id}: ${JSON.stringify(b, null, 1)}`);
    return 0;
  }
  if (MODE === 'check') return check();
  console.log('usage: node scripts/verify-checkup.js prepare|check [--out dir]');
  return 2;
}

main().then((code) => process.exit(code), (err) => { console.log(`FAIL  ${err.stack || err.message}`); process.exit(1); });
