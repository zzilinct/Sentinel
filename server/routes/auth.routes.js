'use strict';
const { sendJson, send, HttpError, readJson, parseUrl } = require('../lib/http');
const A = require('../lib/auth');
const security = require('../lib/security');
const plans = require('../lib/plans');
const config = require('../config');

function register(router) {
  router.get('/api/v1/auth/config', (req, res) => {
    sendJson(res, 200, {
      googleEnabled: config.google.enabled,
      billingMode: config.billingMode,
      origin: config.publicOrigin,
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
    sendJson(res, 201, { user: A.publicUser(user) }, { 'Set-Cookie': A.sessionCookie(token) });
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
