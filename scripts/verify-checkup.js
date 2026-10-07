'use strict';
/**
 * The browser checkup (desktop/src/checkup.js) against real browser profiles: meant for CI
 * (.github/workflows/checkup-e2e.yml), never a person's computer, because it changes the browsers' own default
 * profiles.
 *
 *   node scripts/verify-checkup.js prepare [--out dir]   Chrome and Edge: their default profile, over the DevTools
 *                                                        pipe: a site allowed (and one blocked) to send
 *                                                        notifications, a start page, a made-up search engine as the
 *                                                        default, and test add-ons. Firefox: a profile with the same
 *                                                        notification permissions, a home page and an unsigned add-on.
 *   node scripts/verify-checkup.js check [--out dir]     Runs checkup.collect() and addressesOf() on those profiles,
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
  amo: 'https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi',
  searchName: 'Checkup Search', keyword: 'checkupsearch', searchUrl: 'https://search.checkup-hijack.test/s?q=%s', searchHost: 'search.checkup-hijack.test'
};
const BROWSERS = [
  { id: 'chrome', userData: path.join(LOCAL, 'Google', 'Chrome', 'User Data'), settings: 'chrome://settings' },
  { id: 'edge', userData: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data'), settings: 'edge://settings' }
];
const FF_PROFILE = path.join(ROAMING, 'Mozilla', 'Firefox', 'Profiles', 'chk00001.default-release');
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

const exited = (child, ms) => new Promise((resolve) => {
  if (child.exitCode !== null) return resolve(true);
  const t = setTimeout(() => resolve(false), ms);
  child.once('exit', () => { clearTimeout(t); resolve(true); });
});

/* -------------------------------------------------------------------- prepare: Chromium */

// Runs in the browser's own settings page, through the page's own browser proxies when the page exports them
// (Chrome's settings.js), else the raw message names the same handlers listen to.
const SETTINGS_SCRIPT = `(async (C) => {
  const out = { steps: {} };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = async (name, fn) => { try { out.steps[name] = { ok: true, value: await fn() }; } catch (e) { out.steps[name] = { ok: false, error: String((e && e.message) || e) }; } };
  let settings = null, cr = null;
  try { settings = await import(location.origin + '/settings.js'); } catch (e) { out.settingsModule = String(e.message || e); }
  for (const u of [location.protocol + '//resources/js/cr.js', 'chrome://resources/js/cr.js']) { try { cr = await import(u); break; } catch { /* next */ } }
  out.cr = Boolean(cr);
  const ask = (m, ...a) => cr.sendWithPromise(m, ...a);
  const site = settings && settings.SiteSettingsPrefsBrowserProxyImpl ? settings.SiteSettingsPrefsBrowserProxyImpl.getInstance() : null;
  const engines = settings && settings.SearchEnginesBrowserProxyImpl ? settings.SearchEnginesBrowserProxyImpl.getInstance() : null;
  out.proxies = { site: Boolean(site), engines: Boolean(engines), settingsPrivate: Boolean(chrome.settingsPrivate) };

  await step('notifications', async () => {
    for (const [p, v] of [[C.allow, 'allow'], [C.block, 'block']]) {
      if (site) site.setCategoryPermissionForPattern(p, '', 'notifications', v, false);
      else chrome.send('setCategoryPermissionForPattern', [p, '', 'notifications', v, false]);
    }
    await wait(800);
    const list = site ? await site.getExceptionList('notifications') : await ask('getExceptionList', 'notifications');
    return JSON.parse(JSON.stringify(list));
  });

  await step('startup', async () => {
    const sp = (k, v) => new Promise((r) => chrome.settingsPrivate.setPref(k, v, '', r));
    const gp = (k) => new Promise((r) => chrome.settingsPrivate.getPref(k, r));
    const a = await sp('session.restore_on_startup', 4);
    const b = await sp('session.startup_urls', [C.startup]);
    return { setRestore: a, setUrls: b, restore: (await gp('session.restore_on_startup') || {}).value, urls: (await gp('session.startup_urls') || {}).value };
  });
  return out;
})`;

const SEARCH_SCRIPT = `(async (C) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let settings = null, cr = null;
  try { settings = await import(location.origin + '/settings.js'); } catch { /* none */ }
  for (const u of [location.protocol + '//resources/js/cr.js', 'chrome://resources/js/cr.js']) { try { cr = await import(u); break; } catch { /* next */ } }
  const engines = settings && settings.SearchEnginesBrowserProxyImpl ? settings.SearchEnginesBrowserProxyImpl.getInstance() : null;
  if (!engines && !cr) throw new Error('this settings page has neither a search engines proxy nor cr.js');
  const list = () => engines ? engines.getSearchEnginesList() : cr.sendWithPromise('getSearchEnginesList');
  const all = (l) => [...(l.defaults || []), ...(l.actives || []), ...(l.others || []), ...(l.extensions || [])];
  if (engines) { engines.searchEngineEditStarted(-1); engines.searchEngineEditCompleted(C.searchName, C.keyword, C.searchUrl); }
  else { chrome.send('searchEngineEditStarted', [-1]); chrome.send('searchEngineEditCompleted', [C.searchName, C.keyword, C.searchUrl]); }
  let mine = null;
  for (let i = 0; i < 20 && !mine; i++) { await wait(250); mine = all(await list()).find((e) => String(e.url).includes(C.searchHost)); }
  if (!mine) throw new Error('the made-up engine was not added; engines: ' + all(await list()).map((e) => e.url).join(' '));
  if (engines) engines.setDefaultSearchEngine(mine.modelIndex, 0, false);
  else chrome.send('setDefaultSearchEngine', [mine.modelIndex, 0]);
  await wait(800);
  const now = all(await list()).find((e) => e.default);
  return { added: mine.url, defaultNow: now ? now.url : null };
})`;

async function prepareChromium(b) {
  const exe = (CANDIDATES[b.id] || []).map(expand).find((p) => fs.existsSync(p));
  if (!exe) return { id: b.id, error: 'not installed' };
  const out = { id: b.id, exe, userData: b.userData };
  // The default profile of the runner's own user: the real files, where a person's browser keeps them. Chrome and
  // Edge 136+ refuse DevTools on their default folder (so other programs cannot steal cookies through it); the same
  // folder is reached here through a junction, which they do not take for the default.
  fs.mkdirSync(b.userData, { recursive: true });
  const via = path.join(os.tmpdir(), `checkup-${b.id}-userdata`);
  try { fs.rmSync(via, { force: true, recursive: false }); } catch { /* none */ }
  fs.symlinkSync(b.userData, via, 'junction');
  out.via = via;
  const child = spawn(exe, [
    '--headless=new', `--user-data-dir=${via}`, '--profile-directory=Default',
    '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch', `--load-extension=${extDir('B')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const send = cdpPipe(child);
  const evalIn = async (sessionId, fn) => {
    const r = await send('Runtime.evaluate', { expression: `${fn}(${JSON.stringify(C)})`, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value;
  };
  try {
    out.version = (await Promise.race([send('Browser.getVersion'), sleep(90000).then(() => { throw new Error('no answer on the DevTools pipe'); })])).product;
    // CDP's own grant, for completeness: an in-memory override, so the settings page below is what writes the file.
    out.grantPermissions = await send('Browser.grantPermissions', { permissions: ['notifications'], origin: 'https://example-notify.test' }).then(() => 'ok', (e) => e.message);

    const { targetId } = await send('Target.createTarget', { url: b.settings });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      await sleep(250);
      ready = await send('Runtime.evaluate', { expression: "document.readyState === 'complete' && typeof chrome !== 'undefined' && typeof chrome.send === 'function'", returnByValue: true }, sessionId).then((r) => r.result.value, () => false);
    }
    out.settingsPage = ready;
    out.settings = await evalIn(sessionId, SETTINGS_SCRIPT).catch((e) => ({ error: e.message }));

    out.extA = await send('Extensions.loadUnpacked', { path: extDir('A') }).then((r) => r.id, (e) => `error: ${e.message}`);
    // The search engine last but one: a handler given the wrong arguments may take the browser down, and what was
    // set above is then still lost, so it is only tried after the add-ons that matter most.
    out.search = await evalIn(sessionId, SEARCH_SCRIPT).catch((e) => ({ error: e.message }));
    out.extC = await send('Extensions.loadUnpacked', { path: extDir('C') }).then((r) => r.id, (e) => `error: ${e.message}`);
    await sleep(2000);
    await send('Browser.close').catch(() => {});
  } catch (err) {
    out.error = err.message;
  }
  out.cleanExit = await exited(child, 30000);
  if (!out.cleanExit) child.kill();
  await sleep(3000);   // helper processes letting go of the profile
  // What the browser wrote, for the record (and the artifact).
  for (const f of ['Preferences', 'Secure Preferences']) {
    const src = path.join(b.userData, 'Default', f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, `${b.id}-${f.replace(' ', '-')}.json`));
  }
  return out;
}

/* -------------------------------------------------------------------- prepare: Firefox */

async function prepareFirefox() {
  if (!FIREFOX) return { id: 'firefox', error: 'not installed' };
  const out = { id: 'firefox', exe: FIREFOX, profile: FF_PROFILE };
  fs.mkdirSync(path.join(FF_PROFILE, 'extensions'), { recursive: true });
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
          return { unsigned, store };
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
  for (const f of ['extensions.json', 'prefs.js']) {
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

  const roots = [...BROWSERS.map((b) => b.userData), FF_PROFILE, path.join(OUT, 'ext')];
  const before = hashTree(roots);
  await sleep(3000);
  const settled = hashTree(roots);
  const noise = new Set(diff(before, settled));
  const tmpBefore = tempLeftovers();

  let result;
  try {
    result = await checkup.collect({ managed: false });
  } finally {
    execFileSync('reg', ['delete', 'HKCU\\Software\\Policies\\Google\\Chrome', '/f']);
  }
  const urls = checkup.addressesOf(result);
  const after = hashTree(roots);
  fs.writeFileSync(path.join(OUT, `result-${process.versions.electron ? 'electron' : 'node'}.json`), JSON.stringify({ runtime, managedDetected: checkup._test.isManaged(), result, urls }, null, 2));
  console.log(`\n${runtime}: ${result.browsers.length} browser(s); detected managed=${checkup._test.isManaged()}`);

  const ours = new Set(['Coupon Helper Checkup', 'PayPal Wallet Checkup', 'Weather Tab Checkup', 'Video Saver Checkup', 'uBlock Origin']);
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
    } else {
      const a = addon('Coupon Helper Checkup');
      expect(Boolean(a), `${label}: the add-on loaded from a folder is found (${p.extA})`);
      if (a) {
        expect(a.source === 'unpacked' && a.enabled, `${label}: it is read as loaded from a folder, enabled (source=${a.source} enabled=${a.enabled})`);
        expect(a.hosts.includes('<all_urls>') && a.permissions.includes('cookies'), `${label}: its sites and powers are read from its manifest`);
        expect(a.badge === 'yellow' && reasonIds(a) === 'A03,A07', `${label}: judged yellow for A03 and A07 (${a.badge} ${reasonIds(a)})`);
      }
      const c = addon('Weather Tab Checkup');
      expect(Boolean(c), `${label}: the search-changing add-on is found (${p.extC})`);
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
      const searchSet = p.search && !p.search.error;
      if (searchSet) {
        expect(prof.search && prof.search.host === C.searchHost && prof.search.known === false && prof.search.badge === 'yellow', `${label}: the made-up default search engine is read and judged yellow (${JSON.stringify(prof.search)})`);
      } else {
        expect(false, `${label}: the default search engine could be set through the settings page (${p.search && p.search.error})`);
      }
      const startSet = p.settings && p.settings.steps && p.settings.steps.startup && p.settings.steps.startup.ok;
      expect(startSet && prof.startup.includes(C.startup), `${label}: the start page is read (set by the browser: ${JSON.stringify(p.settings && p.settings.steps && p.settings.steps.startup)})`);
      if (p.id === 'chrome') {
        expect(b.policies && b.policies.badge === 'orange' && b.policies.risky.includes('ExtensionInstallForcelist'), `chrome: the forced-install policy in the registry is read and judged orange (${JSON.stringify(b.policies)})`);
      }
    }
    const notifSet = p.id === 'firefox' ? !p.error : p.settings && p.settings.steps && p.settings.steps.notifications && p.settings.steps.notifications.ok;
    expect(notifSet && Array.isArray(prof.notifications) && prof.notifications.includes('https://example-notify.test'), `${label}: the site allowed to send notifications is read (${JSON.stringify(prof.notifications)})`);
    expect(Array.isArray(prof.notifications) && !prof.notifications.includes('https://blocked-notify.test'), `${label}: the blocked site is not listed as allowed`);
    if (p.id === 'firefox') expect(prof.startup.includes(C.startup), `firefox: the home page is read (${JSON.stringify(prof.startup)})`);
  }

  for (const u of ['https://example-notify.test/', `https://${C.searchHost}/`, C.startup]) expect(urls.includes(u), `addressesOf lists ${u}`);
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
    for (const b of BROWSERS) browsers.push(await prepareChromium(b));
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
