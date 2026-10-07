/**
 * Password alarm: the parts that decide, kept apart from the browser so they can be tested on their own.
 *
 * The person picks accounts to protect. The next time they sign in on that account's own sign-in site, the password
 * is turned into a salted PBKDF2 hash on this computer and only the hash, its salt and the password's length are
 * kept (for the last KEEP different passwords signed in with), in the extension's local storage: never the password,
 * never synced, never sent. Typing the same password on
 * any other site sounds the alarm, even on a phishing page no list knows yet.
 *
 * Where a password belongs is a short list of sign-in hosts, not every domain a brand owns (server/lib/scan/brands.js
 * lists those). Brands also own hosts where anyone can publish a page: googleusercontent.com, sharepoint.com,
 * blob.core.windows.net and amazonaws.com all carry phishing, so a password typed there must still raise the alarm.
 */

export const ITERATIONS = 200000;
export const MIN_LENGTH = 6;

export const PRESETS = [
  { id: 'google', name: 'Google', homes: ['accounts.google.com'] },
  { id: 'microsoft', name: 'Microsoft', homes: ['login.live.com', 'login.microsoftonline.com', 'login.microsoft.com', 'account.live.com', 'account.microsoft.com'] },
  { id: 'apple', name: 'Apple', homes: ['apple.com', 'icloud.com'] },
  { id: 'paypal', name: 'PayPal', homes: ['paypal.com'] },
  // AWS is a different account with its own password, on amazon.com addresses.
  { id: 'amazon', name: 'Amazon', except: ['aws.amazon.com'], homes: ['com', 'co.uk', 'de', 'fr', 'it', 'es', 'ca', 'co.jp', 'in', 'com.au', 'com.br', 'com.mx', 'nl', 'se', 'pl', 'sg', 'ae', 'sa', 'eg', 'com.tr', 'com.be', 'co.za'].map((cc) => `amazon.${cc}`) }
];

/** How many of an account's recent passwords are kept (several Google accounts, or a password changed lately). */
export const KEEP = 3;

const under = (h, d) => h === d || h.endsWith(`.${d}`);

/** The host itself or a subdomain of it: accounts.google.com is home for Google, accounts.google.com.evil.top is not. */
export function isHome(host, homes, except) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  return Boolean(h) && (homes || []).some((d) => under(h, d)) && !(except || []).some((d) => under(h, d));
}

/** An account's homes, from its preset when it has one, so a corrected preset reaches accounts already set up. */
function homeOf(a, host) {
  const preset = PRESETS.find((p) => p.id === a.id);
  return preset ? isHome(host, preset.homes, preset.except) : isHome(host, a.homes);
}

/** An account's kept password hashes, newest first: [{ salt, hash, length, at }]. Before 1.12.1 there was one. */
export function hashesOf(a) {
  if (Array.isArray(a.hashes)) return a.hashes;
  return a && a.hash ? [{ salt: a.salt, hash: a.hash, length: a.length, at: a.learnedAt || 0 }] : [];
}

/** Endings that many unrelated sites share: a bank typed as one of these would make the whole web its home. */
const TOO_WIDE = /^(com|net|org|co|gov|edu|bank|[a-z]{2}|(com|co|net|org|gov|ac)\.[a-z]{2})$/;

/** The domain a person typed for their bank ("https://www.chase.com/login" -> "chase.com"), or null. */
export function bankDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s || s.length > 253) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = `https://${s}`;
  let host;
  try { host = new URL(s).hostname; } catch { return null; }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || TOO_WIDE.test(host)) return null;
  // Hosts where anyone can publish a page are never somebody's bank.
  if (isHome(host, ['googleusercontent.com', 'sharepoint.com', 'windows.net', 'amazonaws.com', 'github.io', 'netlify.app', 'vercel.app', 'pages.dev', 'web.app', 'firebaseapp.com', 'blogspot.com', 'wixsite.com', 'weebly.com'])) return null;
  return host;
}

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

/** A fresh random salt, base64. */
export function newSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

/** PBKDF2-SHA256 of the password with the salt, base64. WebCrypto: the same in Chromium, Firefox and Node. */
export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: ITERATIONS }, key, 256));
}

/** Compared without stopping at the first difference, so timing says nothing about how close a guess was. */
export function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The account whose own sign-in site this is (its password may be learned here), or null.
 * @param {{ accounts: object }} state
 */
export function homeAccount(state, host) {
  return Object.values((state && state.accounts) || {}).find((a) => a.on && homeOf(a, host)) || null;
}

/** Protected accounts whose password must not be typed on this host: learned, switched on, and not at home or allowed here. */
export function guardedHere(state, host) {
  const h = String(host || '').toLowerCase();
  return Object.values((state && state.accounts) || {})
    .filter((a) => a.on && hashesOf(a).length && !homeOf(a, h) && !(a.allowed || []).includes(h));
}
