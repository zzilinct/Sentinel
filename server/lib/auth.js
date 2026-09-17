'use strict';
/** Accounts, sessions, password hashing, lockout, 2FA, Google OAuth, secret storage. */
const crypto = require('crypto');
const { promisify } = require('util');
const { db, now } = require('./db');
const config = require('../config');
const { HttpError, serializeCookie, parseCookies } = require('./http');
const security = require('./security');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };
// __Host- cookies must be Secure, host-only and Path=/ - browsers enforce it.
const COOKIE = config.secureCookies ? '__Host-sentinel_session' : 'sentinel_session';
const LOCK_AFTER = 8;

/* ------------------------------------------------------------- primitives */

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(plain, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, N, r, p, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(String(plain), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(expected, actual);
}

// Burn the same CPU for unknown emails so response timing can't reveal accounts.
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* ------------------------------------------------ encrypted secret storage */

const secretKey = crypto.createHash('sha256').update(config.secret + ':aes').digest();

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

function decryptSecret(blob) {
  const [ivB64, tagB64, dataB64] = String(blob).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/* ------------------------------------------------------------- validation */

const EMAIL_RX = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

function validateSignup({ email, password, firstName, lastName }) {
  const errors = {};
  email = String(email || '').trim().toLowerCase();
  firstName = String(firstName || '').trim();
  lastName = String(lastName || '').trim();

  if (!EMAIL_RX.test(email) || email.length > 254) errors.email = 'Enter a valid email address';
  if (!firstName) errors.firstName = 'First name is required';
  else if (firstName.length > 60 || /[<>]/.test(firstName)) errors.firstName = 'Enter a valid first name';
  if (lastName.length > 60 || /[<>]/.test(lastName)) errors.lastName = 'Enter a valid last name';

  const problem = security.passwordProblem(password, { email, firstName });
  if (problem) errors.password = problem;

  if (Object.keys(errors).length) throw new HttpError(400, 'validation_failed', 'Please fix the highlighted fields', { errors });
  return { email, password: String(password), firstName, lastName: lastName || null };
}

/* ------------------------------------------------------------------ users */

const uq = {
  byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byGoogle: db.prepare('SELECT * FROM users WHERE google_sub = ?'),
  insert: db.prepare(`INSERT INTO users (id, email, password_hash, first_name, last_name, google_sub, avatar_url, created_at, last_login_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  touch: db.prepare('UPDATE users SET last_login_at = ?, failed_logins = 0, locked_until = 0 WHERE id = ?'),
  failed: db.prepare('UPDATE users SET failed_logins = failed_logins + 1, locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END WHERE id = ?'),
  linkGoogle: db.prepare('UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?'),
  setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  updateName: db.prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?'),
  setTotp: db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = ?, totp_last_counter = 0 WHERE id = ?'),
  totpUsed: db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM users WHERE id = ?')
};

const sq = {
  insert: db.prepare('INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at, user_agent, ip, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  get: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
  seen: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?'),
  del: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  delAllForUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  delOthers: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
  list: db.prepare('SELECT token_hash, kind, created_at, last_seen_at, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY COALESCE(last_seen_at, created_at) DESC')
};

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    name: [u.first_name, u.last_name].filter(Boolean).join(' '),
    avatarUrl: u.avatar_url,
    plan: u.plan || 'free',
    hasPassword: Boolean(u.password_hash),
    googleLinked: Boolean(u.google_sub),
    twoFactorEnabled: Boolean(u.totp_enabled),
    createdAt: u.created_at
  };
}

async function createUser({ email, password, firstName, lastName, googleSub = null, avatarUrl = null }) {
  if (uq.byEmail.get(email)) throw new HttpError(409, 'email_taken', 'An account with this email already exists');
  const userId = id('usr');
  const hash = password ? await hashPassword(password) : null;
  uq.insert.run(userId, email, hash, firstName, lastName, googleSub, avatarUrl, now(), now());
  return uq.byId.get(userId);
}

/* ----------------------------------------------------------- password login */

/**
 * Check email + password with lockout. Always does the same hashing work,
 * whether or not the account exists.
 */
async function checkPassword(email, password, req) {
  const user = uq.byEmail.get(email);
  if (user && user.locked_until > now()) {
    await verifyPassword(password, DUMMY_HASH);
    const minutes = Math.ceil((user.locked_until - now()) / 60000);
    throw new HttpError(423, 'account_locked', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  const ok = await verifyPassword(password, user && user.password_hash ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    if (user && user.password_hash) {
      uq.failed.run(LOCK_AFTER, now() + 15 * 60 * 1000, user.id);
      security.audit('login_failed', { userId: user.id, req });
    }
    if (user && !user.password_hash) {
      throw new HttpError(401, 'use_google', 'This account signs in with Google. Use "Continue with Google".');
    }
    throw new HttpError(401, 'bad_credentials', 'Email or password is incorrect');
  }
  return user;
}

/* ----------------------------------------------------- 2FA login challenges */

const challenges = new Map(); // hash -> { userId, expires, next, attempts }

function createChallenge(userId, next = '/app') {
  const token = crypto.randomBytes(24).toString('base64url');
  challenges.set(sha256(token), { userId, expires: now() + 5 * 60 * 1000, next, attempts: 0 });
  return token;
}

function completeChallenge(token, code) {
  const key = sha256(String(token || ''));
  const ch = challenges.get(key);
  if (!ch || ch.expires < now()) {
    challenges.delete(key);
    throw new HttpError(401, 'challenge_expired', 'Your sign-in expired. Please sign in again.');
  }
  const user = uq.byId.get(ch.userId);
  if (!user || !user.totp_enabled) throw new HttpError(401, 'challenge_expired', 'Please sign in again.');
  const counter = security.verifyTotp(decryptSecret(user.totp_secret), code, user.totp_last_counter);
  if (counter === null) {
    if (++ch.attempts >= 5) challenges.delete(key);
    throw new HttpError(401, 'bad_code', 'That code is not correct');
  }
  challenges.delete(key);
  uq.totpUsed.run(counter, user.id);
  return { user, next: ch.next };
}

setInterval(() => {
  const t = now();
  for (const [k, c] of challenges) if (c.expires < t) challenges.delete(k);
}, 60_000).unref();

/* --------------------------------------------------------------- sessions */

function createSession(userId, req, { kind = 'web' } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = kind === 'web' ? config.sessionTtlMs : 90 * 24 * 60 * 60 * 1000;
  const expires = now() + ttl;
  sq.insert.run(sha256(token), userId, kind, now(), expires, String((req && req.headers['user-agent']) || '').slice(0, 300), req ? security.clientIp(req) : null, now());
  uq.touch.run(now(), userId);
  return { token, expiresAt: expires };
}

function sessionCookie(token) {
  return serializeCookie(COOKIE, token, { maxAge: config.sessionTtlMs / 1000, secure: config.secureCookies, sameSite: 'Lax' });
}

function clearCookie() {
  return serializeCookie(COOKIE, '', { maxAge: 0, secure: config.secureCookies });
}

function tokenFrom(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return parseCookies(req)[COOKIE] || null;
}

/** Resolve the caller from a bearer token or session cookie. */
function currentUser(req) {
  if (req._user !== undefined) return req._user;
  const token = tokenFrom(req);
  req._user = null;
  if (!token || token.length > 200) return null;

  const hash = sha256(token);
  const row = sq.get.get(hash);
  if (!row) return null;
  if (row.expires_at < now()) { sq.del.run(hash); return null; }
  if (!row.last_seen_at || now() - row.last_seen_at > 5 * 60 * 1000) sq.seen.run(now(), hash);
  req._sessionHash = hash;
  req._user = uq.byId.get(row.user_id) || null;
  return req._user;
}

function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw new HttpError(401, 'unauthenticated', 'Sign in to continue');
  return u;
}

function destroySession(req) {
  const token = tokenFrom(req);
  if (token) sq.del.run(sha256(token));
}

/* ----------------------------------------------------------- google oauth */

const oq = {
  insert: db.prepare('INSERT INTO oauth_states (state, created_at, next_url) VALUES (?, ?, ?)'),
  take: db.prepare('SELECT * FROM oauth_states WHERE state = ?'),
  del: db.prepare('DELETE FROM oauth_states WHERE state = ?')
};

function googleRedirectUri() {
  return `${config.publicOrigin}/api/v1/auth/google/callback`;
}

function safeNext(next) {
  const n = String(next || '');
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n.slice(0, 200) : '/app';
}

function googleAuthUrl(nextUrl) {
  if (!config.google.enabled) throw new HttpError(503, 'google_not_configured', 'Google sign-in is not configured on this server yet');
  const state = crypto.randomBytes(24).toString('base64url');
  oq.insert.run(state, now(), safeNext(nextUrl));
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function googleExchange(code, state) {
  const row = oq.take.get(String(state));
  if (!row || now() - row.created_at > 10 * 60 * 1000) throw new HttpError(400, 'bad_state', 'Sign-in link expired. Please try again.');
  oq.del.run(row.state);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code'
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new HttpError(502, 'google_exchange_failed', 'Google rejected the sign-in attempt');
  const tokens = await res.json();

  const claims = decodeIdToken(tokens.id_token);
  if (!claims || !claims.email) throw new HttpError(502, 'google_no_email', 'Google did not return an email address');
  // The token came straight from Google over TLS, but still check it was minted for us.
  if (claims.aud !== config.google.clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) {
    throw new HttpError(401, 'google_bad_token', 'Google sign-in could not be verified');
  }
  if (claims.email_verified === false) throw new HttpError(401, 'google_unverified', 'Verify your Google email address first');
  if (claims.exp && claims.exp * 1000 < now()) throw new HttpError(401, 'google_expired', 'Google sign-in expired');

  return { claims, nextUrl: row.next_url || '/app' };
}

function decodeIdToken(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
}

async function upsertGoogleUser(claims) {
  const email = String(claims.email).toLowerCase();
  const existing = uq.byGoogle.get(claims.sub) || uq.byEmail.get(email);
  if (existing) {
    if (!existing.google_sub) uq.linkGoogle.run(claims.sub, claims.picture || null, existing.id);
    return uq.byId.get(existing.id);
  }
  const first = String(claims.given_name || (claims.name || email).split(' ')[0] || 'Friend').slice(0, 60);
  const last = claims.family_name ? String(claims.family_name).slice(0, 60) : null;
  return createUser({ email, password: null, firstName: first, lastName: last, googleSub: claims.sub, avatarUrl: claims.picture || null });
}

module.exports = {
  uq, sq,
  id, hashPassword, verifyPassword, sha256,
  encryptSecret, decryptSecret,
  validateSignup, createUser, publicUser, checkPassword,
  createChallenge, completeChallenge,
  createSession, sessionCookie, clearCookie, currentUser, requireUser, destroySession,
  googleAuthUrl, googleExchange, upsertGoogleUser, safeNext
};
