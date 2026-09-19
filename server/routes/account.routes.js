'use strict';
const { sendJson, HttpError, readJson } = require('../lib/http');
const A = require('../lib/auth');
const security = require('../lib/security');
const plans = require('../lib/plans');
const { db } = require('../lib/db');
const config = require('../config');

const q = {
  history: db.prepare('SELECT id, kind, target, mode, scam, virus, malware, kinds, created_at FROM scan_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'),
  stats: db.prepare(`SELECT
      SUM(CASE WHEN scam IN ('suspicious','likely','confirmed') OR virus IN ('suspicious','likely','confirmed') OR malware IN ('suspicious','likely','confirmed') THEN 1 ELSE 0 END) AS flagged,
      SUM(CASE WHEN scam IN ('suspicious','likely','confirmed') THEN 1 ELSE 0 END) AS scams,
      SUM(CASE WHEN virus IN ('suspicious','likely','confirmed') THEN 1 ELSE 0 END) AS viruses,
      SUM(CASE WHEN malware IN ('suspicious','likely','confirmed') THEN 1 ELSE 0 END) AS malware,
      COUNT(*) AS total
    FROM scan_history WHERE user_id = ? AND created_at > ?`)
};

async function requireRecentPassword(user, password) {
  if (!user.password_hash) return;
  if (!(await A.verifyPassword(String(password || ''), user.password_hash))) {
    throw new HttpError(401, 'bad_credentials', 'Your current password is incorrect');
  }
}

function register(router) {
  router.get('/api/v1/plans', (req, res) => {
    sendJson(res, 200, { plans: plans.publicPlans(), billingMode: config.billingMode }, { 'Cache-Control': 'public, max-age=300' });
  });

  router.get('/api/v1/account/usage', (req, res) => {
    const user = A.requireUser(req);
    sendJson(res, 200, plans.usageSummary(user));
  });

  router.get('/api/v1/account/history', (req, res) => {
    const user = A.requireUser(req);
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const s = q.stats.get(user.id, since);
    sendJson(res, 200, {
      stats: { total: s.total || 0, flagged: s.flagged || 0, scams: s.scams || 0, viruses: s.viruses || 0, malware: s.malware || 0 },
      items: q.history.all(user.id, 200)
    });
  });

  router.post('/api/v1/account/name', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    const first = String(body.firstName || '').trim();
    const last = String(body.lastName || '').trim();
    if (!first || first.length > 60 || /[<>]/.test(first)) throw new HttpError(400, 'validation_failed', 'Enter a valid first name', { errors: { firstName: 'Enter a valid first name' } });
    if (last.length > 60 || /[<>]/.test(last)) throw new HttpError(400, 'validation_failed', 'Enter a valid last name', { errors: { lastName: 'Enter a valid last name' } });
    A.uq.updateName.run(first, last || null, user.id);
    sendJson(res, 200, { user: A.publicUser(A.uq.byId.get(user.id)) });
  });

  router.post('/api/v1/account/password', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    security.rateLimit(`pwchange:${user.id}`, 10, 60 * 60 * 1000);
    await requireRecentPassword(user, body.currentPassword);
    const problem = security.passwordProblem(body.newPassword, { email: user.email, firstName: user.first_name });
    if (problem) throw new HttpError(400, 'validation_failed', problem, { errors: { newPassword: problem } });

    A.uq.setPassword.run(await A.hashPassword(String(body.newPassword)), user.id);
    A.sq.delAllForUser.run(user.id);              // sign out everywhere else
    security.audit('password_changed', { userId: user.id, req });
    // The replacement session keeps the choice made at sign-in.
    const stay = req._session ? req._session.persistent : false;
    const { token, persistent } = A.createSession(user.id, req, { staySignedIn: stay });
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': A.sessionCookie(token, { persistent }) });
  });

  /* ---------------------------------------------------------------- 2FA */

  router.post('/api/v1/account/2fa/setup', async (req, res) => {
    const user = A.requireUser(req);
    if (user.totp_enabled) throw new HttpError(409, 'already_enabled', 'Two-factor authentication is already on');
    const secret = security.newTotpSecret();
    A.uq.setTotp.run(A.encryptSecret(secret), 0, user.id);
    sendJson(res, 200, { secret, uri: security.totpUri(secret, user.email) });
  });

  router.post('/api/v1/account/2fa/enable', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    security.rateLimit(`2fa-enable:${user.id}`, 10, 15 * 60 * 1000);
    if (!user.totp_secret || user.totp_enabled) throw new HttpError(400, 'no_setup', 'Start two-factor setup first');
    const counter = security.verifyTotp(A.decryptSecret(user.totp_secret), body.code, 0);
    if (counter === null) throw new HttpError(400, 'bad_code', 'That code is not correct - check your authenticator app\'s clock');
    A.uq.setTotp.run(user.totp_secret, 1, user.id);
    A.uq.totpUsed.run(counter, user.id);
    A.sq.delOthers.run(user.id, req._sessionHash || '');
    security.audit('2fa_enabled', { userId: user.id, req });
    sendJson(res, 200, { ok: true, user: A.publicUser(A.uq.byId.get(user.id)) });
  });

  router.post('/api/v1/account/2fa/disable', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    security.rateLimit(`2fa-disable:${user.id}`, 10, 15 * 60 * 1000);
    if (!user.totp_enabled) throw new HttpError(400, 'not_enabled', 'Two-factor authentication is not on');
    const counter = security.verifyTotp(A.decryptSecret(user.totp_secret), body.code, user.totp_last_counter);
    if (counter === null) throw new HttpError(400, 'bad_code', 'That code is not correct');
    A.uq.setTotp.run(null, 0, user.id);
    security.audit('2fa_disabled', { userId: user.id, req });
    sendJson(res, 200, { ok: true, user: A.publicUser(A.uq.byId.get(user.id)) });
  });

  /* ----------------------------------------------------------- sessions */

  router.get('/api/v1/account/sessions', (req, res) => {
    const user = A.requireUser(req);
    const sessions = A.sq.list.all(user.id, Date.now()).map((s) => ({
      // A handle for "sign this one out". It is a hash of the token, never the token.
      id: s.token_hash,
      current: s.token_hash === req._sessionHash,
      staySignedIn: s.persistent !== 0,
      expiresAt: s.expires_at,
      kind: s.kind,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      device: describeAgent(s.user_agent),
      ip: s.ip ? s.ip.replace(/(\d+\.\d+)\.\d+\.\d+$/, '$1.x.x') : null
    }));
    sendJson(res, 200, { sessions });
  });

  /** Sign out exactly one session. Every other session of the account is untouched. */
  router.post('/api/v1/account/sessions/revoke', async (req, res) => {
    const user = A.requireUser(req);
    const { id } = await readJson(req);
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new HttpError(400, 'bad_session', 'Unknown session');
    const removed = A.sq.delOne.run(user.id, id).changes;
    if (!removed) throw new HttpError(404, 'bad_session', 'That session has already ended');
    security.audit('session_revoked', { userId: user.id, req });
    const self = id === req._sessionHash;
    sendJson(res, 200, { ok: true, signedOut: self }, self ? { 'Set-Cookie': A.clearCookie() } : undefined);
  });

  router.post('/api/v1/account/sessions/revoke-others', (req, res) => {
    const user = A.requireUser(req);
    A.sq.delOthers.run(user.id, req._sessionHash || '');
    security.audit('sessions_revoked', { userId: user.id, req });
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/v1/account/delete', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    await requireRecentPassword(user, body.password);
    if (String(body.confirm || '') !== 'DELETE') throw new HttpError(400, 'confirm_required', 'Type DELETE to confirm');
    security.audit('account_deleted', { userId: user.id, req, detail: user.email });
    A.uq.remove.run(user.id);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': A.clearCookie() });
  });

  /* ------------------------------------------------------- age + terms */

  /**
   * Accounts created through Google, or before the current Terms, confirm
   * age and accept the Terms here before using the app. Both must be an
   * explicit true; the timestamps and terms version are what get stored.
   */
  router.post('/api/v1/account/accept-terms', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    const errors = {};
    if (body.ageConfirmed !== true) errors.ageConfirmed = 'You must confirm that you are at least 18 years old';
    if (body.termsAccepted !== true) errors.termsAccepted = 'You must accept the Terms and the Privacy Policy';
    if (Object.keys(errors).length) throw new HttpError(400, 'validation_failed', 'Both confirmations are required', { errors });
    const t = Date.now();
    A.uq.acceptTerms.run(user.age_confirmed_at || t, t, A.TERMS_VERSION, user.id);
    security.audit('terms_accepted', { userId: user.id, req, detail: A.TERMS_VERSION });
    sendJson(res, 200, { user: A.publicUser(A.uq.byId.get(user.id)) });
  });

  /* ------------------------------------------------------------ billing */

  router.post('/api/v1/billing/plan', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    if (config.billingMode !== 'demo') {
      throw new HttpError(501, 'billing_unavailable', 'Upgrades open soon. We will email you the moment Pro, Max and Ultimate are available.');
    }
    plans.setPlan(user.id, String(body.plan || ''));
    security.audit('plan_changed', { userId: user.id, req, detail: body.plan });
    sendJson(res, 200, { user: A.publicUser(A.uq.byId.get(user.id)), ...plans.usageSummary(A.uq.byId.get(user.id)) });
  });
}

function describeAgent(ua = '') {
  const s = String(ua);
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : /Electron|Sentinel/.test(s) ? 'Sentinel app' : 'Browser';
  const os = /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'macOS' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

module.exports = { register };
