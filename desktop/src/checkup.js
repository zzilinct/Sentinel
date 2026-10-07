'use strict';
/**
 * Browser checkup: the add-ons, notification permissions, search engine and startup pages of every browser on this
 * computer, looked over for the ones scammers and unwanted software plant.
 *
 * What it reads, only when the person runs the checkup, and only to read: each browser profile's own settings files.
 *   Chrome, Edge, Brave, Vivaldi,  Preferences and Secure Preferences (installed add-ons, the sites allowed to send
 *   Opera, Opera GX                notifications, the search engine, the pages it opens on start), and each add-on's
 *                                  manifest.json (its name and what it may do).
 *   Firefox, LibreWolf             profiles.ini (which profiles are in use), extensions.json, prefs.js (the home page),
 *                                  search.json.mozlz4 (the search engine), and permissions.sqlite (notification
 *                                  permissions), read from a copy in a private temporary folder that is deleted at once.
 *   Windows                        the browser policy keys in the registry (HKCU and HKLM\Software\Policies).
 * The browsers, and where each keeps its settings, are browsers.js BROWSERS: one list for the whole app. One it cannot
 * read yet (DuckDuckGo) is named in the result as not checked, never silently left out.
 * History, passwords, cookies, form data and open tabs are never opened. Nothing is written: a browser checks its
 * own settings files, and one half-written by another program is worse than a bad add-on. Removing anything is the
 * person's own click, in the browser, where it can be undone.
 * Add-ons are judged on this computer (server/lib/scan/addons.js, loaded here directly). The site addresses found are
 * returned to main.js, which checks them the fast way, by address only: no site is ever opened.
 * main.js runs it on a worker thread (collectAside): many profiles and large settings files are read without holding
 * up the app.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { BROWSERS, installed } = require('./browsers');
const { judgeAddon, judgeSearch, judgePolicies, fromStoreUpdate } = require('../shared/addons');

// Where the person goes to look and remove, in each browser. Typed or pasted: a browser does not let another
// program open its own pages for it.
function places(b) {
  if (!b.scheme) {
    return { addons: 'about:addons', notifications: 'about:preferences#privacy', search: 'about:preferences#search', startup: 'about:preferences#home', policies: 'about:policies' };
  }
  return { addons: `${b.scheme}://extensions`, notifications: `${b.scheme}://settings/content/notifications`, search: `${b.scheme}://settings`, startup: `${b.scheme}://settings`, policies: `${b.scheme}://policy` };
}

// Chromium's install locations (extensions/common/mojom/manifest.mojom). Component and built-in ones are the
// browser's own and are left out.
const LOCATION = { 1: 'store', 2: 'external', 3: 'external', 4: 'unpacked', 6: 'external', 7: 'policy', 8: 'commandline', 9: 'policy' };
const BUILT_IN = new Set([5, 10]);
// Gecko locations that are the browser's own. Firefox 15x keeps its own add-ons (New Tab, Form Autofill,
// Picture-in-Picture, webcompat) in "app-builtin-addons".
const GECKO_BUILT_IN = /^app-(builtin|builtin-addons|system-defaults|system-addons|system-share|system-local)$/;

const MAX_JSON = 32 * 1024 * 1024;
function readJson(file) {
  try {
    if (fs.statSync(file).size > MAX_JSON) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch { return null; }
}
const get = (o, keys) => keys.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const webOnly = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

/** An add-on's name, with "__MSG_appName__" looked up in its own translations. */
function addonName(dir, manifest) {
  const raw = String(manifest.name || '');
  const m = /^__MSG_(.+)__$/.exec(raw);
  if (!m) return raw;
  for (const locale of [manifest.default_locale, 'en', 'en_US'].filter(Boolean)) {
    const messages = readJson(path.join(dir, '_locales', locale, 'messages.json'));
    if (!messages) continue;
    const key = Object.keys(messages).find((k) => k.toLowerCase() === m[1].toLowerCase());
    if (key && messages[key] && messages[key].message) return String(messages[key].message);
  }
  return raw;
}

/** The folder an installed Chromium add-on lives in: its recorded path, or its newest version folder. */
function addonDir(profile, id, recorded) {
  if (recorded && path.isAbsolute(recorded)) return recorded;
  if (recorded) return path.join(profile, 'Extensions', recorded);
  try {
    const versions = fs.readdirSync(path.join(profile, 'Extensions', id)).sort();
    return versions.length ? path.join(profile, 'Extensions', id, versions[versions.length - 1]) : null;
  } catch { return null; }
}

/** The origin of a Chromium content-settings pattern ("https://x.com:443,*", "[*.]x.com,*"), or null. */
function patternOrigin(key) {
  let p = String(key).split(',')[0].trim().replace(/^\[\*\.\]/, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) p = `https://${p}`;
  try { const u = new URL(p); return /^https?:$/.test(u.protocol) && !u.hostname.includes('*') ? u.origin : null; } catch { return null; }
}

/** One Chromium profile folder: { addons, notifications, search, startup }. */
function readChromiumProfile(profile) {
  const prefs = readJson(path.join(profile, 'Preferences')) || {};
  const secure = readJson(path.join(profile, 'Secure Preferences')) || {};
  // Newer builds keep add-ons and the protected settings in Secure Preferences; older ones in Preferences.
  const pick = (keys) => get(secure, keys) !== undefined ? get(secure, keys) : get(prefs, keys);

  // Opera and Opera GX keep the same records under "opsettings" (seen on CI, Opera 137).
  const settings = {};
  for (const key of ['settings', 'opsettings']) Object.assign(settings, get(prefs, ['extensions', key]) || {}, get(secure, ['extensions', key]) || {});
  const addons = [];
  for (const [id, s] of Object.entries(settings)) {
    if (!s || typeof s !== 'object' || BUILT_IN.has(s.location) || s.was_installed_by_default || s.was_installed_by_oem) continue;
    const dir = addonDir(profile, id, s.path);
    const manifest = (s.manifest && typeof s.manifest === 'object' ? s.manifest : null) || (dir && readJson(path.join(dir, 'manifest.json')));
    if (!manifest || manifest.theme || manifest.app) continue;
    const reasons = s.disable_reasons;
    const disabled = s.state === 0 || (Array.isArray(reasons) ? reasons.length > 0 : Number(reasons) > 0);
    const fromStore = fromStoreUpdate(manifest.update_url);
    const source = LOCATION[s.location] === 'store' || LOCATION[s.location] === undefined ? (fromStore ? 'store' : 'outside') : LOCATION[s.location];
    const hosts = [...(manifest.host_permissions || []), ...((manifest.content_scripts || []).flatMap((c) => (c && c.matches) || []))];
    const overrides = manifest.chrome_settings_overrides || {};
    addons.push({
      id, name: dir ? addonName(dir, manifest) : String(manifest.name || id), version: String(manifest.version || ''),
      source, fromStore, enabled: !disabled,
      permissions: (manifest.permissions || []).filter((p) => typeof p === 'string'), hosts: hosts.filter((p) => typeof p === 'string'),
      searchUrl: get(overrides, ['search_provider', 'search_url']) || null
    });
  }

  const exceptions = get(prefs, ['profile', 'content_settings', 'exceptions', 'notifications']) || {};
  const notifications = [...new Set(Object.entries(exceptions)
    .filter(([, v]) => v && v.setting === 1)     // 1 is "allow"; 2 is "block", 3 is "ask"
    .map(([k]) => patternOrigin(k)).filter(Boolean))];

  const template = pick(['default_search_provider_data', 'template_url_data']);
  const search = template && template.url ? { name: String(template.short_name || ''), url: String(template.url) } : null;
  // 4 is "open a specific page or set of pages".
  const startup = pick(['session', 'restore_on_startup']) === 4 ? (pick(['session', 'startup_urls']) || []).map(webOnly).filter(Boolean) : [];

  return { name: String(get(prefs, ['profile', 'name']) || path.basename(profile)), addons, notifications, search, startup };
}

/** Gecko's notification permissions, from a copy of permissions.sqlite (the browser may hold the original open). */
function geckoNotifications(profile) {
  const file = path.join(profile, 'permissions.sqlite');
  if (!fs.existsSync(file)) return [];
  let tmp = null;
  let db = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-checkup-'));
    fs.copyFileSync(file, path.join(tmp, 'p.sqlite'));
    if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, path.join(tmp, 'p.sqlite-wal'));
    db = new DatabaseSync(path.join(tmp, 'p.sqlite'));
    const rows = db.prepare("SELECT origin FROM moz_perms WHERE type = 'desktop-notification' AND permission = 1").all();
    return [...new Set(rows.map((r) => { try { const u = new URL(r.origin); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } }).filter(Boolean))];
  } catch {
    return null;   // could not be read: said so, not taken as "none"
  } finally {
    try { if (db) db.close(); } catch { /* closed */ }
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** One Gecko profile folder: { addons, notifications, search, startup }. `listedName`: its name in profiles.ini. */
function readGeckoProfile(profile, listedName = null) {
  const data = readJson(path.join(profile, 'extensions.json')) || {};
  const addons = [];
  for (const a of data.addons || []) {
    if (!a || a.type !== 'extension' || GECKO_BUILT_IN.test(String(a.location || '')) || a.isBuiltin) continue;
    const src = get(a, ['installTelemetryInfo', 'source']);
    // 'sync': brought over by Firefox Sync from the person's other computer, which only carries store add-ons.
    const fromStore = /^https:\/\/addons\.mozilla\.org\//i.test(String(a.sourceURI || '')) || ['amo', 'disco', 'sync'].includes(src);
    const source = a.location === 'temporary-addon' ? 'unpacked'
      : src === 'enterprise-policy' ? 'policy'
        : /^(winreg-app-|app-global$|app-system-user$)/.test(String(a.location || '')) ? 'external'
          : fromStore ? 'store' : 'outside';
    addons.push({
      id: String(a.id || ''), name: String(get(a, ['defaultLocale', 'name']) || a.id || ''), version: String(a.version || ''),
      source, fromStore, enabled: a.active !== false,
      // 2 signed, 3 system, 4 privileged; below that Mozilla did not sign it. Absent: not known.
      signed: typeof a.signedState === 'number' ? a.signedState >= 2 : null,
      permissions: (get(a, ['userPermissions', 'permissions']) || []).filter((p) => typeof p === 'string'),
      hosts: (get(a, ['userPermissions', 'origins']) || []).filter((p) => typeof p === 'string'),
      searchUrl: null
    });
  }
  let startup = [];
  try {
    const prefs = fs.readFileSync(path.join(profile, 'prefs.js'), 'utf8');
    const m = /user_pref\("browser\.startup\.homepage",\s*"((?:[^"\\]|\\.)*)"\)/.exec(prefs);
    if (m) startup = m[1].split('|').map(webOnly).filter(Boolean);
  } catch { /* no prefs yet */ }
  return { name: listedName || path.basename(profile).replace(/^[a-z0-9]{8}\./i, ''), addons, notifications: geckoNotifications(profile), search: geckoSearch(profile), startup };
}

/** Mozilla's "mozLz40" file: an 8-byte magic, the decompressed size, then one LZ4 block. */
function mozLz4(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 8) !== 'mozLz40\0') throw new Error('not a mozLz4 file');
  const size = buf.readUInt32LE(8);
  if (size > MAX_JSON) throw new Error('too large');
  const out = Buffer.alloc(size);
  let i = 12;
  let o = 0;
  const more = (n) => { let b; do { b = buf[i++]; n += b; } while (b === 255 && i < buf.length); return n; };
  while (i < buf.length) {
    const token = buf[i++];
    let n = token >> 4;
    if (n === 15) n = more(n);
    buf.copy(out, o, i, i + n);
    i += n;
    o += n;
    if (i >= buf.length) break;            // the last sequence is literals only
    const offset = buf.readUInt16LE(i);
    i += 2;
    if (!offset || offset > o) throw new Error('bad block');
    let m = token & 15;
    if (m === 15) m = more(m);
    for (let end = Math.min(o + m + 4, size); o < end; o++) out[o] = out[o - offset];
  }
  return out.subarray(0, o);
}

/**
 * Firefox's default search engine, from search.json.mozlz4: { name, url, builtIn }, or null when the person kept the
 * browser's own default. builtIn: one of the engines Firefox itself ships (its list, not ours, says it is known).
 * Firefox ignores a choice another program wrote without its hash; this reads the choice as written, so one still shows.
 */
function geckoSearch(profile) {
  let data;
  try {
    const file = path.join(profile, 'search.json.mozlz4');
    if (fs.statSync(file).size > MAX_JSON) return null;
    data = JSON.parse(mozLz4(fs.readFileSync(file)).toString('utf8'));
  } catch { return null; }
  const md = (data && data.metaData) || {};
  const want = (e) => e && ((md.defaultEngineId && e.id === md.defaultEngineId) || (md.current && e._name === md.current));
  const e = (Array.isArray(data.engines) ? data.engines : []).find(want);
  if (!e) return null;
  const u = (Array.isArray(e._urls) ? e._urls : []).find((x) => x && (!x.type || x.type === 'text/html')) || {};
  return { name: String(e._name || ''), url: String(u.template || ''), builtIn: e._isAppProvided === true || /^\[app\]/.test(String(e._loadPath || '')) };
}

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)); } catch { return []; }
}

/** Chromium profiles under a "User Data" folder; Opera (`flat`): the folder itself as well. */
function chromiumProfiles(root, flat) {
  const dirs = subdirs(root).filter((d) => /^(Default|Profile \d+)$/.test(path.basename(d)));
  if (flat) dirs.unshift(root);
  return dirs.filter((d) => fs.existsSync(path.join(d, 'Preferences')));
}

/**
 * The Gecko profiles in use: the ones profiles.ini lists, with the names the person gave them. A folder it no
 * longer lists is a leftover the browser never opens, and its old add-ons are not the person's to worry about.
 * Without profiles.ini (a portable copy), every folder under Profiles.
 */
function geckoProfiles(root) {
  let ini = null;
  try { ini = fs.readFileSync(path.join(root, 'profiles.ini'), 'utf8'); } catch { /* none */ }
  const listed = [];
  if (ini !== null) {
    for (const section of ini.split(/^\s*\[/m).slice(1)) {
      const [head, ...lines] = section.split(/\r?\n/);
      if (!/^Profile\d+\]/i.test(head)) continue;
      const kv = {};
      for (const l of lines) { const m = /^\s*([^=;#\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(l); if (m) kv[m[1]] = m[2]; }
      if (kv.Path) listed.push({ dir: kv.IsRelative === '0' ? kv.Path : path.join(root, ...kv.Path.split(/[\\/]/)), name: kv.Name || null });
    }
  }
  const found = ini !== null ? listed : subdirs(path.join(root, 'Profiles')).map((dir) => ({ dir, name: null }));
  return found.filter((p) => fs.existsSync(path.join(p.dir, 'extensions.json')) || fs.existsSync(path.join(p.dir, 'prefs.js')));
}

/** Windows: the policy names set for a browser, from HKCU and HKLM. */
function readPolicies(key) {
  if (process.platform !== 'win32' || !key) return Promise.resolve([]);
  const one = (hive) => new Promise((resolve) => {
    execFile('reg', ['query', `${hive}\\Software\\Policies\\${key}`, '/s'], { timeout: 8000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      const names = [];
      let section = '';
      for (const line of String(out).split(/\r?\n/)) {
        if (/^HKEY_/i.test(line)) { section = line.split('\\').pop(); continue; }
        const m = /^\s+(\S.*?)\s+REG_\w+/.exec(line);
        // A list policy is a key of its own ("ExtensionInstallForcelist" holding 1, 2, 3): named by the key.
        if (m && m[1] !== '(Default)') names.push(/^\d+$/.test(m[1]) ? section : m[1]);
      }
      resolve(names);
    });
  });
  return Promise.all([one('HKCU'), one('HKLM')]).then(([a, b]) => [...new Set([...a, ...b])]);
}

/** A computer joined to a school or company network, where browser policies are normal. */
function isManaged(env = process.env) {
  const domain = String(env.USERDOMAIN || '').toUpperCase();
  const computer = String(env.COMPUTERNAME || '').toUpperCase();
  return Boolean(domain && computer && domain !== computer);
}

/**
 * Every browser profile on this computer, judged. `local` and `roaming` replace %LOCALAPPDATA% and %APPDATA% (tests).
 * Returns { managed, looked, unchecked, browsers: [{ id, open, name, places, policies, profiles: [{ name, addons,
 * notifications, search, startup }] }] }, add-ons carrying their verdict, and the site addresses still to be checked
 * by address. `looked`: every browser looked for; `unchecked`: browsers installed here that it cannot read yet.
 * `open`: the browsers.js id that "Open" brings forward (Opera GX is Opera's).
 */
async function collect({ local = process.env.LOCALAPPDATA, roaming = process.env.APPDATA, policies = readPolicies, managed = isManaged(), present = installed } = {}) {
  const out = [];
  const looked = [];
  for (const b of BROWSERS) {
    for (const [i, d] of (b.data || []).entries()) {
      const base = d.local ? local : roaming;
      if (!base) continue;
      looked.push(d.name || b.name);
      const root = path.join(base, ...(d.local || d.roaming));
      const profiles = b.engine === 'gecko'
        ? geckoProfiles(root).map((p) => readGeckoProfile(p.dir, p.name))
        : chromiumProfiles(root, d.flat).map((dir) => readChromiumProfile(dir));
      const names = b.policy && i === 0 ? await policies(b.policy).catch(() => []) : [];
      if (!profiles.length && !names.length) continue;
      for (const p of profiles) {
        for (const a of p.addons) Object.assign(a, judgeAddon(a, { managed }));
        if (p.search) {
          const s = judgeSearch(p.search.url);
          const known = s.known || Boolean(p.search.builtIn);
          p.search = { ...p.search, ...s, known, badge: s.host && !known ? 'yellow' : null };
        }
      }
      out.push({ id: d.id || b.id, open: b.id, name: d.name || b.name, places: places(b), policies: judgePolicies(names, { managed }), profiles });
    }
  }
  const unchecked = (await Promise.resolve().then(present).catch(() => [])).filter((b) => !b.data).map((b) => b.name);
  return { managed, looked, unchecked, browsers: out };
}

/**
 * collect() on a worker thread, so reading many profiles and large settings files never holds up the app's main
 * process (the live-scanning overlay and the tray keep answering). Takes collect's plain options.
 */
function collectAside(opts = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { checkup: opts } });
    w.once('message', (m) => (m && m.error ? reject(new Error(m.error)) : resolve(m)));
    w.once('error', reject);
    w.once('exit', (code) => reject(new Error(`the checkup stopped (${code})`)));   // after a message: ignored
  });
}
if (!isMainThread && workerData && workerData.checkup) {
  collect(workerData.checkup).then((r) => parentPort.postMessage(r), (err) => parentPort.postMessage({ error: String(err && err.message) }));
}

/** The web addresses a checkup found, for the fast scan: notification sites, search engines, startup pages. */
function addressesOf(result) {
  const urls = new Set();
  for (const b of result.browsers) {
    for (const p of b.profiles) {
      for (const o of p.notifications || []) urls.add(`${o}/`);
      if (p.search && p.search.host) urls.add(`https://${p.search.host}/`);
      for (const u of p.startup || []) urls.add(u);
    }
  }
  return [...urls];
}

/**
 * Puts the fast scan's verdicts (`byUrl`, as /api/v1/live/batch returns them) beside the addresses they are for.
 * An address with no verdict (the scan could not run) gets null, which the app shows as "not checked".
 */
function attach(result, byUrl = {}) {
  const verdict = (u) => {
    const v = byUrl[u];
    return v && v.overall ? { badge: v.overall.badge || null, label: String(v.overall.label || ''), reason: String((v.reasons && v.reasons[0] && v.reasons[0].text) || '') } : null;
  };
  for (const b of result.browsers) {
    for (const p of b.profiles) {
      if (p.notifications) p.notifications = p.notifications.map((o) => ({ origin: o, verdict: verdict(`${o}/`) }));
      p.startup = (p.startup || []).map((u) => ({ url: u, verdict: verdict(u) }));
      if (p.search && p.search.host) p.search.verdict = verdict(`https://${p.search.host}/`);
    }
  }
  return result;
}

module.exports = { collect, collectAside, addressesOf, attach, _test: { readChromiumProfile, readGeckoProfile, geckoProfiles, geckoSearch, mozLz4, patternOrigin, isManaged, places } };
