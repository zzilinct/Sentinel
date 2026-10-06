'use strict';
/**
 * Browser checkup: judging what a browser's own settings say about it. The Windows app reads the settings files
 * (desktop/src/checkup.js) and judges them here, on the computer, with nothing sent anywhere. Site addresses found
 * in those settings (sites allowed to send notifications, the search engine, startup pages) go through the normal
 * fast scan by address instead; this file judges what only the settings can show:
 *
 *   add-ons    how one was installed (from the browser's store, from a folder, by another program, by a policy, by a
 *              command added to how the browser starts), what it may touch, and whether it changes your search.
 *   search     whether the search engine is one people know.
 *   policies   rules set on the computer that a browser must obey, which on a home computer are how unwanted
 *              add-ons and search engines are kept in place ("Managed by your organization").
 *
 * Every finding is a named check that explains itself, like the checklist. There is no list of known bad add-ons
 * here, so nothing is ever confirmed (red): like any guess in Sentinel, these top out at orange.
 */
const { BRANDS } = require('./brands');

// Where the stores' add-ons update from. An add-on that updates from anywhere else did not come from a store.
const STORE_UPDATES = [
  /^https:\/\/clients2\.google\.com\/service\/update2\/crx/i,          // Chrome Web Store (Chrome, Brave, Vivaldi, Opera)
  /^https:\/\/edge\.microsoft\.com\/extensionwebstorebase\//i,          // Microsoft Edge Add-ons
  /^https:\/\/extension-updates\.opera\.com\//i                         // Opera add-ons
];
const fromStoreUpdate = (url) => typeof url === 'string' && STORE_UPDATES.some((rx) => rx.test(url));

// Search engines people know. Anything else running your searches is how a browser hijacker earns its money.
const ENGINES = [
  ['Google', /(^|\.)google\.[a-z.]{2,7}$/], ['Bing', /(^|\.)bing\.com$/], ['DuckDuckGo', /(^|\.)duckduckgo\.com$/],
  ['Yahoo', /(^|\.)yahoo\.(com|co\.jp|co\.uk)$/], ['Ecosia', /(^|\.)ecosia\.org$/], ['Brave Search', /^search\.brave\.com$/],
  ['Startpage', /(^|\.)startpage\.com$/], ['Qwant', /(^|\.)qwant\.com$/], ['Yandex', /(^|\.)yandex\.[a-z.]{2,6}$/],
  ['Baidu', /(^|\.)baidu\.com$/], ['Naver', /(^|\.)naver\.com$/], ['Daum', /(^|\.)daum\.net$/], ['Seznam', /(^|\.)seznam\.cz$/],
  ['Sogou', /(^|\.)sogou\.com$/], ['360 Search', /(^|\.)so\.com$/], ['Coc Coc', /(^|\.)coccoc\.com$/], ['Mojeek', /(^|\.)mojeek\.com$/],
  ['Kagi', /(^|\.)kagi\.com$/], ['Perplexity', /(^|\.)perplexity\.ai$/], ['You.com', /(^|\.)you\.com$/], ['Yep', /(^|\.)yep\.com$/],
  ['Swisscows', /(^|\.)swisscows\.com$/], ['MetaGer', /(^|\.)metager\.(org|de)$/], ['Presearch', /(^|\.)presearch\.com$/],
  ['Ask', /(^|\.)ask\.com$/], ['AOL', /(^|\.)aol\.com$/], ['ChatGPT', /(^|\.)chatgpt\.com$/], ['Wikipedia', /(^|\.)wikipedia\.org$/]
];

// What an add-on may do that matters most when it can also see every site.
const POWERS = {
  cookies: 'read the cookies that keep you signed in',
  proxy: 'send your browsing through another server',
  debugger: 'take control of pages the way developer tools do',
  nativeMessaging: 'talk to programs on this computer',
  management: 'turn your other add-ons on and off',
  webRequestBlocking: 'change what sites send and receive'
};
const ALL_SITES = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*|\*:\/\/\*\/|https?:\/\/\*\/)$/;

// Policy names that change what a person browses with, not just how the browser behaves.
const RISKY_POLICIES = /^(ExtensionInstallForcelist|ExtensionSettings|DefaultSearchProvider\w*|HomepageLocation|HomepageIsNewTabPage|RestoreOnStartup\w*|NewTabPageLocation|Proxy\w*|ExtensionInstallAllowlist|ExtensionInstallWhitelist|ExtensionInstallSources|DeveloperToolsAvailability|DeveloperToolsDisabled)$/i;

const ORANGE = 45;
const YELLOW = 25;
const badgeFor = (score) => (score >= ORANGE ? 'orange' : score >= YELLOW ? 'yellow' : null);

/** The host of a web address, or of a search engine's address template ("https://x.com/s?q={searchTerms}"). */
function hostOf(url) {
  const s = String(url || '').trim();
  if (/^\{google:baseURL\}/i.test(s)) return 'www.google.com';
  try {
    const u = new URL(s.replace(/\{[^}]*\}/g, 'x'));
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : null;
  } catch { return null; }
}

/** Whether a search engine is one people know: { host, known, engine }. host is null when there is no web address. */
function judgeSearch(url) {
  const host = hostOf(url);
  if (!host) return { host: null, known: true, engine: null };
  const hit = ENGINES.find(([, rx]) => rx.test(host));
  return { host, known: Boolean(hit), engine: hit ? hit[0] : null };
}

// A brand's name in an add-on's name: whole words, or neighbouring words joined ("Bank of America" -> bankofamerica).
function brandIn(name) {
  const w = String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const set = new Set(w);
  for (let i = 0; i + 1 < w.length; i++) { set.add(w[i] + w[i + 1]); if (i + 2 < w.length) set.add(w[i] + w[i + 1] + w[i + 2]); }
  const b = BRANDS.find((x) => x.token.length >= 5 && set.has(x.token));
  return b ? b.token : null;
}

/**
 * One add-on, as checkup.js reads it:
 *   { name, source: 'store' | 'outside' | 'unpacked' | 'commandline' | 'policy' | 'external',
 *     fromStore, signed (Firefox: false when Mozilla did not sign it), permissions: [], hosts: [], searchUrl }
 * `managed`: the computer belongs to a school or company network, where policies are normal.
 * Returns { badge, score, reasons: [{ id, text, points }], notes: [] }: reasons count, notes only describe.
 */
function judgeAddon(a, { managed = false } = {}) {
  const reasons = [];
  const notes = [];
  const add = (id, points, text) => reasons.push({ id, points, text });
  const fromStore = Boolean(a.fromStore);

  if (a.source === 'policy') {
    if (managed) notes.push('Installed by your organization\'s policy.');
    else add('A01', 30, 'Installed by a policy on this computer, so the browser will not let you remove it. On a home computer, that is how unwanted add-ons stay put.');
  }
  if (a.source === 'commandline') add('A04', 40, 'Loaded by a command added to how the browser starts, not installed in the browser. Unwanted software forces add-ons in this way.');
  if (a.source === 'unpacked') add('A03', 20, 'Loaded from a folder on this computer, the way developers test their own add-ons.');
  if (a.source === 'external') add('A05', 15, 'Added by another program on this computer, not by you in the browser.');
  if (!fromStore && (['outside', 'external'].includes(a.source) || (a.source === 'policy' && !managed))) add('A02', 25, 'Not from the browser\'s add-on store, so nobody reviewed it.');
  if (a.signed === false) add('A06', 20, 'Not signed by Mozilla, which checks every Firefox add-on before it can be installed.');

  const perms = (a.permissions || []).map(String);
  const allSites = [...(a.hosts || []), ...perms].some((p) => ALL_SITES.test(String(p).trim()));
  if (allSites) {
    const powers = Object.keys(POWERS).filter((p) => perms.includes(p));
    if (powers.length) add('A07', 20, `Can read and change every site you visit, and ${powers.map((p) => POWERS[p]).join(', ')}.`);
    else add('A08', 10, 'Can read and change every site you visit.');
  }

  if (a.searchUrl) {
    const s = judgeSearch(a.searchUrl);
    if (s.host && !s.known) add('A09', 30, `Changes your search engine to ${s.host}, which is not a search engine people know.`);
    else if (s.host) notes.push(`Sets your search engine to ${s.engine}.`);
  }

  const brand = !fromStore && a.source !== 'unpacked' ? brandIn(a.name) : null;
  if (brand) add('A10', 15, `Uses the name "${brand}" but did not come from a store, so nothing says it is really theirs.`);

  const score = reasons.reduce((n, r) => n + r.points, 0);
  return { badge: badgeFor(score), score, reasons, notes };
}

/**
 * The policies set for one browser: { names: ['ExtensionInstallForcelist', ...] }.
 * On a computer no school or company manages, policies that pick your add-ons, search engine or start page are a
 * hijack until shown otherwise; others (updates, a setting turned off) are only described.
 */
function judgePolicies(names, { managed = false } = {}) {
  const list = [...new Set((names || []).map(String))];
  if (!list.length) return null;
  const risky = list.filter((n) => RISKY_POLICIES.test(n));
  if (managed) return { badge: null, risky, names: list, text: 'This browser follows your organization\'s policies.' };
  if (risky.length) {
    return { badge: 'orange', risky, names: list, text: 'Policies on this computer choose this browser\'s add-ons, search engine or start page, so its own settings cannot change them. Browsers then say they are "managed by your organization". If no school or company looks after this computer, something else set them.' };
  }
  return { badge: null, risky, names: list, text: 'Policies on this computer change how this browser behaves. None of them choose its add-ons, search engine or start page.' };
}

module.exports = { judgeAddon, judgeSearch, judgePolicies, fromStoreUpdate, hostOf, ORANGE, YELLOW };
