'use strict';
const { sendJson, send, HttpError, readJson, parseUrl } = require('../lib/http');
const A = require('../lib/auth');
const security = require('../lib/security');
const plans = require('../lib/plans');
const config = require('../config');
const crypto = require('crypto');
const mailer = require('../lib/mailer');
const { db } = require('../lib/db');

const resets = {
  insert: db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  get: db.prepare('SELECT * FROM password_resets WHERE token_hash = ?'),
  // Using one link invalidates every outstanding link for that account.
  use: db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
};

const verifications = {
  insert: db.prepare('INSERT INTO email_verifications (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  get: db.prepare('SELECT * FROM email_verifications WHERE token_hash = ?'),
  use: db.prepare('UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Issue a 24-hour, single-use verification link and email it. Returns what
 * happened so the client never claims a message went out when it didn't.
 */
async function sendVerification(user, req) {
  if (!config.mailConfigured) return 'unavailable';
  const token = crypto.randomBytes(32).toString('base64url');
  verifications.insert.run(A.sha256(token), user.id, Date.now(), Date.now() + 24 * 60 * 60 * 1000);
  const link = `${config.publicOrigin}/verify?token=${token}`;
  const result = await mailer.send({
    to: user.email,
    subject: 'Confirm your Sentinel email address',
    text: `Hi ${user.first_name},

Confirm this is your email address to finish setting up Sentinel. The link works once and expires in 24 hours:

${link}

If you didn't create a Sentinel account, you can ignore this email.`,
    html: mailer.layout('Confirm your email address', `<p style="color:#b9b6ae;line-height:1.6;margin:0 0 24px">Hi ${escapeHtml(user.first_name)}, confirm this is your email address to finish setting up Sentinel. The link works once and expires in 24 hours.</p>
      <a href="${link}" style="display:inline-block;background:#d4ae63;color:#16130b;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:11px">Confirm email address</a>
      <p style="color:#86847e;font-size:13px;line-height:1.6;margin:24px 0 0">Didn't create a Sentinel account? Ignore this email.</p>`)
  });
  security.audit('verification_sent', { userId: user.id, req, detail: result.ok ? 'ok' : result.reason });
  return result.ok ? 'sent' : 'failed';
}

function register(router) {
  router.get('/api/v1/auth/config', (req, res) => {
    sendJson(res, 200, {
      googleEnabled: config.google.enabled,
      billingMode: config.billingMode,
      origin: config.publicOrigin,
      verificationAvailable: config.mailConfigured,
      researchAvailable: config.researchEnabled,
      termsVersion: A.TERMS_VERSION,
      plans: plans.publicPlans()
    });
  });

  router.post('/api/v1/auth/signup', async (req, res) => {
    const ip = security.clientIp(req);
    security.rateLimit(`signup:${ip}`, config.isTest ? 10000 : 8, 60 * 60 * 1000, 'Too many accounts created from this network. Try again later.');
    const clean = A.validateSignup(await readJson(req));
    const user = await A.createUser(clean);
    security.audit('signup', { userId: user.id, req });
    const { token } = A.createSession(user.id, req);
    // 'sent' | 'failed' | 'unavailable' - the client only says an email went out when one did.
    const verification = await sendVerification(user, req);
    sendJson(res, 201, { user: A.publicUser(user), verification }, { 'Set-Cookie': A.sessionCookie(token) });
  });

  /* ------------------------------------------------------ email verification */

  router.post('/api/v1/auth/verify', async (req, res) => {
    const body = await readJson(req);
    security.rateLimit(`verify:${security.clientIp(req)}`, 30, 60 * 60 * 1000);
    const row = verifications.get.get(A.sha256(String(body.token || '')));
    if (!row || row.used_at || row.expires_at < Date.now()) {
      throw new HttpError(400, 'verify_invalid', 'This verification link has expired or was already used. Request a new one from Security settings.');
    }
    const user = A.uq.byId.get(row.user_id);
    if (!user) throw new HttpError(400, 'verify_invalid', 'This verification link is no longer valid.');
    A.uq.markVerified.run(Date.now(), user.id);
    verifications.use.run(Date.now(), user.id);
    security.audit('email_verified', { userId: user.id, req });
    sendJson(res, 200, { ok: true, user: A.publicUser(A.uq.byId.get(user.id)) });
  });

  router.post('/api/v1/auth/verify/resend', async (req, res) => {
    const user = A.requireUser(req);
    security.rateLimit(`verify-resend:${user.id}`, 3, 60 * 60 * 1000, 'You can request three verification emails an hour.');
    if (user.email_verified_at) { sendJson(res, 200, { verification: 'already' }); return; }
    sendJson(res, 200, { verification: await sendVerification(user, req) });
  });

  router.post('/api/v1/auth/login', async (req, res) => {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const ip = security.clientIp(req);
    security.rateLimit(`login:ip:${ip}`, 30, 15 * 60 * 1000, 'Too many sign-in attempts. Please wait a few minutes.');
    security.rateLimit(`login:email:${email}`, 12, 15 * 60 * 1000, 'Too many sign-in attempts. Please wait a few minutes.');

    const user = await A.checkPassword(email, String(body.password || ''), req);

    if (user.totp_enabled) {
      const challenge = A.createChallenge(user.id, A.safeNext(body.next));
      sendJson(res, 200, { twoFactorRequired: true, challenge });
      return;
    }
    security.audit('login', { userId: user.id, req });
    const { token } = A.createSession(user.id, req);
    sendJson(res, 200, { user: A.publicUser(A.uq.byId.get(user.id)) }, { 'Set-Cookie': A.sessionCookie(token) });
  });

  router.post('/api/v1/auth/login/2fa', async (req, res) => {
    const body = await readJson(req);
    security.rateLimit(`2fa:${security.clientIp(req)}`, 20, 15 * 60 * 1000);
    const { user, next } = A.completeChallenge(body.challenge, body.code);
    security.audit('login_2fa', { userId: user.id, req });
    const { token } = A.createSession(user.id, req);
    sendJson(res, 200, { user: A.publicUser(A.uq.byId.get(user.id)), next }, { 'Set-Cookie': A.sessionCookie(token) });
  });

  /* ------------------------------------------------------ password reset */

  router.post('/api/v1/auth/forgot', async (req, res) => {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    security.rateLimit(`forgot:ip:${security.clientIp(req)}`, 10, 60 * 60 * 1000, 'Too many reset requests. Please try again later.');
    security.rateLimit(`forgot:email:${email}`, 3, 60 * 60 * 1000, 'Too many reset requests. Please try again later.');

    const user = A.uq.byEmail.get(email);
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      resets.insert.run(A.sha256(token), user.id, Date.now(), Date.now() + 30 * 60 * 1000);
      const link = `${config.publicOrigin}/reset?token=${token}`;
      await mailer.send({
        to: user.email,
        subject: 'Reset your Sentinel password',
        text: `Hi ${user.first_name},\n\nUse this link to choose a new Sentinel password. It expires in 30 minutes and works once:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email - your password hasn't changed.`,
        html: mailer.layout('Reset your password', `<p style="color:#b9b6ae;line-height:1.6;margin:0 0 24px">Hi ${escapeHtml(user.first_name)}, use the button below to choose a new password. The link expires in 30 minutes and works once.</p>
          <a href="${link}" style="display:inline-block;background:#d4ae63;color:#16130b;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:11px">Choose a new password</a>
          <p style="color:#86847e;font-size:13px;line-height:1.6;margin:24px 0 0">Didn't ask for this? Ignore this email. Your password hasn't changed.</p>`)
      });
      security.audit('password_reset_requested', { userId: user.id, req });
    } else {
      // Spend similar time either way so the response can't reveal which emails have accounts.
      await new Promise((r) => setTimeout(r, 120 + Math.random() * 120));
    }
    sendJson(res, 200, { ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
  });

  router.post('/api/v1/auth/reset', async (req, res) => {
    const body = await readJson(req);
    security.rateLimit(`reset:${security.clientIp(req)}`, 20, 60 * 60 * 1000);
    const row = resets.get.get(A.sha256(String(body.token || '')));
    if (!row || row.used_at || row.expires_at < Date.now()) {
      throw new HttpError(400, 'reset_invalid', 'This reset link has expired or was already used. Request a new one.');
    }
    const user = A.uq.byId.get(row.user_id);
    if (!user) throw new HttpError(400, 'reset_invalid', 'This reset link is no longer valid.');
    const problem = security.passwordProblem(body.password, { email: user.email, firstName: user.first_name });
    if (problem) throw new HttpError(400, 'validation_failed', problem, { errors: { password: problem } });

    A.uq.setPassword.run(await A.hashPassword(String(body.password)), user.id);
    resets.use.run(Date.now(), user.id);
    A.sq.delAllForUser.run(user.id);
    A.uq.touch.run(user.last_login_at || Date.now(), user.id);   // clears any lockout
    security.audit('password_reset', { userId: user.id, req });
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/v1/auth/logout', (req, res) => {
    const user = A.currentUser(req);
    A.destroySession(req);
    if (user) security.audit('logout', { userId: user.id, req });
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': A.clearCookie() });
  });

  router.get('/api/v1/auth/me', (req, res) => {
    const user = A.currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: { code: 'unauthenticated', message: 'Not signed in' } });
      return;
    }
    sendJson(res, 200, { user: A.publicUser(user), ...plans.usageSummary(user) });
  });

  /**
   * Long-lived token for the browser extension or desktop app. Only issued to a
   * signed-in browser session making a same-origin request.
   */
  router.post('/api/v1/auth/client-token', async (req, res) => {
    const user = A.requireUser(req);
    if ((req.headers.authorization || '').startsWith('Bearer ')) {
      throw new HttpError(403, 'session_required', 'Client tokens can only be issued from a signed-in browser session');
    }
    const body = await readJson(req);
    const kind = body.client === 'desktop' ? 'desktop' : 'extension';
    security.rateLimit(`client-token:${user.id}`, 20, 60 * 60 * 1000);
    const { token, expiresAt } = A.createSession(user.id, req, { kind });
    security.audit('client_token', { userId: user.id, req, detail: kind });
    sendJson(res, 200, { token, expiresAt, user: A.publicUser(user) });
  });

  router.get('/api/v1/auth/google/start', (req, res) => {
    security.rateLimit(`google:${security.clientIp(req)}`, 30, 15 * 60 * 1000);
    const next = parseUrl(req).searchParams.get('next');
    send(res, 302, null, { Location: A.googleAuthUrl(next) });
  });

  router.get('/api/v1/auth/google/callback', async (req, res) => {
    const params = parseUrl(req).searchParams;
    if (params.get('error')) {
      send(res, 302, null, { Location: `/login?error=${encodeURIComponent(String(params.get('error')).slice(0, 40))}` });
      return;
    }
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) throw new HttpError(400, 'missing_code', 'Google sign-in did not complete');

    const { claims, nextUrl } = await A.googleExchange(code, state);
    const user = await A.upsertGoogleUser(claims);
    if (user.totp_enabled) {
      const challenge = A.createChallenge(user.id, nextUrl);
      send(res, 302, null, { Location: `/login?mfa=${encodeURIComponent(challenge)}` });
      return;
    }
    security.audit('login_google', { userId: user.id, req });
    const { token } = A.createSession(user.id, req);
    send(res, 302, null, { Location: A.safeNext(nextUrl), 'Set-Cookie': A.sessionCookie(token) });
  });
}

module.exports = { register };
