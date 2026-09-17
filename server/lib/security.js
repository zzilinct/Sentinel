'use strict';
/**
 * Defensive plumbing: response headers, CSRF origin checks, rate limiting,
 * client IP resolution, audit logging, TOTP and password policy.
 */
const crypto = require('crypto');
const config = require('../config');
const { db, now } = require('./db');
const { HttpError } = require('./http');

/* ---------------------------------------------------------------- headers */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: https://lh3.googleusercontent.com",
  "connect-src 'self' https://api.github.com",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  ...(config.isProd ? ['upgrade-insecure-requests'] : [])
].join('; ');

function baseHeaders() {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
    'Origin-Agent-Cluster': '?1',
    'Content-Security-Policy': CSP
  };
  if (config.secureCookies) h['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  return h;
}

/* ------------------------------------------------------------------- cors */

function isExtensionOrigin(origin) {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin) || /^moz-extension:\/\/[0-9a-f-]{36}$/.test(origin);
}

function allowedOrigin(origin) {
  if (!origin) return false;
  if (origin === config.publicOrigin || origin === config.brand.origin) return true;
  if (isExtensionOrigin(origin)) return true;
  if (!config.isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin) || origin === config.publicOrigin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name, X-Sentinel-Client',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

/* ------------------------------------------------------------------- csrf */

/**
 * State-changing requests must come from our own pages, the extension or the
 * desktop app. Cookies alone are never enough: a cross-site form post has
 * neither an allowed Origin nor a bearer token.
 */
function assertSameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if ((req.headers.authorization || '').startsWith('Bearer ')) return; // token clients aren't cookie-driven
  const origin = req.headers.origin;
  if (origin) {
    if (allowedOrigin(origin)) return;
    throw new HttpError(403, 'bad_origin', 'Request blocked: cross-site request');
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      if (allowedOrigin(new URL(referer).origin)) return;
    } catch { /* fall through */ }
  }
  throw new HttpError(403, 'bad_origin', 'Request blocked: missing origin');
}

/* -------------------------------------------------------------- client ip */

function clientIp(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd.slice(0, 64);
  }
  return String(req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

/* ------------------------------------------------------------ rate limits */

const buckets = new Map();

/** Fixed-window counter. Throws 429 with Retry-After information. */
function rateLimit(key, max, windowMs, message = 'Too many requests. Please slow down and try again shortly.') {
  const t = now();
  let b = buckets.get(key);
  if (!b || t > b.reset) {
    b = { n: 0, reset: t + windowMs };
    buckets.set(key, b);
  }
  b.n++;
  if (b.n > max) {
    throw new HttpError(429, 'rate_limited', message, { retryAfter: Math.ceil((b.reset - t) / 1000) });
  }
}

setInterval(() => {
  const t = now();
  for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k);
}, 60_000).unref();

/* -------------------------------------------------------------- audit log */

const auditStmt = db.prepare('INSERT INTO audit_log (user_id, event, ip, detail, created_at) VALUES (?, ?, ?, ?, ?)');

function audit(event, { userId = null, req = null, detail = null } = {}) {
  try {
    auditStmt.run(userId, event, req ? clientIp(req) : null, detail ? String(detail).slice(0, 300) : null, now());
  } catch { /* never fail a request over logging */ }
}

/* --------------------------------------------------------- password policy */

const COMMON_PASSWORDS = new Set([
  'password1', 'password12', 'password123', 'passw0rd1', 'qwerty123', 'qwertyuiop1', '12345678a', '123456789a',
  'iloveyou1', 'welcome1', 'welcome123', 'admin123', 'letmein1', 'abc12345', 'abcd1234', 'football1', 'monkey123',
  'sunshine1', 'princess1', 'dragon123', 'baseball1', 'shadow123', 'master123', 'trustno1', 'superman1',
  'starwars1', 'computer1', 'whatever1', 'michael1', 'jennifer1', 'hello1234', 'freedom1', 'summer2024',
  'summer2025', 'summer2026', 'winter2025', 'winter2026', 'spring2026', 'changeme1', 'sentinel1', 'sentinel123',
  'p@ssw0rd1', '1q2w3e4r5t', 'zaq12wsx', 'asdf1234', 'test1234', 'qwer1234', '1qaz2wsx', 'pa55word1'
]);

function passwordProblem(password, { email = '', firstName = '' } = {}) {
  const pw = String(password || '');
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (pw.length > 200) return 'Password is too long';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Include at least one letter and one number';
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) return 'That password is too common - choose something less predictable';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'Password should not contain your email address';
  if (firstName && firstName.length >= 3 && pw.toLowerCase().includes(firstName.toLowerCase())) return 'Password should not contain your name';
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|abcdefghij)/i.test(pw)) return 'Password is too predictable';
  return null;
}

/* ------------------------------------------------------------------- TOTP */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

function newTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Verify a 6-digit code within +/-1 step. Returns the matched counter so the
 * caller can refuse reuse of the same code (replay protection), or null.
 */
function verifyTotp(secretB32, code, lastCounter = 0, t = now()) {
  const digits = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretB32);
  const current = Math.floor(t / 1000 / 30);
  for (const c of [current - 1, current, current + 1]) {
    if (c <= lastCounter) continue;
    const expected = hotp(secret, c);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return c;
  }
  return null;
}

function totpUri(secretB32, email) {
  const label = encodeURIComponent(`${config.brand.name}:${email}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(config.brand.name)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = {
  baseHeaders, corsHeaders, assertSameOrigin, clientIp, rateLimit, audit,
  passwordProblem, newTotpSecret, verifyTotp, totpUri, hotp, base32Decode
};
