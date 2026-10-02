'use strict';
/**
 * Sentinel's models: every released version of the app, named by its major number after a guardian from myth.
 *
 *   1.x.y Argus   2.x.y Cerberus   3.x.y Talos   4.x.y Heimdall   5.x.y Lokapalas
 *
 * The list comes from the GitHub Releases the release workflow publishes (one installer per version). The three
 * newest models come with slightly smaller allowances on Pro (plans.js), and the five newest are for paid plans only. Models are an app idea: the rules only
 * apply where this server runs inside the Sentinel app (SENTINEL_DEVICE_ACCOUNTS), or where SENTINEL_MODELS=1 says
 * so (tests). A browser on the hosted site always gets the hosted engine.
 */
const fs = require('fs');
const path = require('path');
const { version: OWN } = require('../../package.json');

const NAMES = { 1: 'Argus', 2: 'Cerberus', 3: 'Talos', 4: 'Heimdall', 5: 'Lokapalas' };
const REPO = 'zzilinct/Sentinel';
// Versions before this one update themselves to the newest release whatever was chosen (their code predates the
// choice), so a model older than this cannot be kept.
const KEEPS_CHOICE_SINCE = '1.9.2';
const NEWEST_LIMITED = 3;   // the newest three: Pro has slightly smaller allowances on them (plans.js)
const NEWEST_PAID = 5;      // the newest five: not on the free plan
const REFRESH_MS = 6 * 60 * 60 * 1000;

const parse = (v) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
const cmp = (a, b) => {
  const pa = parse(a).slice(1).map(Number);
  const pb = parse(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};
const nameFor = (v) => { const m = parse(v); return m ? NAMES[Number(m[1])] || `Model ${m[1]}` : null; };
const label = (v) => `${nameFor(v)} ${String(v).replace(/^v/, '')}`;

const enabled = () => process.env.SENTINEL_DEVICE_ACCOUNTS === '1' || process.env.SENTINEL_MODELS === '1';
const offline = () => process.env.SENTINEL_MODELS_OFFLINE === '1' || process.env.NODE_ENV === 'test';
const cacheFile = () => (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'models.json') : null);

let releases = null;   // [{ version, date, installer, manifest }], newest first
let fetchedAt = 0;
let inflight = null;

function load() {
  if (releases) return;
  try {
    const file = cacheFile();
    if (file && fs.existsSync(file)) ({ releases, fetchedAt } = JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch { releases = null; }
}

/** Fetch the published releases (cached for six hours, and on disk for the next start). Never throws. */
function refresh() {
  if (offline() || inflight || Date.now() - fetchedAt < REFRESH_MS) return inflight || Promise.resolve();
  inflight = (async () => {
    const out = [];
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Sentinel' }, signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const list = await res.json();
      for (const r of list) {
        if (r.draft || r.prerelease || !parse(r.tag_name)) continue;
        const version = r.tag_name.replace(/^v/, '');
        const asset = (re) => (r.assets || []).find((a) => re.test(a.name));
        const installer = asset(new RegExp(`^Sentinel-Setup-${version.replace(/\./g, '\\.')}\\.exe$`));
        const manifest = asset(/^latest\.yml$/);
        out.push({ version, date: r.published_at, installer: installer ? installer.browser_download_url : null, manifest: manifest ? manifest.browser_download_url : null });
      }
      if (list.length < 100) break;
    }
    releases = out.sort((a, b) => cmp(b.version, a.version));
    fetchedAt = Date.now();
    try { const file = cacheFile(); if (file) fs.writeFileSync(file, JSON.stringify({ releases, fetchedAt })); } catch { /* the memory copy will do */ }
  })().catch(() => { fetchedAt = Date.now() - REFRESH_MS + 10 * 60 * 1000; /* try again in ten minutes */ }).finally(() => { inflight = null; });
  return inflight;
}

/** Every known version, newest first: the published ones, and this copy's own (which may not be published yet). */
function versions() {
  load();
  refresh();
  const known = new Map((releases || []).map((r) => [r.version, r]));
  if (!known.has(OWN)) known.set(OWN, { version: OWN, date: null, installer: null, manifest: null });
  return [...known.values()].sort((a, b) => cmp(b.version, a.version));
}

const newest = () => versions().slice(0, NEWEST_LIMITED).map((r) => r.version);
const isNewest = (v = OWN) => newest().includes(v);
const paidOnly = () => versions().slice(0, NEWEST_PAID).map((r) => r.version);
const isPaidOnly = (v = OWN) => paidOnly().includes(v);
const keepsChoice = (v) => cmp(v, KEEPS_CHOICE_SINCE) >= 0;

/** The newest model the free plan may use, or null if none is older than the paid five. */
function newestFree() {
  const older = versions().slice(NEWEST_PAID);
  return older.length ? older[0].version : null;
}

/**
 * Is the free plan shut out of the model this copy runs? Only once a free model exists that will stay put when
 * chosen: before that, sending free accounts to an older model would only see it update itself back here.
 */
function freeLocked() {
  if (!enabled() || !isPaidOnly()) return false;
  const free = newestFree();
  return Boolean(free && keepsChoice(free));
}

/** The model picker's data: models by category, each marked for this account's plan. */
function catalogue(planId) {
  const limited = new Set(newest());
  const paid = new Set(paidOnly());
  const groups = new Map();
  for (const r of versions()) {
    const name = nameFor(r.version);
    if (!groups.has(name)) groups.set(name, { name, major: Number(parse(r.version)[1]), versions: [] });
    groups.get(name).versions.push({
      version: r.version,
      label: label(r.version),
      date: r.date,
      current: r.version === OWN,
      newest: limited.has(r.version),
      paidOnly: paid.has(r.version),
      installable: Boolean(r.installer && r.manifest),
      keepsChoice: keepsChoice(r.version),
      available: !(planId === 'free' && paid.has(r.version) && freeLockApplies())
    });
  }
  return {
    enabled: enabled(),
    current: { version: OWN, label: label(OWN), name: nameFor(OWN), newest: isNewest(), paidOnly: isPaidOnly() },
    planned: Object.entries(NAMES).map(([major, name]) => ({ major: Number(major), name, released: versions().some((r) => Number(parse(r.version)[1]) === Number(major)) })),
    newestFree: newestFree(),
    categories: [...groups.values()].sort((a, b) => b.major - a.major)
  };
}
// The same rule as freeLocked, for any of the newest models rather than this copy's.
function freeLockApplies() { const free = newestFree(); return Boolean(enabled() && free && keepsChoice(free)); }

/** A published release, for the app's installer (desktop/src/models.js checks it again against GitHub itself). */
const release = (v) => versions().find((r) => r.version === v) || null;

module.exports = { NAMES, nameFor, label, enabled, versions, newest, isNewest, paidOnly, isPaidOnly, newestFree, freeLocked, catalogue, release, refresh, own: () => OWN,
  _test: { cmp, set: (list) => { releases = list; fetchedAt = Date.now(); } } };
