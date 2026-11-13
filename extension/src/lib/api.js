/** Sentinel API client shared by the service worker, popup and options page. */
import { BRAND } from './brand.js';
// The look's one table (globalThis.SentinelLook), the site's own file.
import './look.js';

// Firefox answers through `browser` (promises); Chrome, Edge and Brave through
// `chrome` (promises too, in Manifest V3). One name, promise style everywhere.
export const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

export const DEFAULTS = {
  apiBase: BRAND.origin,
  enabled: true,
  emailProtection: true,
  warnOnNavigate: true,
  marksLevel: 'all',       // Marks beside links: every link (a quiet tick on clean ones), risky links, or serious only
  warningsLevel: 'all',    // Pop-up warnings: always (orange and red), danger only, or never (masks.js warns)
  scanOverlay: true,       // the golden line and tint while results are being checked
  commandGuard: true,      // Stop pasted commands: a page cannot copy a command only a trick would ask you to paste
  chatHints: true          // A quiet hint under a web-chat message that asks for a code, gift cards or crypto (read in the page)
};

export const COLORS = { yellow: '#f5c542', orange: '#f08a24', red: '#e5484d' };

/**
 * The companion's older settings in the words the Windows app uses, once. "Show masks from orange" or "red only" becomes
 * serious only (a warning mark is never hidden now); no ticks becomes risky links. "Red only" also meant no warning over
 * an orange page: danger only. Turning off desktop notifications did not stop that warning, so it stays: always.
 */
export function levelsFrom(old) {
  const strict = old.minimumBadge === 'orange' || old.minimumBadge === 'red';
  return {
    marksLevel: strict ? 'danger' : old.markSafe === false ? 'risky' : 'all',
    warningsLevel: old.minimumBadge === 'red' ? 'danger' : 'all'
  };
}
export const OLD_LEVEL_KEYS = ['minimumBadge', 'markSafe', 'notifications'];

/** Pop-up warnings: does a page at this severity get one? The rule of masks.js warns, which the Windows app uses. */
export function warns(level, badge) {
  if (level === 'quiet') return false;
  if (level === 'danger') return badge === 'red';
  return badge === 'red' || badge === 'orange';
}

export async function getSettings() {
  return { ...DEFAULTS, ...(await ext.storage.sync.get(DEFAULTS)) };
}

async function getToken() {
  const { authToken } = await ext.storage.local.get('authToken');
  return authToken || null;
}

/**
 * Whether a fresh install should open the site's connect page. Not when the companion is paired by the time the first
 * sign-in attempt is over (the desktop app or the settings page handed it a token meanwhile): the tab would only ask a
 * signed-in person to sign in.
 */
export async function wantsConnectTab(reason, signedIn) {
  return reason === 'install' && !signedIn && !(await getToken());
}

export async function setToken(token) {
  if (token) await ext.storage.local.set({ authToken: token });
  else await ext.storage.local.remove('authToken');
}

export class ApiError extends Error {
  constructor(message, status, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}

/** Call the API with the stored bearer token (or the site session cookie as a fallback). */
export async function apiFetch(path, { method = 'GET', body, timeout = 20000 } = {}) {
  const { apiBase } = await getSettings();
  const token = await getToken();
  const headers = { 'X-Sentinel-Client': 'extension' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      credentials: token ? 'omit' : 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    throw new ApiError('Sentinel is unreachable right now', 0, 'offline');
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = (data && data.error) || {};
    // A fault on Sentinel's side is said in a plain sentence; its own wording is kept for things the person can fix.
    const message = res.status >= 500 || !e.message ? 'Sentinel could not do that right now. Try again in a moment.' : e.message;
    throw new ApiError(message, res.status, e.code, e);
  }
  if (data && typeof data.lookRev === 'number') followLook(data.lookRev);
  return data;
}

/**
 * The look chosen on the person's other devices. Every live-scanning answer says when the account's look last
 * changed (lookRev); only when that moved is the look itself asked for. Nothing polls.
 */
let lookAsking = null;
async function followLook(revision) {
  if (lookAsking || !globalThis.SentinelLook) return;
  const { look } = await ext.storage.local.get('look').catch(() => ({}));
  if (look && look.rev === revision) return;
  lookAsking = apiFetch('/api/v1/account/look')
    .then((r) => keepLook(globalThis.SentinelLook.merge(look, r), revision))
    .catch(() => { /* asked again with the next answer */ })
    .finally(() => { lookAsking = null; });
}

/**
 * Keeps a look (a look.js record) for every part of the companion: the line and the marks on search pages read the
 * accent as light and the marks' metal from here. `rev` is the account's, when known. The same look again is not
 * written: every open page and search page hears a write (storage.onChanged).
 */
export async function keepLook(r, rev) {
  const L = globalThis.SentinelLook;
  const rec = L.record(r);
  const x = L.ramp(rec.accent, 'dark');
  const look = { ...rec, rev: rev || 0, live: { acc: x['--live'], hi: x['--live-hi'], lite: x['--live-lite'], rgb: x['--live-rgb'] }, metal: L.metal(rec.accent) };
  const { look: was } = await ext.storage.local.get('look').catch(() => ({}));
  if (JSON.stringify(was) !== JSON.stringify(look)) await ext.storage.local.set({ look });
  return rec;
}

export function siteUrl(apiBase, path) {
  return `${apiBase}${path}`;
}
