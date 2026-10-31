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
function worker({ list = [], tabUrl = 'http://bad.test/x', fetchVerdict = null } = {}) {
  const dynamic = [];
  const session = [];
  const on = {};
  const listener = (name) => ({ addListener: (f) => { on[name] = f; } });
  const noop = () => {};
  const scripts = [];
  const updates = [];
  const update = (rules) => async ({ removeRuleIds = [], addRules = [] }) => {
    for (const id of removeRuleIds) { const i = rules.findIndex((r) => r.id === id); if (i >= 0) rules.splice(i, 1); }
    for (const r of addRules) { assert.ok(!rules.some((x) => x.id === r.id), 'rule ids stay unique'); rules.push(JSON.parse(JSON.stringify(r))); }
  };
  const local = { authToken: 't', account: { signedIn: true, plan: { features: { liveFast: true } }, usage: {} }, intel: { hosts: list.map((host) => ({ host, threat: 'scam' })), at: Date.now() } };
  const area = (store) => ({ get: async (k) => { const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k || {}); return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, store[x]])); }, set: async (o) => { Object.assign(store, o); }, remove: async (k) => { delete store[k]; } });
  const ext = {
    runtime: { id: 'me', getURL: (p) => `chrome-extension://me/${p}`, getManifest: () => ({ content_scripts: [], version: '1' }), onMessage: listener('m'), onMessageExternal: listener('x'), onInstalled: listener('i'), onStartup: listener('s'), lastError: null },
    storage: { local: area(local), session: area({}), sync: { get: async (d) => ({ ...d }), set: async () => {} }, onChanged: listener('c') },
    tabs: { sendMessage: async () => null, get: async () => ({ id: 7, url: tabUrl }), create: noop, query: async () => [], update: async (id, u) => { updates.push(u); }, onRemoved: listener('removed'), onActivated: listener('a') },
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setTitle: noop },
    alarms: { create: noop, onAlarm: listener('al') },
    contextMenus: { create: noop, onClicked: listener('cm') },
    notifications: { create: noop },
    webNavigation: { onCommitted: listener('committed'), onCompleted: listener('done'), onHistoryStateUpdated: listener('h'), onReferenceFragmentUpdated: listener('f') },
    permissions: { contains: async () => true },
    scripting: { executeScript: async (o) => { scripts.push(o); } },
    declarativeNetRequest: { getDynamicRules: async () => dynamic, updateDynamicRules: update(dynamic), getSessionRules: async () => session, updateSessionRules: update(session) }
  };
  const ctx = { chrome: ext, crypto: globalThis.crypto, TextEncoder, URL, btoa, atob, Uint8Array, AbortController, AbortSignal, setTimeout, clearTimeout, console, Promise,
    fetch: async (u) => {
      if (fetchVerdict && u.includes('/live/visit')) return { ok: true, json: async () => ({ verdict: fetchVerdict }) };
      if (u.includes('/auth/me')) return { ok: true, json: async () => ({ user: {}, plan: { features: { liveFast: true } }, usage: { liveMinutes: {} }, week: {} }) };
      throw new Error('offline');
    } };
  vm.createContext(ctx);
  vm.runInContext(`${[flat('lib/brand.js'), flat('lib/api.js'), flat('lib/pwalarm.js'), flat('background.js')].join('\n')}\n;this.handlers = handlers; this.syncDoor = syncDoor; this.recalled = recalled; this.localVerdict = localVerdict; this.doorOnAddress = doorOnAddress; this.cacheSet = cacheSet; this.inTabOrder = inTabOrder;`, ctx);
  const blockTab = { id: 'me', url: 'chrome-extension://me/src/block.html', tab: { id: 7, active: true } };
  const call = async (type, msg = {}, sender = blockTab) => { await ctx.recalled; return JSON.parse(JSON.stringify(await ctx.handlers[type]({ type, ...msg }, sender))); };
  const settled = async () => { await ctx.inTabOrder('door', () => {}); };
  return { ctx, dynamic, session, on, scripts, updates, call, settled, blockTab };
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
  await w.call('report', { url: 'x', category: 'phishing' }).catch(() => {});
  await w.ctx.handlers.override({ url: 'x', action: 'allow' }).catch(() => {});
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

test('the overlay on a loaded page and the emoji mask are gone', () => {
  const bg = read('background.js');
  const guard = read('content/guard.js');
  assert.doesNotMatch(bg, /sentinel:warn|const warned/);
  assert.doesNotMatch(guard, /sentinel:warn|Continue anyway|slice\(0, 4\)/);
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
  assert.equal(Say.protection({ ...base, settings: { enabled: false } }).word, 'Off');
  assert.equal(Say.protection({ ...base, siteAccess: false }).word, 'Off', 'a browser that has not allowed it is not protected');
  assert.equal(Say.protection({ ...base, locked: 'hours' }).word, 'Paused');
  assert.equal(Say.protection({ ...base, account: { signedIn: true, plan: { modelLocked: true } } }).word, 'Paused');
  assert.match(Say.protection({ ...base, settings: { enabled: true, warnOnNavigate: false } }).title, /will not stop/);
});

test('both browsers: Chrome shows the block page in a private window, Firefox has no split mode to ask for', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.incognito, 'split');
  assert.ok(manifest.permissions.includes('declarativeNetRequestWithHostAccess'), 'no new install warning: the sites are already granted');
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ['src/block.html']);
  const build = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-extension.js'), 'utf8');
  assert.match(build, /delete ff\.incognito/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'scripts', 'sync-shared.js'), 'utf8'), /delete manifest\.incognito/);
  assert.match(read('block.js'), /window\.top !== window/, 'never inside a frame');
});
