/** Sentinel API client shared by the service worker, popup and options page. */
import { BRAND } from './brand.js';

export const DEFAULTS = {
  apiBase: BRAND.origin,
  enabled: true,
  emailProtection: true,
  badgeStyle: 'mask',        // 'mask' = the three Sentinel masks, 'emoji' = 🎭 in a coloured ring
  warnOnNavigate: true,
  notifications: true,
  minimumBadge: 'yellow'
};

export const COLORS = { yellow: '#f5c542', orange: '#f08a24', red: '#e5484d' };

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

async function getToken() {
  const { authToken } = await chrome.storage.local.get('authToken');
  return authToken || null;
}

export async function setToken(token) {
  if (token) await chrome.storage.local.set({ authToken: token });
  else await chrome.storage.local.remove('authToken');
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
    throw new ApiError(e.message || `Request failed (${res.status})`, res.status, e.code, e);
  }
  return data;
}

export function siteUrl(apiBase, path) {
  return `${apiBase}${path}`;
}
