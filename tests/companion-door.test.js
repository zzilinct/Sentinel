'use strict';
/**
 * The companion's door (background.js) and its one voice (lib/say.js): a confirmed site is stopped by a browser rule,
 * nothing but a real verdict shows the block page, and the block page, popup and settings all say the same words.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'extension', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const flat = (f) => read(f).replace(/^import\s+[^;]+;\s*$/gm, '').replace(/^export\s+(?=(const|let|function|class|async)\b)/gm, '');
const Say = require('../extension/src/lib/say.js');

const RED = { url: 'http://bad.test/x', host: 'bad.test', threats: { scam: { badge: 'red' } }, reasons: [{ text: 'A fake sign-in' }, { text: 'Young address' }], overall: { badge: 'red', label: 'Confirmed scam' } };

/** The worker with a browser that keeps its rules, like the real one. */
function worker({ list = [], tabUrl = 'http://bad.test/x', fetchVerdict = null, signedOut = false } = {}) {
  const asked = [];
  const dynamic = [];
  const session = [];
  const on = {};
  const listener = (name) => ({ addListener: (f) => { on[name] = f; } });
  const noop = () => {};
  const scripts = [];
  const updates = [];
  const messages = [];
  const update = (rules) => async ({ removeRuleIds = [], addRules = [] }) => {
    for (const id of removeRuleIds) { const i = rules.findIndex((r) => r.id === id); if (i >= 0) rules.splice(i, 1); }
    for (const r of addRules) { assert.ok(!rules.some((x) => x.id === r.id), 'rule ids stay unique'); rules.push(JSON.parse(JSON.stringify(r))); }
  };
  const local = { authToken: 't', account: signedOut ? { signedIn: false } : { signedIn: true, plan: { features: { liveFast: true } }, usage: {} }, intel: { hosts: list.map((host) => ({ host, threat: 'scam' })), at: Date.now() } };
  const area = (store) => ({ get: async (k) => { const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k || {}); return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, store[x]])); }, set: async (o) => { Object.assign(store, o); }, remove: async (k) => { delete store[k]; } });
  const ext = {
    runtime: { id: 'me', getURL: (p) => `chrome-extension://me/${p}`, getManifest: () => ({ content_scripts: [], version: '1' }), onMessage: listener('m'), onMessageExternal: listener('x'), onInstalled: listener('i'), onStartup: listener('s'), lastError: null },
    storage: { local: area(local), session: area({}), sync: { get: async (d) => ({ ...d }), set: async () => {} }, onChanged: listener('c') },
    tabs: { sendMessage: async (tabId, msg, opts) => { messages.push({ tabId, msg, opts }); return null; }, get: async () => ({ id: 7, url: tabUrl }), create: noop, query: async () => [], update: async (id, u) => { updates.push(u); }, onRemoved: listener('removed'), onActivated: listener('a') },
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setTitle: noop },
    alarms: { create: noop, onAlarm: listener('al') },
    contextMenus: { create: noop, onClicked: listener('cm') },
    notifications: { create: noop },
    webNavigation: { onBeforeNavigate: listener('before'), onErrorOccurred: listener('error'), onCommitted: listener('committed'), onCompleted: listener('done'), onHistoryStateUpdated: listener('h'), onReferenceFragmentUpdated: listener('f') },
    permissions: { contains: async () => true },
    scripting: { executeScript: async (o) => { scripts.push(o); } },
    declarativeNetRequest: { getDynamicRules: async () => dynamic, updateDynamicRules: update(dynamic), getSessionRules: async () => session, updateSessionRules: update(session) }
  };
  const ctx = { chrome: ext, crypto: globalThis.crypto, TextEncoder, URL, btoa, atob, Uint8Array, AbortController, AbortSignal, setTimeout, clearTimeout, console, Promise,
    fetch: async (u) => {
      asked.push(String(u));
      if (fetchVerdict && u.includes('/live/visit')) return { ok: true, json: async () => ({ verdict: fetchVerdict }) };
      if (u.includes('/auth/me')) return { ok: true, json: async () => ({ user: {}, plan: { features: { liveFast: true } }, usage: { liveMinutes: {} }, week: {} }) };
      throw new Error('offline');
    } };
  vm.createContext(ctx);
  vm.runInContext(`${[read('lib/store.js'), read('lib/say.js'), flat('lib/brand.js'), flat('lib/api.js'), flat('lib/engine.js'), flat('lib/device.js'), flat('lib/pwalarm.js'), flat('background.js')].join('\n')}\n;this.handlers = handlers; this.syncDoor = syncDoor; this.recalled = recalled; this.localVerdict = localVerdict; this.doorOnAddress = doorOnAddress; this.cacheSet = cacheSet; this.inTabOrder = inTabOrder; this.loadList = loadList; this.liveBatch = liveBatch;`, ctx);
  const blockTab = { id: 'me', url: 'chrome-extension://me/src/block.html', tab: { id: 7, active: true } };
  const call = async (type, msg = {}, sender = blockTab) => { await ctx.recalled; return JSON.parse(JSON.stringify(await ctx.handlers[type]({ type, ...msg }, sender))); };
  const settled = async () => { await ctx.inTabOrder('door', () => {}); };
  return { asked, ctx, dynamic, session, on, scripts, updates, messages, call, settled, blockTab };
}

test('a listed site becomes one browser rule, for main pages only, and the same check matches what the rule matches', async () => {
  const w = worker({ list: ['bad.test', 'www.other.test', 'nasty host!'] });
  await w.ctx.recalled;
  await w.ctx.syncDoor();
  assert.equal(w.dynamic.length, 1);
  const rule = w.dynamic[0];
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
  assert.deepEqual(rule.condition.requestDomains, ['bad.test', 'other.test'], 'bare hosts; one bad entry cannot sink the rule');
  assert.equal(rule.action.redirect.regexSubstitution, 'chrome-extension://me/src/block.html#\\0');
  // requestDomains matches every address under a site: localVerdict must agree, or the block page would wave it through.
  for (const u of ['http://bad.test/', 'http://a.b.bad.test/x', 'http://www.other.test/']) assert.ok(w.ctx.localVerdict(u), u);
  assert.equal(w.ctx.localVerdict('http://notbad.test/'), null);
  await w.ctx.syncDoor();
  assert.equal(w.dynamic.length, 1);
});

test('nothing but a real verdict shows the block page: a written address is let through, and the tab moves on', async () => {
  const w = worker({ list: ['bad.test'] });
  const honest = await w.call('block-info', { url: 'https://bank.example/' });
  assert.equal(honest.pass, true);
  assert.equal(honest.verdict, null);
  assert.equal((await w.call('block-info', { url: 'javascript:alert(1)' })).pass, false, 'never forwarded');
  const bad = await w.call('block-info', { url: 'http://bad.test/x' });
  assert.equal(bad.verdict.overall.badge, 'red');
  assert.ok(!bad.pass);
  await assert.rejects(w.ctx.handlers['block-info']({ url: 'http://bad.test/x' }, { id: 'me', url: 'http://evil.test/', tab: { id: 1 } }), /Not allowed/, 'web pages cannot ask');
});

test('a closed door the worker has forgotten stays closed when the scanner is away, and opens when the scanner clears it', async () => {
  const url = 'http://flagged.test/page';
  const away = worker();
  await away.ctx.recalled;
  away.ctx.doorOnAddress(url);
  await away.settled();
  const res = await away.call('block-info', { url });
  assert.equal(res.verdict.overall.level, 'earlier');
  assert.equal(Say.page(res.verdict, { stopped: true }).title, 'Sentinel flagged this page earlier');

  const cleared = worker({ fetchVerdict: { ok: true, overall: { badge: null }, threats: {}, reasons: [] } });
  await cleared.ctx.recalled;
  cleared.ctx.doorOnAddress(url);
  await cleared.settled();
  assert.equal((await cleared.call('block-info', { url })).pass, true);
});

test('a red answer closes one address, never the site, and a private window leaves nothing', async () => {
  const w = worker();
  await w.ctx.recalled;
  w.ctx.cacheSet('quick', 'https://docs.example/forms/bad#frag', RED);
  w.ctx.cacheSet('quick', 'https://docs.example/other', { overall: { badge: 'orange' } });
  w.ctx.cacheSet('quick', 'https://docs.example/private', RED, true);
  w.ctx.cacheSet('quick', 'https://docs.example/forms/bad', RED);
  await w.settled();
  assert.equal(w.session.length, 1);
  assert.equal(w.session[0].condition.urlFilter, '|https://docs.example/forms/bad|');
  assert.equal(w.session[0].condition.requestDomains, undefined);
  assert.equal(w.session[0].action.redirect.url, 'chrome-extension://me/src/block.html#https://docs.example/forms/bad');
  w.ctx.handlers.refresh({}, w.blockTab);   // what report and "this is fine" do too: nothing the scanner said before still stands
  await new Promise((r) => setTimeout(r, 20));
  await w.settled();
  assert.equal(w.session.length, 0, 'a site reported as fine opens again');
});

test('Continue anyway lets one tab through until it closes, keeps no record elsewhere, and survives being pressed twice', async () => {
  const w = worker({ list: ['bad.test'] });
  await w.call('block-pass', { url: 'http://bad.test/x' });
  await w.call('block-pass', { url: 'http://bad.test/x' });
  await w.settled();
  assert.equal(w.session.length, 1);
  assert.equal(w.session[0].priority, 2, 'above the door');
  assert.deepEqual(w.session[0].condition.tabIds, [7]);
  w.on.removed(7, {});
  await w.settled();
  assert.equal(w.session.length, 0);
});

test('a flagged page that opened is replaced, not covered; a tab that moved on is left alone; once let through it stays', async () => {
  const commit = { frameId: 0, tabId: 7, url: 'http://bad.test/x' };
  const w = worker({ list: ['bad.test'] });
  await w.ctx.recalled;
  await w.on.committed(commit);
  assert.equal(w.scripts.length, 1);
  assert.deepEqual(w.scripts[0].args, ['chrome-extension://me/src/block.html?seen=1#http://bad.test/x']);
  assert.match(String(w.scripts[0].func), /location\.replace/, 'Back must not return to it');

  const moved = worker({ list: ['bad.test'], tabUrl: 'https://elsewhere.test/' });
  await moved.ctx.recalled;
  await moved.on.committed(commit);
  assert.equal(moved.scripts.length, 0);
  assert.equal(moved.updates.length, 0);

  const allowed = worker({ list: ['bad.test'] });
  await allowed.call('block-pass', { url: 'http://bad.test/x' });
  await allowed.settled();
  await allowed.on.committed(commit);
  assert.equal(allowed.scripts.length, 0);
});

test('Continue anyway goes to the address the person asked for: http when the browser switched it to https first; https stays https', async () => {
  const w = worker({ list: ['bad.test'] });
  await w.ctx.recalled;
  // The person asked for http; the browser switched it to https before the door saw it (Chrome 157, every public site).
  await w.on.before({ frameId: 0, tabId: 7, url: 'http://bad.test/x' });
  const passed = await w.call('block-pass', { url: 'https://bad.test/x' });
  assert.equal(passed.to, 'http://bad.test/x', 'to the http address asked for, which the browser then treats as any http address');
  const info = await w.call('block-info', { url: 'https://bad.test/x' });
  assert.equal(info.plain, true, 'the block page says the browser may warn once more');
  // Asked for on https: it stays https, and nothing says http.
  const sure = worker({ list: ['bad.test'] });
  await sure.ctx.recalled;
  assert.equal((await sure.call('block-pass', { url: 'https://bad.test/y' })).to, 'https://bad.test/y', 'never downgraded');
  // An http address asked for elsewhere on the site does not count for this one.
  await sure.on.before({ frameId: 0, tabId: 7, url: 'http://bad.test/other' });
  assert.equal((await sure.call('block-pass', { url: 'https://bad.test/y' })).to, 'https://bad.test/y');
  assert.equal((await sure.call('block-info', { url: 'https://bad.test/y' })).plain, false);
  // Nothing is left listening for navigation errors: the browser falls back from its own switch by itself.
  assert.equal(w.on.error, undefined);
});

test('red after the page opened replaces it; orange warns over it and leaves it, with what was typed', async () => {
  const commit = { frameId: 0, tabId: 7, url: 'http://guess.test/x' };
  const orange = { ok: true, url: commit.url, host: 'guess.test', threats: { scam: { badge: 'orange' } }, reasons: [{ text: 'Young address' }], overall: { badge: 'orange', label: 'Likely scam' } };
  const w = worker({ tabUrl: commit.url, fetchVerdict: orange });
  await w.ctx.recalled;
  await w.on.committed(commit);
  assert.equal(w.scripts.length, 0, 'not replaced');
  const warn = w.messages.find((m) => m.msg.type === 'sentinel:warn');
  assert.ok(warn, 'warned in place');
  assert.equal(warn.opts.frameId, 0);
  assert.equal(warn.msg.said.title, 'This site looks like a scam', 'the same words as the block page');
  assert.equal(warn.msg.said.action.text, 'Take me back to safety');

  const red = worker({ tabUrl: commit.url, fetchVerdict: { ...orange, threats: { scam: { badge: 'red' } }, overall: { badge: 'red', label: 'Confirmed scam' } } });
  await red.ctx.recalled;
  await red.on.committed(commit);
  assert.equal(red.scripts.length, 1, 'replaced');
  assert.ok(!red.messages.some((m) => m.msg.type === 'sentinel:warn'));

  // Continue anyway on the in-place warning: the tab is let through, so a reload is not warned again.
  const page = { id: 'me', url: commit.url, frameId: 0, tab: { id: 7, url: commit.url } };
  await w.ctx.handlers['warn-pass']({}, page);
  await w.settled();
  const before = w.messages.length;
  await w.on.committed(commit);
  assert.equal(w.messages.filter((m) => m.msg.type === 'sentinel:warn').length, w.messages.slice(0, before).filter((m) => m.msg.type === 'sentinel:warn').length);
});

test('the overlay on a loaded page and the emoji mask are gone', () => {
  const bg = read('background.js');
  const guard = read('content/guard.js');
  assert.doesNotMatch(bg, /const warned/);
  assert.doesNotMatch(guard, /slice\(0, 4\)|steps: \(v\.reasons/, 'one reason, never the list');
  for (const f of ['options.html', 'options.js', 'lib/api.js', 'content/serp.js', 'content/sentinel.css']) assert.doesNotMatch(read(f), /badgeStyle|emoji|\u{1F3AD}/u, f);
  assert.doesNotMatch(read('popup.js'), /Scan this page/);
});

test('one voice: three surfaces, one source of words', () => {
  for (const f of ['block.html', 'popup.html', 'options.html']) assert.match(read(f), /lib\/say\.js/, f);
  for (const f of ['block.js', 'popup.js']) { assert.match(read(f), /SentinelSay/, f); assert.doesNotMatch(read(f), /confirmed scam site/, f); }
  assert.match(read('options.js'), /SentinelSay\.protection/);
  assert.doesNotMatch(read('lib/say.js'), /—/, 'no em dashes');

  const said = Say.page(RED, { stopped: true });
  assert.equal(said.title, 'This is a confirmed scam site');
  assert.equal(said.mask, 'scam-red');
  assert.equal(said.reason, 'A fake sign-in', 'one reason, not four');
  assert.deepEqual(said.action, { kind: 'back', text: 'Take me back to safety' });
  assert.equal(Say.page({ ...RED, realSite: { host: 'paypal.com' } }).action.text, 'Go to the real paypal.com');
  assert.match(Say.page(RED, { closed: true }).line, /recovery guide/, 'it was open: the page says so');
  assert.equal(Say.page({ overall: { badge: 'red', label: 'Virus detected' } }).title, 'Virus detected', 'no threat known: the label, never a guess');
});

test('never a green nobody earned', () => {
  for (const v of [null, undefined, {}]) {
    const said = Say.page(v);
    assert.equal(said.tone, 'none');
    assert.match(said.title, /Not checked/);
  }
  assert.match(Say.page(null, { off: true }).line, /off/);
  assert.match(Say.page(null, { paused: true }).line, /paused/);
  assert.equal(Say.page({ overall: { badge: null } }).title, 'No warning signs');
  const base = { ok: true, account: { signedIn: true, plan: {} }, settings: { enabled: true, warnOnNavigate: true }, live: { resetsAt: Date.now() }, siteAccess: true };
  assert.equal(Say.protection(base).word, 'On');
  assert.equal(Say.protection(null).word, 'Off');
  // Nowhere to sign in from this browser yet: the settings page says to open the app, not to sign in on a dead site.
  assert.match(Say.protection({ ok: true, account: { signedIn: false }, reachable: false }).line, /Sentinel app for Windows.*not live yet/);
  assert.equal(Say.protection({ ...base, settings: { enabled: false } }).word, 'Off');
  assert.equal(Say.protection({ ...base, siteAccess: false }).word, 'Off', 'a browser that has not allowed it is not protected');
  assert.equal(Say.protection({ ...base, locked: 'hours' }).word, 'Paused');
  assert.equal(Say.protection({ ...base, account: { signedIn: true, plan: { modelLocked: true } } }).word, 'Paused');
  // "Model" is the app's word for its versions; the companion says version, and that the confirmed list still works.
  assert.doesNotMatch(Say.protection({ ...base, account: { signedIn: true, plan: { modelLocked: true } } }).line, /model/i);
  assert.match(Say.protection({ ...base, settings: { enabled: true, warnOnNavigate: false } }).title, /will not stop/);
});

test('both browsers: Chrome shows the block page in a private window, Firefox has no split mode to ask for', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.incognito, 'split');
  assert.ok(manifest.permissions.includes('declarativeNetRequestWithHostAccess'), 'no new install warning: the sites are already granted');
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ['src/block.html', 'src/masks/*.webp'], 'the block page, and the masks the warning over a page shows; nothing else a page can reach');
  const build = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-extension.js'), 'utf8');
  assert.match(build, /delete ff\.incognito/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'scripts', 'sync-shared.js'), 'utf8'), /delete manifest\.incognito/);
  assert.match(read('block.js'), /window\.top !== window/, 'never inside a frame');
});

test('the worker takes each question only from the pages that ask it: settings from its own pages, page questions from the script that asks them', async () => {
  const w = worker();
  w.ctx.chrome.runtime.getManifest = () => JSON.parse(read('../manifest.json'));
  await w.ctx.recalled;
  const page = (url) => ({ id: 'me', url, tab: { id: 3 }, frameId: 0 });
  const popup = { id: 'me', url: 'chrome-extension://me/src/popup.html' };
  const refused = (type, msg, sender) => assert.rejects(Promise.resolve().then(() => w.ctx.handlers[type]({ type, ...msg }, sender)), /Not allowed/, `${type} from ${sender.url}`);
  const taken = async (type, msg, sender) => {
    try { await w.ctx.handlers[type]({ type, ...msg }, sender); } catch (err) { assert.doesNotMatch(String(err.message), /Not allowed/, `${type} from ${sender.url}`); }
  };
  for (const type of ['state', 'connect', 'refresh', 'sign-out', 'deep-scan']) {
    await refused(type, { url: 'https://a.test/' }, page('https://evil.test/'));
    await taken(type, { url: 'https://a.test/' }, popup);
  }
  await refused('live-batch', { urls: ['https://a.test/'] }, page('https://evil.test/search?q=x'));
  await refused('live-batch', { urls: ['https://a.test/'] }, popup);
  await taken('live-batch', { urls: ['https://a.test/'] }, page('https://www.google.com/search?q=x'));
  await taken('live-batch', { urls: ['https://a.test/'] }, page('https://discord.com/channels/1'));
  await refused('live-email', { emails: [] }, page('https://evil.test/'));
  await taken('live-email', { emails: [] }, page('https://mail.google.com/mail/u/0/'));
  await refused('override', { url: 'https://bad.test/', action: 'allow' }, page('https://evil.test/'));
  await refused('override', { url: 'https://bad.test/', action: 'allow' }, page('https://www.google.com.evil.test/search?q=x'));
  await taken('override', { url: 'https://bad.test/', action: 'allow' }, page('https://www.google.com/search?q=x'));
  await refused('report', { url: 'https://someone-else.test/', category: 'phishing' }, page('https://evil.test/'));
  await taken('report', { url: 'https://evil.test/login', category: 'phishing' }, page('https://evil.test/'));
  await taken('report', { url: 'https://bad.test/', category: 'phishing' }, w.blockTab);
  await taken('report', { url: 'https://bad.test/', category: 'phishing' }, page('https://www.bing.com/search?q=x'));
});

/* ----------------------------------------------------------- the engine on this device */

const { listFile } = require('../scripts/engine-bundle');
const THREAT_LIST = listFile([{ host: 'listed-only-here.test', threat: 'scam' }]);
const loadThreatList = (w) => w.ctx.loadList(THREAT_LIST.buffer.slice(THREAT_LIST.byteOffset, THREAT_LIST.byteOffset + THREAT_LIST.length));
const COPY = ['https://paypa', '1.com/login'].join('');

test('signed out, this device answers: a listed site is red, a copy of a brand is orange, the rest says it was only checked here, and nothing is sent', async () => {
  const w = worker({ signedOut: true });
  await w.ctx.recalled;
  loadThreatList(w);
  const honest = 'https://example.org/page';
  const { verdicts, device, locked } = await w.ctx.liveBatch(['https://listed-only-here.test/a', COPY, honest], 'quick');
  assert.equal(locked, undefined, 'not "locked": the device is checking');
  assert.equal(device, true);
  assert.equal(verdicts['https://listed-only-here.test/a'].overall.badge, 'red');
  assert.equal(verdicts[COPY].overall.badge, 'orange');
  assert.equal(verdicts[COPY].realSite.host, 'paypal.com');
  assert.equal(verdicts[honest].overall.badge, null);
  assert.equal(verdicts[honest].device, true, 'a clean answer says where it came from');
  assert.equal(verdicts[honest].overall.label, 'Checked on this device');
  assert.deepEqual(w.asked, [], 'not one request left the worker');
});

test('signed in with the scanner away: the same answers, said to be from this device, and never kept as a scanner answer', async () => {
  const w = worker();   // its fetch refuses everything but the account
  await w.ctx.recalled;
  const { verdicts, device } = await w.ctx.liveBatch(['https://example.org/a'], 'quick');
  assert.equal(device, true);
  assert.equal(verdicts['https://example.org/a'].device, true);
  assert.equal((await w.ctx.liveBatch(['https://example.org/a'], 'quick')).device, true, 'asked again, not remembered as an answer');
  assert.ok(w.asked.some((u) => u.includes('/live/batch')), 'the scanner was asked when it could be');
});

test('the words say it when Sentinel is not checking everything: paused, never "on", no emoji, no dash', () => {
  const base = { ok: true, settings: { enabled: true, warnOnNavigate: true }, device: { count: 5 } };
  const out = Say.protection({ ...base, account: { signedIn: false } });
  assert.equal(out.tone, 'paused');
  assert.match(out.title, /on this device only/);
  assert.match(out.line, /nothing is sent anywhere/);
  assert.match(Say.protection({ ...base, device: null, account: { signedIn: false } }).line, /has not been downloaded yet/);
  const away = Say.protection({ ...base, account: { signedIn: true, plan: {} }, away: true });
  assert.equal(away.tone, 'paused');
  assert.match(away.title, /cannot reach its scanner/);
  assert.equal(Say.protection({ ...base, account: { signedIn: true, plan: {} }, away: false }).tone, 'on');
  for (const s of [out, away]) assert.doesNotMatch(`${s.title} ${s.line}`, /[—–]|[\u{1F300}-\u{1FAFF}]/u);
});

test('the block page for a listed site, or for a copy of a brand, asks no scanner: signed out there is none, and a listed address is not sent', async () => {
  const out = worker({ signedOut: true });
  await out.ctx.recalled;
  loadThreatList(out);
  assert.equal((await out.call('block-real', { url: 'https://listed-only-here.test/a' })).realSite, null);
  assert.equal((await out.call('block-real', { url: COPY })).realSite.host, 'paypal.com', 'the real site comes from the same rule, on the device');
  const inn = worker();
  await inn.ctx.recalled;
  loadThreatList(inn);
  await inn.call('block-real', { url: 'https://listed-only-here.test/a' });
  assert.deepEqual(inn.asked.filter((u) => u.includes('/live/')), [], 'a listed address is not sent to the scanner either');
});
