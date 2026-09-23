'use strict';
/**
 * Scanning endpoints. Plan rules live here and in plans.js - never in clients.
 *
 *  manual link scan    free: knowledge+checklist+compare, scam only      10/wk
 *                      pro:  + research, + virus & malware               40/wk
 *                      max:  same as pro                                 100/wk
 *  virus/malware scan  free 5/wk (no research) | pro 40 | max 100 (research)
 *  manual email scan   max only, counts as a link scan
 *  live scanning       pro 24h/wk (no research) | max 96h/wk (research)
 *  live email marking  pro + max, uses live hours
 */
const { sendJson, HttpError, readJson, readBody } = require('../lib/http');
const A = require('../lib/auth');
const plans = require('../lib/plans');
const security = require('../lib/security');
const { db, now } = require('../lib/db');
const engine = require('../lib/scan/engine');
const feeds = require('../lib/scan/feeds');
const { analyze, typedUrl } = require('../lib/scan/url');
const { MAX_FILE_BYTES } = require('../lib/scan/filescan');
const { KINDS } = require('../lib/scan/kinds');
// Kinds the engine can name from evidence; "blocked" is a rule the user set, not a threat kind.
const NAMED_KINDS = Object.keys(KINDS).filter((k) => k !== 'blocked').length;
const { ALL_CHECKS } = require('../lib/scan/checklist');

const ALL = ['scam', 'virus', 'malware'];

const REPORT_CATEGORIES = new Set([
  'phishing', 'fake_store', 'crypto_scam', 'tech_support_scam', 'investment_scam',
  'romance_scam', 'malware', 'impersonation', 'other'
]);

const q = {
  insertReport: db.prepare('INSERT INTO reports (id, host, url, user_id, category, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  myReportFor: db.prepare('SELECT 1 FROM reports WHERE host = ? AND user_id = ?'),
  countReports: db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM reports WHERE host = ?'),
  countThreatReports: db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM reports WHERE host = ? AND (CASE WHEN category = 'malware' THEN 'malware' ELSE 'scam' END) = ?"),
  promote: db.prepare(`INSERT INTO blocklist (host, category, source, note, threat, added_at) VALUES (?, ?, 'community', ?, ?, ?)
                       ON CONFLICT(host) DO NOTHING`),
  setOverride: db.prepare(`INSERT INTO overrides (user_id, host, action, created_at) VALUES (?, ?, ?, ?)
                           ON CONFLICT(user_id, host) DO UPDATE SET action = excluded.action, created_at = excluded.created_at`),
  clearOverride: db.prepare('DELETE FROM overrides WHERE user_id = ? AND host = ?'),
  listOverrides: db.prepare('SELECT host, action, created_at FROM overrides WHERE user_id = ? ORDER BY created_at DESC LIMIT 200'),
  intelBlock: db.prepare("SELECT host, threat FROM blocklist WHERE source IN ('sentinel', 'community') ORDER BY host"),
  intelAllow: db.prepare('SELECT host FROM allowlist ORDER BY host'),
  intelStamp: db.prepare('SELECT MAX(added_at) AS t, COUNT(*) AS n FROM blocklist'),
  fileHash: db.prepare('SELECT threat, name FROM file_hashes WHERE sha256 = ?'),
  threatCount: db.prepare('SELECT (SELECT COUNT(*) FROM feed_hosts) + (SELECT COUNT(*) FROM feed_urls) + (SELECT COUNT(*) FROM blocklist) AS n')
};

/** Run a metered scan, refunding the use if it fails on our side. */
async function metered(user, key, fn) {
  const refund = plans.consume(user, key);
  try {
    return await fn();
  } catch (err) {
    if (!err.status || err.status >= 500) refund();
    throw err;
  }
}

function withUsage(user, payload) {
  return { ...payload, usage: plans.usageSummary(A.uq.byId.get(user.id)).usage };
}

function cleanMail(body) {
  const m = body && typeof body.email === 'object' && body.email ? body.email : body;
  return {
    from: String(m.from || '').slice(0, 320),
    fromName: String(m.fromName || '').slice(0, 200),
    fromAddress: String(m.fromAddress || '').slice(0, 320),
    replyTo: String(m.replyTo || '').slice(0, 320),
    subject: String(m.subject || '').slice(0, 500),
    body: String(m.body || '').slice(0, 20000),
    links: (Array.isArray(m.links) ? m.links : []).slice(0, 60).map((l) => ({ href: String((l && l.href) || '').slice(0, 2048), text: String((l && l.text) || '').slice(0, 300) })),
    attachments: (Array.isArray(m.attachments) ? m.attachments : []).slice(0, 30).map((a) => String(a).slice(0, 255)),
    linksTruncated: Array.isArray(m.links) && m.links.length > 60
  };
}

function register(router) {
  /* ---------------------------------------------------- manual link scan */

  router.post('/api/v1/scan/link', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    if (!body.url || typeof body.url !== 'string') throw new HttpError(400, 'missing_url', 'Paste a link to check');
    const url = typedUrl(body.url);
    if (!analyze(url)) throw new HttpError(400, 'bad_url', 'That is not a web address Sentinel can check');

    const plan = plans.planFor(user);
    const verdict = await metered(user, 'linkScans', () => engine.scanUrl(url, {
      userId: user.id,
      planId: plan.id,
      research: plan.features.research,
      threats: plan.features.virusMalwareOnLinks ? ALL : ['scam'],
      mode: 'manual',
      record: true
    }));
    sendJson(res, 200, withUsage(user, { verdict }));
  });

  /* ------------------------------------------ virus & malware scanner (URL) */

  router.post('/api/v1/scan/threat', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    const url = body.url && typedUrl(body.url);
    if (!url || !analyze(url)) throw new HttpError(400, 'bad_url', 'Paste a download link or web address to scan');

    const plan = plans.planFor(user);
    const verdict = await metered(user, 'fileScans', () => engine.scanUrl(url, {
      userId: user.id,
      planId: plan.id,
      research: plan.features.research,
      threats: ['virus', 'malware'],
      mode: 'manual',
      record: true
    }));
    sendJson(res, 200, withUsage(user, { verdict }));
  });

  /* ----------------------------------------- virus & malware scanner (file) */

  router.post('/api/v1/scan/file', async (req, res) => {
    const user = A.requireUser(req);
    // A custom header makes this a non-simple request, so browsers preflight it.
    const rawName = req.headers['x-file-name'];
    if (!rawName) throw new HttpError(400, 'missing_name', 'Missing X-File-Name header');
    let name;
    try { name = decodeURIComponent(String(rawName)).replace(/[\\/\0]/g, '_').slice(0, 255); } catch { throw new HttpError(400, 'bad_name', 'Invalid file name'); }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_FILE_BYTES) throw new HttpError(413, 'file_too_large', 'Files up to 25 MB can be scanned');

    const plan = plans.planFor(user);
    const verdict = await metered(user, 'fileScans', async () => {
      const buf = await readBody(req, MAX_FILE_BYTES);
      if (!buf.length) throw new HttpError(400, 'empty_file', 'That file is empty');
      return engine.scanUpload(buf, name, { userId: user.id, planId: plan.id, record: true });
    });
    sendJson(res, 200, withUsage(user, { verdict }));
  });

  /* ------------------------------------------------- manual email scan (Max) */

  router.post('/api/v1/scan/email', async (req, res) => {
    const user = A.requireUser(req);
    const plan = plans.planFor(user);
    if (!plan.features.emailManual) {
      throw new HttpError(403, 'plan_required', 'Pasting emails in for a scan is part of Sentinel Max.', { needs: 'max', plan: plan.id });
    }
    const mail = cleanMail(await readJson(req, 128 * 1024));
    if (!mail.from && !mail.fromAddress && !mail.body && !mail.subject) throw new HttpError(400, 'empty_email', 'Paste the email you want checked');
    const verdict = await metered(user, 'linkScans', () => engine.scanEmail(mail, { userId: user.id, planId: plan.id, research: true, mode: 'manual', record: true }));
    sendJson(res, 200, withUsage(user, { verdict }));
  });

  /* --------------------------------------------------------- live scanning */

  // Delicate live scanning researches every result, and still has to answer while the person is looking at the
  // results page. Whatever research has not come back inside this budget is left out of that verdict (and is
  // not cached), so the answer is always on time.
  const DELICATE_BUDGET_MS = 4500;

  router.post('/api/v1/live/batch', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    const { plan, mode, fellBack } = plans.trackLive(user, body.mode);
    const urls = Array.isArray(body.urls) ? body.urls.map(String).filter((u) => u.length < 4096).slice(0, 60) : [];
    if (!urls.length) throw new HttpError(400, 'missing_urls', 'Provide urls: string[]');
    security.rateLimit(`live:${user.id}`, 240, 60 * 1000);

    // A private window is protected like any other, and nothing about it is kept: flagged results normally go
    // into the person's history, these do not. Nor are its addresses sent to a registry: it gets the fast checks.
    const isPrivate = body.private === true;
    // `quick`: the first pass of a delicate scan. It is answered from the lists and the checklist alone (a few ms),
    // so marks appear at once; the researched pass follows and refines them. Both count as the same delicate minute.
    const research = mode === 'delicate' && plan.features.liveResearch && !isPrivate && body.quick !== true;
    const started = Date.now();
    const verdicts = await engine.scanUrls(urls, {
      userId: user.id, planId: plan.id, research, budgetMs: DELICATE_BUDGET_MS, threats: ALL, mode: 'live', detail: 'compact', recordFlagged: !isPrivate
    });
    const byUrl = {};
    for (const v of verdicts) byUrl[v.requested] = v;
    sendJson(res, 200, { byUrl, mode, fellBack, researched: research, tookMs: Date.now() - started, live: liveUsage(user, plan) });
  });

  router.post('/api/v1/live/visit', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    const { plan, mode, fellBack } = plans.trackLive(user, body.mode);
    const { url } = body;
    if (!url || !analyze(String(url))) throw new HttpError(400, 'bad_url', 'Not a web address');
    security.rateLimit(`visit:${user.id}`, 120, 60 * 1000);
    const research = mode === 'delicate' && plan.features.liveResearch && body.private !== true;
    const verdict = await engine.scanUrl(String(url), {
      userId: user.id, planId: plan.id, research, budgetMs: DELICATE_BUDGET_MS, threats: ALL, mode: 'live', detail: 'compact'
    });
    sendJson(res, 200, { verdict, mode, fellBack, live: liveUsage(user, plan) });
  });

  router.post('/api/v1/live/email', async (req, res) => {
    const user = A.requireUser(req);
    const { plan } = plans.trackLive(user);
    if (!plan.features.emailLive) throw new HttpError(403, 'plan_required', 'Email protection is part of Sentinel Pro, Max and Ultimate.', { needs: 'pro' });
    security.rateLimit(`live-email:${user.id}`, 120, 60 * 1000);
    const body = await readJson(req, 512 * 1024);
    const list = Array.isArray(body.emails) ? body.emails.slice(0, 50) : [body];
    const results = [];
    for (const item of list) {
      const mail = cleanMail(item);
      const verdict = await engine.scanEmail(mail, { userId: user.id, planId: plan.id, research: false, mode: 'live', detail: 'compact' });
      results.push({ key: String((item && item.key) || '').slice(0, 200), verdict });
    }
    sendJson(res, 200, { results, live: liveUsage(user, plan) });
  });

  /** Desktop download protection: is this file hash a known threat? (Pro/Max, not metered) */
  router.post('/api/v1/live/file-hash', async (req, res) => {
    const user = A.requireUser(req);
    const plan = plans.planFor(user);
    if (!plan.features.liveScanning) throw new HttpError(403, 'plan_required', 'Download protection is part of Sentinel Pro, Max and Ultimate.', { needs: 'pro' });
    security.rateLimit(`file-hash:${user.id}`, 300, 60 * 60 * 1000);
    const { sha256 } = await readJson(req);
    if (!/^[a-f0-9]{64}$/i.test(String(sha256 || ''))) throw new HttpError(400, 'bad_hash', 'Provide a SHA-256 hex digest');
    const row = q.fileHash.get(String(sha256).toLowerCase());
    sendJson(res, 200, { known: Boolean(row), threat: row ? row.threat : null, name: row ? row.name : null });
  });

  /* ------------------------------------------------ reports and overrides */

  router.post('/api/v1/report', async (req, res) => {
    const user = A.requireUser(req);
    security.rateLimit(`report:${user.id}`, 30, 60 * 60 * 1000);
    const body = await readJson(req);
    const parsed = analyze(String(body.url || ''));
    if (!parsed) throw new HttpError(400, 'bad_url', 'That does not look like a web address');

    const category = REPORT_CATEGORIES.has(body.category) ? body.category : 'other';
    const host = parsed.registrable;
    if (q.myReportFor.get(host, user.id)) throw new HttpError(409, 'already_reported', 'You have already reported this site. Thank you!');

    q.insertReport.run(A.id('rpt'), host, parsed.url.slice(0, 2048), user.id, category, String(body.note || '').slice(0, 500) || null, now());
    // Reports from distinct accounts only - one person cannot condemn a site alone.
    const total = q.countReports.get(host).n;
    const threat = category === 'malware' ? 'malware' : 'scam';
    const agreeing = q.countThreatReports.get(host, threat).n;
    if (agreeing >= 3) q.promote.run(host, category, `Promoted after ${agreeing} ${threat} reports`, threat, now());
    engine.invalidate(host);
    security.audit('report', { userId: user.id, req, detail: host });
    sendJson(res, 201, { ok: true, host, reports: total, promoted: agreeing >= 3 });
  });

  router.post('/api/v1/sites/override', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    const parsed = analyze(String(body.url || body.host || ''));
    if (!parsed) throw new HttpError(400, 'bad_url', 'That does not look like a web address');
    if (body.action === 'clear') q.clearOverride.run(user.id, parsed.registrable);
    else if (body.action === 'allow' || body.action === 'block') q.setOverride.run(user.id, parsed.registrable, body.action, now());
    else throw new HttpError(400, 'bad_action', 'action must be allow, block or clear');
    sendJson(res, 200, { ok: true, host: parsed.registrable, action: body.action });
  });

  router.get('/api/v1/sites/overrides', (req, res) => {
    const user = A.requireUser(req);
    sendJson(res, 200, { overrides: q.listOverrides.all(user.id) });
  });

  /* ----------------------------------------------------------- public data */

  /** Confirmed hosts the extension can flag instantly, before any request. */
  router.get('/api/v1/intel', (req, res) => {
    const stamp = q.intelStamp.get();
    sendJson(res, 200, {
      version: `${stamp.n}-${stamp.t || 0}`,
      blocklist: q.intelBlock.all(),
      allowlist: q.intelAllow.all().map((r) => r.host)
    }, { 'Cache-Control': 'public, max-age=300' });
  });

  router.get('/api/v1/threat-stats', (req, res) => {
    sendJson(res, 200, {
      trackedThreats: q.threatCount.get().n,
      checks: ALL_CHECKS.length,
      kinds: NAMED_KINDS,
      feeds: feeds.status().map((f) => ({ source: f.source, entries: f.entries, ok: Boolean(f.ok), fetchedAt: f.fetched_at }))
    }, { 'Cache-Control': 'public, max-age=600' });
  });
}

function liveUsage(user, plan) {
  return {
    usedMinutes: plans.liveMinutesUsed(user.id), limitMinutes: plan.limits.liveMinutes,
    fast: { usedMinutes: plans.fastMinutesUsed(user.id), limitMinutes: plan.limits.fastMinutes },
    resetsAt: plans.weekResetsAt()
  };
}

module.exports = { register };
