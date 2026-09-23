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

async function liveBatch(urls, phase) {
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
      const data = await apiFetch('/api/v1/live/batch', { method: 'POST', body: { urls: pending, mode, quick: phase !== 'research' }, timeout: phase === 'research' ? 90000 : 20000 });
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
    await ext.action.setTitle({ tabId, title: badge ? `Sentinel - ${verdict.overall.label}` : 'Sentinel' });
  } catch { /* tab closed */ }
}

const warned = new Map();

async function onNavigate(details) {
  if (details.frameId !== 0 || !/^https?:/i.test(details.url)) return;
  const settings = await getSettings();
  if (!settings.enabled || liveBlockReason()) return;

  let verdict = localVerdict(details.url) || cacheGet('research', details.url) || cacheGet('quick', details.url);
  if (!verdict) {
    try {
      const data = await apiFetch('/api/v1/live/visit', { method: 'POST', body: { url: details.url }, timeout: 30000 });
      noteLive(data.live);
      verdict = data.verdict;
      cacheSet(features().liveResearch ? 'research' : 'quick', details.url, verdict);
    } catch (err) {
      handleApiError(err);
      return;
    }
  }
  paint(details.tabId, verdict);

  const severe = verdict.overall && (verdict.overall.badge === 'red' || (verdict.overall.badge === 'orange' && settings.minimumBadge !== 'red'));
  if (!severe || !settings.warnOnNavigate) return;
  const key = `${details.tabId}|${verdict.host}`;
  if (warned.has(key)) return;
  warned.set(key, Date.now());
  if (warned.size > 300) warned.clear();

  Promise.resolve(ext.tabs.sendMessage(details.tabId, { type: 'sentinel:warn', verdict })).catch(() => {});
  if (verdict.overall.badge === 'red' && settings.notifications) {
    Promise.resolve(ext.notifications.create(`sentinel-${Date.now()}`, {
      type: 'basic',
      iconUrl: ext.runtime.getURL('icons/icon128.png'),
      title: `Sentinel: ${verdict.overall.label}`,
      message: `${verdict.host} - ${(verdict.reasons[0] && verdict.reasons[0].text) || 'Leave this site.'}`,
      priority: 2
    })).catch(() => {});
  }
}

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
  async 'live-batch'({ urls, phase = 'quick' }) {
    const settings = await getSettings();
    if (!settings.enabled) return { locked: 'disabled' };
    return liveBatch((urls || []).slice(0, 60), phase);
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

restore();
