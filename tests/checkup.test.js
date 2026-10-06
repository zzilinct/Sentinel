'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('../desktop/scripts/sync-shared.js');
const { judgeAddon, judgeSearch, judgePolicies } = require('../server/lib/scan/addons');
const checkup = require('../desktop/src/checkup.js');
const { readChromiumProfile, readGeckoProfile, patternOrigin, isManaged } = checkup._test;

const STORE = 'https://clients2.google.com/service/update2/crx';

test('add-ons people really use are left alone', () => {
  // An ad blocker or password manager: every site and strong rights, from the store.
  const blocker = judgeAddon({ name: 'uBlock Origin', source: 'store', fromStore: true, permissions: ['webRequest', 'webRequestBlocking', 'storage'], hosts: ['<all_urls>'] });
  assert.equal(blocker.badge, null);
  assert.ok(blocker.reasons.some((r) => r.id === 'A07'), 'what it can do is still said');
  const manager = judgeAddon({ name: 'Bitwarden Password Manager', source: 'store', fromStore: true, permissions: ['cookies', 'nativeMessaging', 'tabs'], hosts: ['https://*/*'] });
  assert.equal(manager.badge, null);
  // A developer's own add-on, loaded from a folder, that touches one site.
  assert.equal(judgeAddon({ name: 'My test', source: 'unpacked', permissions: ['storage'], hosts: ['https://example.com/*'] }).badge, null);
  // A store add-on that sets a known search engine is described, not flagged.
  const bing = judgeAddon({ name: 'Bing search', source: 'store', fromStore: true, searchUrl: 'https://www.bing.com/search?q={searchTerms}' });
  assert.equal(bing.badge, null);
  assert.deepEqual(bing.notes, ['Sets your search engine to Bing.']);
  // On a company computer, a policy add-on is the company's.
  assert.equal(judgeAddon({ name: 'Company SSO', source: 'policy', fromStore: false, hosts: ['<all_urls>'] }, { managed: true }).badge, null);
});

test('add-ons that unwanted software plants are flagged, and never red', () => {
  const cases = [
    ['outside the store', { name: 'PDF Converter Pro', source: 'outside', fromStore: false }, 'yellow'],
    ['outside the store, every site, cookies', { name: 'Coupon Helper', source: 'outside', fromStore: false, permissions: ['cookies'], hosts: ['<all_urls>'] }, 'orange'],
    ['forced in by a policy', { name: 'Search Tool', source: 'policy', fromStore: false }, 'orange'],
    ['loaded by a start command', { name: 'Helper', source: 'commandline', hosts: ['*://*/*'] }, 'orange'],
    ['changes search to an unknown engine', { name: 'Weather', source: 'store', fromStore: true, searchUrl: 'https://search.weathertabs-now.xyz/q?s={searchTerms}' }, 'yellow'],
    ['a bank\'s name, not from a store', { name: 'Chase Secure Login', source: 'external', fromStore: false }, 'orange'],
    ['unsigned Firefox add-on with every site', { name: 'Video Saver', source: 'outside', fromStore: false, signed: false, hosts: ['<all_urls>'] }, 'orange']
  ];
  for (const [what, addon, badge] of cases) {
    const v = judgeAddon(addon);
    assert.equal(v.badge, badge, `${what}: ${JSON.stringify(v.reasons)}`);
    assert.ok(v.reasons.every((r) => r.text && !/—/.test(r.text)), 'every reason explains itself, without em dashes');
  }
  const worst = judgeAddon({ name: 'PayPal Wallet', source: 'commandline', fromStore: false, signed: false, permissions: ['cookies', 'proxy', 'debugger'], hosts: ['<all_urls>'], searchUrl: 'http://findit.example/q={searchTerms}' });
  assert.equal(worst.badge, 'orange', 'no list of known bad add-ons, so no confirmed verdict');
  // An ordinary word that is also a brand ("Wise") is only weighed when the add-on is already outside the store.
  assert.equal(judgeAddon({ name: 'Wise Volume Booster', source: 'store', fromStore: true }).reasons.length, 0);
});

test('search engines: the known ones, and the rest', () => {
  assert.equal(judgeSearch('{google:baseURL}search?q={searchTerms}').engine, 'Google');
  assert.equal(judgeSearch('https://www.google.co.uk/search?q={searchTerms}').known, true);
  assert.equal(judgeSearch('https://duckduckgo.com/?q={searchTerms}').engine, 'DuckDuckGo');
  assert.equal(judgeSearch('https://uk.search.yahoo.com/search?p={searchTerms}').known, true);
  assert.deepEqual(judgeSearch('https://search.mytab-search.net/s?q={searchTerms}'), { host: 'search.mytab-search.net', known: false, engine: null });
  // A look-alike is not the engine.
  assert.equal(judgeSearch('https://google.search-results.example/q={searchTerms}').known, false);
  assert.equal(judgeSearch('').host, null);
});

test('policies: a hijack on a home computer, normal on a managed one', () => {
  assert.equal(judgePolicies([]), null);
  assert.equal(judgePolicies(['ExtensionInstallForcelist', 'DefaultSearchProviderSearchURL']).badge, 'orange');
  assert.equal(judgePolicies(['ExtensionInstallForcelist'], { managed: true }).badge, null);
  const quiet = judgePolicies(['MetricsReportingEnabled']);
  assert.equal(quiet.badge, null);
  assert.deepEqual(quiet.risky, []);
  assert.equal(isManaged({ USERDOMAIN: 'CONTOSO', COMPUTERNAME: 'LAPTOP-1' }), true);
  assert.equal(isManaged({ USERDOMAIN: 'LAPTOP-1', COMPUTERNAME: 'laptop-1' }), false);
});

test('notification permission patterns become origins', () => {
  assert.equal(patternOrigin('https://news.example.com:443,*'), 'https://news.example.com');
  assert.equal(patternOrigin('[*.]prize-alerts.example,*'), 'https://prize-alerts.example');
  assert.equal(patternOrigin('*,*'), null);
  assert.equal(patternOrigin('chrome-extension://abc,*'), null);
});

// Fixture profiles, written to a temporary folder: settings files only, as the browsers lay them out.
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function fixtureRoots() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-checkup-test-'));
  const local = path.join(tmp, 'Local');
  const roaming = path.join(tmp, 'Roaming');
  const chrome = path.join(local, 'Google', 'Chrome', 'User Data', 'Default');
  writeJson(path.join(chrome, 'Preferences'), {
    profile: { name: 'Person 1', content_settings: { exceptions: { notifications: {
      'https://news.example.com:443,*': { setting: 1 }, 'https://blocked.example:443,*': { setting: 2 }, '[*.]prize-alerts.example,*': { setting: 1 }
    } } } },
    session: { restore_on_startup: 4, startup_urls: ['https://start.example/', 'chrome://newtab/'] }
  });
  writeJson(path.join(chrome, 'Secure Preferences'), {
    extensions: { settings: {
      aaaa: { location: 1, path: 'aaaa/1.0_0' },
      bbbb: { location: 4, path: path.join(tmp, 'dev-addon') },
      cccc: { location: 9, path: 'cccc/2.1_0', disable_reasons: 0 },
      dddd: { location: 5, path: 'dddd/1' },
      eeee: { location: 1, path: 'eeee/1', was_installed_by_default: true }
    } },
    default_search_provider_data: { template_url_data: { short_name: 'MyTab', url: 'https://search.mytab-search.net/s?q={searchTerms}' } }
  });
  writeJson(path.join(chrome, 'Extensions', 'aaaa', '1.0_0', 'manifest.json'), { name: '__MSG_appName__', default_locale: 'en', version: '1.0', update_url: STORE, permissions: ['storage'] });
  writeJson(path.join(chrome, 'Extensions', 'aaaa', '1.0_0', '_locales', 'en', 'messages.json'), { appname: { message: 'Dark Reader' } });
  writeJson(path.join(tmp, 'dev-addon', 'manifest.json'), { name: 'My dev add-on', version: '0.1', permissions: [] });
  writeJson(path.join(chrome, 'Extensions', 'cccc', '2.1_0', 'manifest.json'), {
    name: 'Search Defender', version: '2.1', update_url: 'https://updates.searchdefender.example/crx', permissions: ['cookies'], host_permissions: ['<all_urls>'],
    chrome_settings_overrides: { search_provider: { search_url: 'https://search.mytab-search.net/s?q={searchTerms}' } }
  });
  writeJson(path.join(chrome, 'Extensions', 'dddd', '1', 'manifest.json'), { name: 'Built in', version: '1' });
  // A second folder that is not a profile.
  writeJson(path.join(local, 'Google', 'Chrome', 'User Data', 'System Profile', 'Preferences'), {});

  const fox = path.join(roaming, 'Mozilla', 'Firefox', 'Profiles', 'abcd1234.default-release');
  writeJson(path.join(fox, 'extensions.json'), { addons: [
    { id: 'ublock@example', type: 'extension', location: 'app-profile', active: true, signedState: 2, sourceURI: 'https://addons.mozilla.org/firefox/downloads/file/1/x.xpi', defaultLocale: { name: 'uBlock Origin' }, userPermissions: { permissions: ['webRequest'], origins: ['<all_urls>'] } },
    { id: 'shop@example', type: 'extension', location: 'winreg-app-user', active: true, signedState: 0, defaultLocale: { name: 'Shopping Deals' }, userPermissions: { permissions: ['cookies'], origins: ['<all_urls>'] } },
    { id: 'screenshots@mozilla.org', type: 'extension', location: 'app-builtin', active: true },
    { id: 'theme@example', type: 'theme', location: 'app-profile', active: true }
  ] });
  fs.writeFileSync(path.join(fox, 'prefs.js'), 'user_pref("browser.startup.homepage", "https://home.example/|about:home");\n');
  return { tmp, local, roaming, chrome, fox };
}

test('a Chromium profile is read for add-ons, notifications, search and startup pages, and nothing else', () => {
  const { tmp, chrome } = fixtureRoots();
  try {
    const p = readChromiumProfile(chrome);
    assert.equal(p.name, 'Person 1');
    const byId = Object.fromEntries(p.addons.map((a) => [a.id, a]));
    assert.deepEqual(Object.keys(byId).sort(), ['aaaa', 'bbbb', 'cccc'], 'built-in and default add-ons are the browser\'s own');
    assert.equal(byId.aaaa.name, 'Dark Reader', 'names are looked up in the add-on\'s translations');
    assert.equal(byId.aaaa.source, 'store');
    assert.equal(byId.bbbb.source, 'unpacked');
    assert.equal(byId.cccc.source, 'policy');
    assert.equal(byId.cccc.fromStore, false);
    assert.equal(byId.cccc.searchUrl, 'https://search.mytab-search.net/s?q={searchTerms}');
    assert.deepEqual(p.notifications.sort(), ['https://news.example.com', 'https://prize-alerts.example'], 'only sites that are allowed');
    assert.equal(p.search.url, 'https://search.mytab-search.net/s?q={searchTerms}');
    assert.deepEqual(p.startup, ['https://start.example/'], 'only web pages');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a Firefox profile is read for its add-ons and home page', () => {
  const { tmp, fox } = fixtureRoots();
  try {
    const p = readGeckoProfile(fox);
    assert.equal(p.name, 'default-release');
    assert.deepEqual(p.addons.map((a) => a.id), ['ublock@example', 'shop@example']);
    assert.equal(p.addons[0].source, 'store');
    assert.equal(p.addons[1].source, 'external');
    assert.equal(p.addons[1].signed, false);
    assert.deepEqual(p.startup, ['https://home.example/']);
    assert.deepEqual(p.notifications, [], 'no permissions file: no notification sites');
    // Firefox keeps permissions in SQLite; it is read from a copy, and only notifications that are allowed count.
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(fox, 'permissions.sqlite'));
    db.exec('CREATE TABLE moz_perms (id INTEGER PRIMARY KEY, origin TEXT, type TEXT, permission INTEGER, expireType INTEGER, expireTime INTEGER, modificationTime INTEGER)');
    const put = db.prepare('INSERT INTO moz_perms (origin, type, permission) VALUES (?, ?, ?)');
    put.run('https://alerts.example', 'desktop-notification', 1);
    put.run('https://quiet.example', 'desktop-notification', 2);
    put.run('https://camera.example', 'camera', 1);
    db.close();
    const before = fs.readFileSync(path.join(fox, 'permissions.sqlite'));
    assert.deepEqual(readGeckoProfile(fox).notifications, ['https://alerts.example']);
    assert.ok(fs.readFileSync(path.join(fox, 'permissions.sqlite')).equals(before), 'the browser\'s own file is untouched');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the whole checkup: judged, addresses gathered for the fast scan, verdicts put back', async () => {
  const { tmp, local, roaming } = fixtureRoots();
  try {
    const policies = async (key) => (key === 'Google\\Chrome' ? ['ExtensionInstallForcelist'] : []);
    const result = await checkup.collect({ local, roaming, policies, managed: false });
    assert.deepEqual(result.browsers.map((b) => b.id), ['chrome', 'firefox']);
    const chrome = result.browsers[0];
    assert.equal(chrome.policies.badge, 'orange');
    assert.equal(chrome.places.addons, 'chrome://extensions');
    const p = chrome.profiles[0];
    assert.equal(p.addons.find((a) => a.id === 'cccc').badge, 'orange');
    assert.equal(p.addons.find((a) => a.id === 'aaaa').badge, null);
    assert.equal(p.search.badge, 'yellow');
    assert.equal(result.browsers[1].profiles[0].addons.find((a) => a.id === 'shop@example').badge, 'orange');

    const urls = checkup.addressesOf(result);
    assert.deepEqual(urls.sort(), ['https://home.example/', 'https://news.example.com/', 'https://prize-alerts.example/', 'https://search.mytab-search.net/', 'https://start.example/']);
    checkup.attach(result, {
      'https://prize-alerts.example/': { overall: { badge: 'orange', label: 'Likely scam' }, reasons: [{ text: 'Prize bait in the name' }] },
      'https://news.example.com/': { overall: { badge: null, label: 'No issues found' }, reasons: [] }
    });
    const prize = p.notifications.find((n) => n.origin === 'https://prize-alerts.example');
    assert.deepEqual(prize.verdict, { badge: 'orange', label: 'Likely scam', reason: 'Prize bait in the name' });
    assert.equal(p.notifications.find((n) => n.origin === 'https://news.example.com').verdict.badge, null);
    assert.equal(p.startup[0].verdict, null, 'not checked is not the same as clear');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the checkup only reads: no browser file is written, and it is wired read-only', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'checkup.js'), 'utf8');
  assert.doesNotMatch(src, /writeFile|appendFile|rename|unlink|\bspawn\(|reg', \['(add|delete)/, 'checkup.js writes nothing outside its own temporary copy');
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'main.js'), 'utf8');
  assert.match(main, /apiCall\('\/api\/v1\/live\/batch', \{ urls: urls\.slice\(i, i \+ 60\), private: true, mode: 'fast' \}\)/, 'sites are checked by address, kept out of history');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'preload.js'), 'utf8'), /browserCheckup:/);
});
