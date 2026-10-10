/**
 * Sentinel Companion - service worker.
 *
 * Live protection: masks search results, checks pages as they load and marks
 * emails. Every plan has fast live scanning (Free has 15 minutes a week); the
 * server enforces plans and weekly live hours, and this worker mirrors that
 * state so the UI can explain what's happening.
 *
 * Plans with delicate scanning (Pro and up) get a second, researched pass: masks
 * appear instantly from the checklist, then upgrade once research finishes.
 */
import { ext, apiFetch, getSettings, setToken, siteUrl, COLORS, ApiError } from './lib/api.js';
import { PRESETS, MIN_LENGTH, KEEP, bankDomain, newSalt, hashPassword, sameHash, homeAccount, guardedHere, hashesOf } from './lib/pwalarm.js';

const TTL = { quick: 15 * 60 * 1000, research: 60 * 60 * 1000 };
const cache = new Map();                  // `${phase}|${url}` -> { verdict, at }
let account = { signedIn: false, user: null, plan: null, usage: null, checkedAt: 0 };
let live = { paused: null, resetsAt: 0, usedMinutes: 0, limitMinutes: 0 };
let intel = { hosts: new Map(), at: 0 };

/* --------------------------------------------------------------- helpers */

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

function cacheGet(phase, url) {
  const hit = cache.get(`${phase}|${url}`);
  if (hit && Date.now() - hit.at < TTL[phase]) return hit.verdict;
  return null;
}
function cacheSet(phase, url, verdict) {
  if (cache.size > 3000) cache.clear();
  cache.set(`${phase}|${url}`, { verdict, at: Date.now() });
}

const features = () => (account.plan && account.plan.features) || {};
/** Fast live scanning is on every plan; delicate (liveScanning) from Pro up. */
const hasLive = () => Boolean(features().liveScanning || features().liveFast);

function liveBlockReason() {
  if (!account.signedIn) return 'signed_out';
  if (!hasLive()) return 'plan';
  if (live.paused === 'hours' && Date.now() < live.resetsAt) return 'hours';
  return null;
}

/** A null limit is uncapped; a limit of 0 means the mode is not in the plan. */
const timeLeft = (used, limit) => limit === null || (typeof limit === 'number' && (used || 0) < limit);

function noteLive(info) {
  if (!info) return;
  const fast = info.fast || null;
  // When delicate runs out the server falls back to fast, so live is only paused once both are used up.
  const left = timeLeft(info.usedMinutes, info.limitMinutes) || Boolean(fast && timeLeft(fast.usedMinutes, fast.limitMinutes));
  live = {
    ...live,
    usedMinutes: info.usedMinutes, limitMinutes: info.limitMinutes,
    fastUsedMinutes: fast ? fast.usedMinutes : 0, fastLimitMinutes: fast ? fast.limitMinutes : 0,
    resetsAt: info.resetsAt, paused: left ? null : 'hours'
  };
  ext.storage.local.set({ live });
}

function handleApiError(err) {
  if (err.code === 'live_hours_exhausted') {
    live = { ...live, paused: 'hours', resetsAt: err.extra.resetsAt || Date.now() + 3600e3, usedMinutes: err.extra.usedMinutes, limitMinutes: err.extra.limitMinutes };
    ext.storage.local.set({ live });
  }
  if (err.status === 401) { account = { signedIn: false, user: null, plan: null, usage: null, checkedAt: Date.now() }; setToken(null); }
}

/** Instant verdict for confirmed hosts from the locally cached threat list. */
function localVerdict(url) {
  const host = hostOf(url);
  if (!host) return null;
  const parts = host.split('.');
  const threat = intel.hosts.get(host) || intel.hosts.get(parts.slice(-2).join('.'));
  if (!threat) return null;
  const label = { scam: 'Confirmed scam', virus: 'Virus detected', malware: 'Malware detected' }[threat];
  const threats = { scam: null, virus: null, malware: null };
  threats[threat] = { level: 'confirmed', badge: 'red', label, score: 100, evidence: "Sentinel's confirmed threat list" };
  for (const t of Object.keys(threats)) if (!threats[t]) threats[t] = { level: 'safe', badge: null, label: 'No signs', score: 0 };
  return { ok: true, url, host, threats, overall: { level: 'confirmed', badge: 'red', label }, reasons: [{ id: 'K00', threat, text: `On Sentinel's confirmed ${threat} list` }], offline: true };
}

/* ---------------------------------------------------------------- account */

async function connect() {
  // A signed-in browser session on the site can mint a token for this extension.
  try {
    const { token } = await apiFetch('/api/v1/auth/client-token', { method: 'POST', body: { client: 'extension' } });
    if (token) await setToken(token);
  } catch { /* not signed in on the site */ }
  return refreshAccount(true);
}

async function refreshAccount(force = false) {
  if (!force && Date.now() - account.checkedAt < 5 * 60 * 1000) return account;
  try {
    const data = await apiFetch('/api/v1/auth/me');
    account = { signedIn: true, user: data.user, plan: data.plan, usage: data.usage, week: data.week, checkedAt: Date.now() };
    const fast = data.usage.fastMinutes;
    noteLive({
      usedMinutes: data.usage.liveMinutes.used, limitMinutes: data.usage.liveMinutes.limit,
      fast: fast ? { usedMinutes: fast.used, limitMinutes: fast.limit } : null,
      resetsAt: data.week.resetsAt
    });
  } catch (err) {
    if (err.status === 401) account = { signedIn: false, user: null, plan: null, usage: null, checkedAt: Date.now() };
  }
  await ext.storage.local.set({ account });
  return account;
}

async function syncIntel() {
  if (!hasLive()) return;
  try {
    const data = await apiFetch('/api/v1/intel');
    intel = { hosts: new Map(data.blocklist.map((r) => [r.host, r.threat])), at: Date.now() };
    await ext.storage.local.set({ intel: { hosts: data.blocklist, at: intel.at } });
  } catch { /* keep the old list */ }
}

async function restore() {
  const stored = await ext.storage.local.get(['account', 'live', 'intel']);
  if (stored.account) account = { ...stored.account, checkedAt: 0 };
  if (stored.live) live = stored.live;
  if (stored.intel) intel = { hosts: new Map(stored.intel.hosts.map((r) => [r.host, r.threat])), at: stored.intel.at };
  await refreshAccount(true);
  if (Date.now() - intel.at > 3600e3) syncIntel();
}

/* --------------------------------------------------------------- scanning */

async function liveBatch(urls, phase, isPrivate = false) {
  const blocked = liveBlockReason();
  if (blocked) return { locked: blocked };
  if (phase === 'research' && !features().liveResearch) return { locked: 'plan', verdicts: {} };

  const out = {};
  const pending = [];
  for (const url of urls) {
    const cached = cacheGet(phase, url) || (phase === 'quick' ? localVerdict(url) : null);
    if (cached) out[url] = cached;
    else pending.push(url);
  }
  if (pending.length) {
    try {
      // Plans without delicate ask for fast outright: once Free's fast minutes are used up, a
      // delicate request would come back as plan_required instead of live_hours_exhausted.
      const mode = features().liveScanning ? 'delicate' : 'fast';
      const data = await apiFetch('/api/v1/live/batch', { method: 'POST', body: { urls: pending, mode, quick: phase !== 'research', private: isPrivate }, timeout: phase === 'research' ? 90000 : 20000 });
      noteLive(data.live);
      for (const [url, verdict] of Object.entries(data.byUrl)) {
        out[url] = verdict;
        if (verdict.ok) cacheSet(phase, url, verdict);
      }
    } catch (err) {
      handleApiError(err);
      if (err.code === 'live_hours_exhausted') return { locked: 'hours', verdicts: out };
    }
  }
  return { verdicts: out };
}

async function paint(tabId, verdict) {
  const badge = verdict && verdict.overall && verdict.overall.badge;
  try {
    await ext.action.setBadgeText({ tabId, text: badge ? (badge === 'red' ? '!' : '?') : '' });
    if (badge) await ext.action.setBadgeBackgroundColor({ tabId, color: COLORS[badge] });
    await ext.action.setTitle({ tabId, title: badge ? `Sentinel: ${verdict.overall.label}` : 'Sentinel' });
  } catch { /* tab closed */ }
}

const warned = new Map();

async function onNavigate(details) {
  if (details.frameId !== 0) return;
  await typedNavigated(details.tabId, details.url);
  if (!/^https?:/i.test(details.url)) return;
  const settings = await getSettings();
  if (!settings.enabled || liveBlockReason()) return;

  let verdict = localVerdict(details.url) || cacheGet('research', details.url) || cacheGet('quick', details.url);
  if (!verdict) {
    try {
      // From a private window only the page's address without its query goes out, and nothing about it is kept.
      const tab = await ext.tabs.get(details.tabId).catch(() => null);
      const isPrivate = Boolean(tab && tab.incognito);
      const url = isPrivate ? details.url.replace(/[?#].*$/, '') : details.url;
      const data = await apiFetch('/api/v1/live/visit', { method: 'POST', body: { url, private: isPrivate }, timeout: 30000 });
      noteLive(data.live);
      // Before you pay (server/lib/scan/paycheck.js): kept with the verdict, so a checkout opened again says it again.
      verdict = data.pay ? { ...data.verdict, pay: data.pay } : data.verdict;
      cacheSet(features().liveResearch ? 'research' : 'quick', details.url, verdict);
    } catch (err) {
      handleApiError(err);
      return;
    }
  }
  paint(details.tabId, verdict);
  // A shop's checkout whose address is young or unknown: a calm note in the corner, the same rules as the Windows app.
  if (verdict.pay && verdict.pay.text) Promise.resolve(ext.tabs.sendMessage(details.tabId, { type: 'sentinel:pay', text: String(verdict.pay.text) })).catch(() => {});

  const severe = verdict.overall && (verdict.overall.badge === 'red' || (verdict.overall.badge === 'orange' && settings.minimumBadge !== 'red'));
  if (severe) await typedFlagged(details.tabId, details.url);
  if (!severe || !settings.warnOnNavigate) return;
  const key = `${details.tabId}|${verdict.host}`;
  if (warned.has(key)) return;
  warned.set(key, Date.now());
  if (warned.size > 300) warned.clear();

  // The recovery guide; the block page adds what happened.
  const recover = siteUrl(settings.apiBase, '/recover');
  Promise.resolve(ext.tabs.sendMessage(details.tabId, { type: 'sentinel:warn', verdict, recover })).catch(() => {});
  // A confirmed host is blocked at once from the cached list, which cannot say which brand the page imitates. The
  // scanner can: when it names the real site, the block page is drawn again with "Go to the real ...".
  if (verdict.offline) realSiteFor(details).then((full) => {
    if (full && full.realSite) Promise.resolve(ext.tabs.sendMessage(details.tabId, { type: 'sentinel:warn', verdict: { ...verdict, realSite: full.realSite }, recover, again: true })).catch(() => {});
  });
  if (verdict.overall.badge === 'red' && settings.notifications) {
    Promise.resolve(ext.notifications.create(`sentinel-${Date.now()}`, {
      type: 'basic',
      iconUrl: ext.runtime.getURL('icons/icon128.png'),
      title: `Sentinel: ${verdict.overall.label}`,
      message: `${verdict.host}: ${(verdict.reasons[0] && verdict.reasons[0].text) || 'Leave this site.'}`,
      priority: 2
    })).catch(() => {});
  }
}

/** The scanner's own verdict for a page the cached list already blocked, kept for the real-site button. Null on any failure. */
async function realSiteFor(details) {
  const known = cacheGet('research', details.url) || cacheGet('quick', details.url);
  if (known) return known;
  try {
    const tab = await ext.tabs.get(details.tabId).catch(() => null);
    const isPrivate = Boolean(tab && tab.incognito);
    const data = await apiFetch('/api/v1/live/visit', { method: 'POST', body: { url: isPrivate ? details.url.replace(/[?#].*$/, '') : details.url, private: isPrivate }, timeout: 30000 });
    noteLive(data.live);
    cacheSet(features().liveResearch ? 'research' : 'quick', details.url, data.verdict);
    return data.verdict;
  } catch { return null; }
}

/* ------------------------------------------------- did you type anything? */

// A page flagged red or orange that has a password or card box (content/typed.js finds them by their type and labels,
// never what is in them). When its tab is closed or moves on to another site, one calm question asks, in the corner of
// the next page the person sees, whether they typed a password or card number there. Yes opens the recovery guide with
// that ticked; No closes it. Once per site. Kept in session storage only (gone when the browser closes), and never for
// a private window. The Windows app asks the same question for live scanning (desktop/src/typedcheck.js).
const typedKey = (tabId) => `typed:${tabId}`;
const TYPED_WAIT = 10 * 60 * 1000;   // a question nobody saw is dropped after this long
async function sessionGet(key) {
  if (!session()) return null;
  const got = await session().get(key);
  return (got && got[key]) || null;
}
const sessionSet = (key, value) => (session() ? (value ? session().set({ [key]: value }) : session().remove(key)) : null);
/** What the recovery guide ticks: 'password', 'card' or both. */
const typedHappened = (f) => [f.pw && 'password', f.card && 'card'].filter(Boolean).join(',');

async function typedFlagged(tabId, url) {
  const tab = await Promise.resolve(ext.tabs.get(tabId)).catch(() => null);
  if (!session() || !tab || tab.incognito) return;
  const host = hostOf(url);
  const was = await sessionGet(typedKey(tabId));
  if (!was || was.host !== host) await sessionSet(typedKey(tabId), { host, pw: false, card: false });
  Promise.resolve(ext.tabs.sendMessage(tabId, { type: 'sentinel:typed-watch' }, { frameId: 0 })).catch(() => {});
}

/** The flagged page's tab went somewhere: another site means the page was left. */
async function typedNavigated(tabId, url) {
  const was = await sessionGet(typedKey(tabId));
  if (was && hostOf(url) !== was.host) await typedLeft(tabId, was);
}

async function typedLeft(tabId, was) {
  await sessionSet(typedKey(tabId), null);
  if (!was.pw && !was.card) return;
  const asked = (await sessionGet('typedAsked')) || [];
  if (asked.includes(was.host)) return;
  await sessionSet('typedAsked', [...asked, was.host].slice(-200));
  await sessionSet('typedAsk', { happened: typedHappened(was), site: was.host, at: Date.now() });
}

/** The question, on this tab's page if it is an ordinary page that is not itself a flagged one. */
async function typedDeliver(tabId) {
  const ask = await sessionGet('typedAsk');
  if (!ask) return;
  if (Date.now() - ask.at > TYPED_WAIT) { await sessionSet('typedAsk', null); return; }
  if (await sessionGet(typedKey(tabId))) return;
  const tab = await Promise.resolve(ext.tabs.get(tabId)).catch(() => null);
  if (!tab || tab.incognito || !/^https?:/i.test(tab.url || '')) return;
  const res = await Promise.resolve(ext.tabs.sendMessage(tabId, { type: 'sentinel:typed-ask', happened: ask.happened, site: ask.site }, { frameId: 0 })).catch(() => null);
  if (!res || !res.shown) return;
  await sessionSet('typedAsk', null);
  await sessionSet(`typedShown:${tabId}`, ask.happened);
}

/* --------------------------------------------------------- password alarm */

// See lib/pwalarm.js. Only hashes live here; a password reaches the worker in a message from this extension's own
// content script, is hashed, and is dropped.
async function pwState() {
  const { pwalarm } = await ext.storage.local.get('pwalarm');
  return pwalarm && pwalarm.accounts ? pwalarm : { accounts: {} };
}
// pwalarmOn tells every page's content script whether to ask this worker anything at all: 0 when nothing is
// protected, otherwise a stamp that changes on every save so open pages load the new lengths.
const pwOn = (state) => (Object.values(state.accounts).some((a) => a.on) ? Date.now() : 0);
const pwSave = (state) => ext.storage.local.set({ pwalarm: state, pwalarmOn: pwOn(state) });
const frameHost = (sender) => { try { return new URL(sender.url).hostname.toLowerCase(); } catch { return ''; } };

// What "I use this password here on purpose" may allow on a tab ({ id, host }), decided here, not by the page. Kept in
// session storage: this worker is stopped after about 30 seconds idle, and an in-memory map went with it.
const alarmKey = (tabId) => `pwAlarm:${tabId}`;
const session = () => ext.storage.session || null;
async function lastAlarmGet(tabId) {
  if (!session()) return null;
  const got = await session().get(alarmKey(tabId));
  return (got && got[alarmKey(tabId)]) || null;
}
const lastAlarmSet = (tabId, value) => (session() ? (value ? session().set({ [alarmKey(tabId)]: value }) : session().remove(alarmKey(tabId))) : null);
// The first password learned for an account is said once, quietly, in the tab it was learned in (see pw-told).
const tellKey = (tabId) => `pwTell:${tabId}`;

/** Settings messages come only from the extension's own pages (a content script's sender.url is its web page). */
function fromOptions(sender) {
  if (!sender.url || !sender.url.startsWith(ext.runtime.getURL(''))) throw new ApiError('Not allowed', 403, 'forbidden');
}
/** Page messages come only from a content script in a web page. */
function fromPage(sender) {
  if (!sender.tab || !/^https?:/i.test(sender.url || '')) throw new ApiError('Not allowed', 403, 'forbidden');
}

/** What the options page shows: never the hashes. */
function pwList(state) {
  const accounts = Object.values(state.accounts).map((a) => ({
    id: a.id, name: a.name, on: Boolean(a.on), bank: Boolean(a.bank), learned: hashesOf(a).length > 0,
    learnedAt: a.since || a.learnedAt || null, home: (a.homes || [])[0] || null, allowed: a.allowed || []
  }));
  return { presets: PRESETS.map(({ id, name, homes }) => ({ id, name, home: homes[0] })), accounts };
}

const pwHandlers = {
  async 'pw-list'(msg, sender) { fromOptions(sender); return pwList(await pwState()); },
  async 'pw-set'({ id, on }, sender) {
    fromOptions(sender);
    const state = await pwState();
    const preset = PRESETS.find((p) => p.id === id);
    if (on && preset && !state.accounts[id]) state.accounts[id] = { id, name: preset.name, homes: preset.homes, on: true, allowed: [] };
    else if (state.accounts[id]) state.accounts[id].on = Boolean(on);
    await pwSave(state);
    return pwList(state);
  },
  async 'pw-bank'({ domain }, sender) {
    fromOptions(sender);
    const host = bankDomain(domain);
    if (!host) throw new ApiError('Type your bank’s own address, like chase.com', 400, 'bad_domain');
    const state = await pwState();
    const id = `bank:${host}`;
    state.accounts[id] = state.accounts[id] || { id, name: host, homes: [host], on: true, bank: true, allowed: [] };
    state.accounts[id].on = true;
    await pwSave(state);
    return pwList(state);
  },
  async 'pw-forget'({ id }, sender) {
    fromOptions(sender);
    const state = await pwState();
    delete state.accounts[id];
    await pwSave(state);
    return pwList(state);
  },
  async 'pw-unallow'({ id, host }, sender) {
    fromOptions(sender);
    const state = await pwState();
    if (state.accounts[id]) state.accounts[id].allowed = (state.accounts[id].allowed || []).filter((h) => h !== host);
    await pwSave(state);
    return pwList(state);
  },
  /** For the content script: whether this is a sign-in site to learn from, and the lengths worth checking. */
  async 'pw-config'(msg, sender) {
    fromPage(sender);
    const state = await pwState();
    const host = frameHost(sender);
    const tell = sender.frameId === 0 && session() ? (await session().get(tellKey(sender.tab.id)))[tellKey(sender.tab.id)] : null;
    return { learn: Boolean(homeAccount(state, host)), lengths: [...new Set(guardedHere(state, host).flatMap((a) => hashesOf(a).map((h) => h.length)))], tell: tell || null };
  },
  /** The page showed "Your ... password is now protected" long enough to be read: it is not said again. */
  async 'pw-told'(msg, sender) {
    fromPage(sender);
    if (session()) await session().remove(tellKey(sender.tab.id));
    return { told: true };
  },
  /**
   * A sign-in on the account's own site: keep the hash of what was typed. The last KEEP different passwords are kept,
   * so a second Google account, or a password changed lately, is protected too.
   */
  async 'pw-learn'({ password }, sender) {
    fromPage(sender);
    if (typeof password !== 'string' || password.length < MIN_LENGTH || password.length > 512) return { learned: false };
    const state = await pwState();
    const account = homeAccount(state, frameHost(sender));
    if (!account) return { learned: false };
    // Set before saving: the save makes this tab's page ask pw-config again, and that answer carries it.
    if (!hashesOf(account).length && session()) await session().set({ [tellKey(sender.tab.id)]: account.name });
    const kept = [];
    let same = null;
    for (const h of hashesOf(account)) {
      if (!same && h.length === password.length && sameHash(await hashPassword(password, h.salt), h.hash)) same = h;
      else kept.push(h);
    }
    const salt = same ? same.salt : newSalt();
    const fresh = same ? { ...same, at: Date.now() } : { salt, hash: await hashPassword(password, salt), length: password.length, at: Date.now() };
    account.hashes = [fresh, ...kept].slice(0, KEEP);
    account.since = account.since || account.learnedAt || Date.now();
    for (const old of ['salt', 'hash', 'length', 'learnedAt']) delete account[old];
    await pwSave(state);
    return { learned: true };
  },
  /** A password typed anywhere else: is it one of the protected ones? On a match, the top frame shows the alarm. */
  async 'pw-check'({ password }, sender) {
    fromPage(sender);
    if (typeof password !== 'string' || password.length < MIN_LENGTH || password.length > 512) return { match: null };
    const state = await pwState();
    const host = frameHost(sender);
    for (const a of guardedHere(state, host)) {
      let match = false;
      for (const h of hashesOf(a)) {
        if (h.length === password.length && sameHash(await hashPassword(password, h.salt), h.hash)) { match = true; break; }
      }
      if (!match) continue;
      await lastAlarmSet(sender.tab.id, { id: a.id, host });
      const tabUrl = sender.tab.url || sender.url;
      const verdict = localVerdict(tabUrl) || cacheGet('research', tabUrl) || cacheGet('quick', tabUrl);
      const { apiBase } = await getSettings();
      const recover = siteUrl(apiBase, '/recover?happened=password');
      Promise.resolve(ext.tabs.sendMessage(sender.tab.id, { type: 'sentinel:pw-alarm', name: a.name, host, bank: Boolean(a.bank), verdict: verdict || null, recover }, { frameId: 0 })).catch(() => {});
      return { match: { name: a.name } };
    }
    return { match: null };
  },
  /** "I use this password here on purpose", confirmed twice by the person: stop sounding the alarm for this account on that host. */
  async 'pw-allow'(msg, sender) {
    fromPage(sender);
    const alarm = await lastAlarmGet(sender.tab.id);
    if (!alarm) return { allowed: false };
    await lastAlarmSet(sender.tab.id, null);
    const state = await pwState();
    const a = state.accounts[alarm.id];
    if (!a) return { allowed: false };
    a.allowed = [...new Set([...(a.allowed || []), alarm.host])].slice(-50);
    await pwSave(state);
    return { allowed: true };
  }
};

/* --------------------------------------------------------------- messages */


/**
 * Origins this build recognises as Sentinel, taken from the manifest so the
 * list is exactly what the build was granted (the production build strips the
 * dev server from it).
 */
function sentinelOrigins() {
  const manifest = ext.runtime.getManifest();
  const connect = (manifest.content_scripts || []).find((c) => (c.js || []).some((f) => f.endsWith('connect.js')));
  const patterns = (connect && connect.matches) || [];
  return new Set(patterns.map((p) => new URL(p.replace(/\*$/, '')).origin));
}

async function siteAccess() {
  try { return await ext.permissions.contains({ origins: ['<all_urls>'] }); } catch { return true; }
}

const handlers = {
  async state() {
    const settings = await getSettings();
    await refreshAccount();
    return { settings, account, live, locked: liveBlockReason(), site: settings.apiBase, siteAccess: await siteAccess(), browser: globalThis.browser ? 'firefox' : 'chromium' };
  },
  async connect() { return { account: await connect() }; },
  async 'set-token'({ token }, sender) {
    // Only accept tokens relayed from a Sentinel this build trusts: the hosted
    // site, the desktop app's embedded server, or (dev builds only) the dev server.
    const from = sender.tab && sender.tab.url ? new URL(sender.tab.url).origin : null;
    if (!from || !sentinelOrigins().has(from) || typeof token !== 'string' || token.length > 200) {
      throw new ApiError('Not allowed', 403, 'forbidden');
    }
    // Follow whichever Sentinel paired us, so pairing from the desktop app
    // makes the companion talk to that app's own server.
    const { apiBase } = await getSettings();
    if (apiBase !== from) await ext.storage.sync.set({ apiBase: from });
    await setToken(token);
    cache.clear();
    await refreshAccount(true);
    syncIntel();
    return { account };
  },
  async 'live-batch'({ urls, phase = 'quick' }, sender) {
    const settings = await getSettings();
    if (!settings.enabled) return { locked: 'disabled' };
    // A private window is protected like any other; the server keeps nothing about it.
    return liveBatch((urls || []).slice(0, 60), phase, Boolean(sender && sender.tab && sender.tab.incognito));
  },
  /** A link the pointer rests on (content/hover.js): the cache and the threat list first, then the fast check when live scanning allows it. */
  async 'hover-check'({ url }, sender) {
    fromPage(sender);
    const settings = await getSettings();
    if (!settings.enabled) return { locked: 'disabled' };
    if (typeof url !== 'string' || url.length > 2048 || !/^https?:\/\//i.test(url)) return { verdict: null };
    const known = localVerdict(url) || cacheGet('research', url) || cacheGet('quick', url);
    if (known) return { verdict: known };
    const { verdicts, locked } = await liveBatch([url], 'quick', Boolean(sender.tab && sender.tab.incognito));
    return { verdict: (verdicts && verdicts[url]) || null, locked: locked || null };
  },
  async 'live-email'({ emails }) {
    const settings = await getSettings();
    if (!settings.enabled || !settings.emailProtection) return { locked: 'disabled' };
    const blocked = liveBlockReason();
    if (blocked) return { locked: blocked };
    if (!features().emailLive) return { locked: 'plan' };
    try {
      const data = await apiFetch('/api/v1/live/email', { method: 'POST', body: { emails: (emails || []).slice(0, 50) }, timeout: 45000 });
      noteLive(data.live);
      return { results: data.results };
    } catch (err) {
      handleApiError(err);
      return { error: err.message, locked: err.code === 'live_hours_exhausted' ? 'hours' : null };
    }
  },
  async 'deep-scan'({ url }) {
    const data = await apiFetch('/api/v1/scan/link', { method: 'POST', body: { url }, timeout: 90000 });
    account.usage = data.usage;
    return data;
  },
  async report({ url, category }) {
    const data = await apiFetch('/api/v1/report', { method: 'POST', body: { url, category } });
    cache.clear();
    return data;
  },
  async override({ url, action }) {
    const data = await apiFetch('/api/v1/sites/override', { method: 'POST', body: { url, action } });
    cache.clear();
    return data;
  },
  ...pwHandlers,
  /** content/typed.js found a password or card box on the flagged page in this tab. */
  async 'typed-fields'({ pw, card }, sender) {
    fromPage(sender);
    if (sender.frameId !== 0) return { kept: false };
    const was = await sessionGet(typedKey(sender.tab.id));
    if (!was || was.host !== hostOf(sender.url)) return { kept: false };
    await sessionSet(typedKey(sender.tab.id), { ...was, pw: was.pw || pw === true, card: was.card || card === true });
    return { kept: true };
  },
  /** "Yes, I did": the recovery guide, with what the page asked for ticked (decided here, not by the page). */
  async 'typed-yes'(msg, sender) {
    fromPage(sender);
    const happened = await sessionGet(`typedShown:${sender.tab.id}`);
    if (!happened) return { opened: false };
    await sessionSet(`typedShown:${sender.tab.id}`, null);
    const { apiBase } = await getSettings();
    await ext.tabs.create({ url: siteUrl(apiBase, `/recover?happened=${happened}`) });
    return { opened: true };
  },
  /**
   * "Go to the real paypal.com" on the block page: the tab goes to the real site the scanner named for this page
   * (brands.js, or one of the person's own sites), looked up here again. Nothing the page sends is used.
   */
  async 'real-site'(msg, sender) {
    fromPage(sender);
    // The scanner's verdict, not the cached list's (which names no brand). The worker may have been asleep since the
    // warning was drawn, its cache gone: then it is asked again.
    const verdict = await realSiteFor({ url: sender.tab.url || sender.url, tabId: sender.tab.id });
    const real = verdict && verdict.realSite && verdict.realSite.url;
    if (typeof real !== 'string' || !/^https:\/\/[a-z0-9.-]+\/$/.test(real)) return { opened: false };
    await ext.tabs.update(sender.tab.id, { url: real });
    return { opened: true };
  },
  async 'typed-no'(msg, sender) {
    fromPage(sender);
    await sessionSet(`typedShown:${sender.tab.id}`, null);
    return { ok: true };
  },
  async 'sign-out'() {
    try { await apiFetch('/api/v1/auth/logout', { method: 'POST', body: {} }); } catch { /* already signed out */ }
    await setToken(null);
    account = { signedIn: false, user: null, plan: null, usage: null, checkedAt: Date.now() };
    await ext.storage.local.set({ account });
    return { ok: true };
  },
  async refresh() {
    cache.clear();
    await refreshAccount(true);
    await syncIntel();
    return { account };
  }
};

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only this extension's own pages and content scripts may talk to the worker.
  if (sender.id !== ext.runtime.id) return false;
  const handler = msg && Object.prototype.hasOwnProperty.call(handlers, msg.type) ? handlers[msg.type] : null;
  if (!handler) return false;
  handler(msg, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: err.message, code: err.code, status: err.status, extra: err instanceof ApiError ? err.extra : undefined }));
  return true;
});

/** The web app hands over a token right after sign-in, or pings to show "protection active". */
if (ext.runtime.onMessageExternal) ext.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
  getSettings().then(async (settings) => {
    if (origin !== new URL(settings.apiBase).origin) { sendResponse({ ok: false }); return; }
    if (msg && msg.type === 'sentinel:ping') {
      sendResponse({ ok: true, version: ext.runtime.getManifest().version, signedIn: account.signedIn });
      return;
    }
    if (msg && msg.type === 'sentinel:connect' && typeof msg.token === 'string' && msg.token.length < 200) {
      await setToken(msg.token);
      const acc = await refreshAccount(true);
      syncIntel();
      sendResponse({ ok: acc.signedIn });
      return;
    }
    sendResponse({ ok: false });
  });
  return true;
});

/* ----------------------------------------------------------------- wiring */

ext.runtime.onInstalled.addListener(async (details) => {
  try { ext.contextMenus.create({ id: 'sentinel-check-link', title: 'Scan this link with Sentinel', contexts: ['link'] }, () => void ext.runtime.lastError); } catch { /* already there */ }
  ext.alarms.create('sentinel:intel', { periodInMinutes: 60 });
  ext.alarms.create('sentinel:account', { periodInMinutes: 15 });
  await restore();
  if (!account.signedIn) await connect();
  if (details.reason === 'install') {
    const { apiBase } = await getSettings();
    ext.tabs.create({ url: siteUrl(apiBase, '/connect') });
  }
});

ext.runtime.onStartup.addListener(restore);

/*
 * Stop pasted commands: content/clipguard.js runs in the page's own world, where it cannot read the settings, so it
 * is registered here only while the switch is on (and is not in the manifest).
 */
const CLIPGUARD = {
  id: 'sentinel-clipguard',
  // alarm.page.js is alarm.js under another name (scripts/build-extension.js): a file already run in the frame in the
  // companion's world is not run again in the page's.
  js: ['src/content/clickfix.js', 'src/content/alarm.page.js', 'src/content/clipguard.js'],
  matches: ['http://*/*', 'https://*/*'],
  world: 'MAIN',
  allFrames: true,
  runAt: 'document_start'
};
async function syncClipGuard() {
  if (!ext.scripting || !ext.scripting.registerContentScripts) return;
  const { commandGuard } = await getSettings();
  const [old] = await ext.scripting.getRegisteredContentScripts({ ids: [CLIPGUARD.id] });
  let there = Boolean(old);
  try {
    // Registered by an earlier version with other files: register it again.
    if (old && String(old.js) !== String(CLIPGUARD.js)) { await ext.scripting.unregisterContentScripts({ ids: [CLIPGUARD.id] }); there = false; }
    if (commandGuard && !there) {
      // Frames a page opens on about:blank too, where the browser can do that.
      await Promise.resolve().then(() => ext.scripting.registerContentScripts([{ ...CLIPGUARD, matchOriginAsFallback: true }]))
        .catch(() => ext.scripting.registerContentScripts([CLIPGUARD]));
    }
    if (!commandGuard && there) await ext.scripting.unregisterContentScripts({ ids: [CLIPGUARD.id] });
  } catch { /* registered meanwhile by another start of this worker */ }
}
ext.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.commandGuard) syncClipGuard(); });
syncClipGuard();
// Pages wait for this flag before asking anything; set it once (a new stamp at every start would reload every page).
Promise.all([pwState(), ext.storage.local.get('pwalarmOn')]).then(([state, got]) => {
  const on = pwOn(state);
  if (!got || got.pwalarmOn === undefined || Boolean(got.pwalarmOn) !== Boolean(on)) ext.storage.local.set({ pwalarmOn: on });
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sentinel:intel') syncIntel();
  if (alarm.name === 'sentinel:account') refreshAccount(true);
});

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'sentinel-check-link' || !info.linkUrl) return;
  let title;
  let message;
  try {
    const { verdict, usage } = await handlers['deep-scan']({ url: info.linkUrl });
    title = `Sentinel: ${verdict.overall.label}`;
    message = `${verdict.host}\n${verdict.reasons.slice(0, 2).map((r) => r.text).join('\n') || 'Nothing suspicious found.'}\n${usage.linkScans.limit - usage.linkScans.used} scans left this week`;
    if (tab) paint(tab.id, verdict);
  } catch (err) {
    title = 'Sentinel could not scan that link';
    message = err.message;
  }
  Promise.resolve(ext.notifications.create({ type: 'basic', iconUrl: ext.runtime.getURL('icons/icon128.png'), title, message })).catch(() => {});
});

ext.webNavigation.onCommitted.addListener(onNavigate);
// "Did you type anything?": a flagged tab closed counts as leaving it; the question waits for the next page shown.
ext.tabs.onRemoved.addListener(async (tabId, info) => {
  const was = await sessionGet(typedKey(tabId));
  if (!was) return;
  await typedLeft(tabId, was);
  const [front] = await Promise.resolve(ext.tabs.query({ active: true, windowId: info.windowId })).catch(() => []);
  if (front) typedDeliver(front.id);
});
ext.tabs.onActivated.addListener((info) => { typedDeliver(info.tabId); });
ext.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  // A flagged page that loaded before its content script could hear the first word is told again.
  if (await sessionGet(typedKey(details.tabId))) Promise.resolve(ext.tabs.sendMessage(details.tabId, { type: 'sentinel:typed-watch' }, { frameId: 0 })).catch(() => {});
  else typedDeliver(details.tabId);
});

restore();
