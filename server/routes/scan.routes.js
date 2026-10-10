'use strict';
/**
 * Scanning endpoints. Plan rules live here and in plans.js - never in clients.
 *
 *  manual link scan    free: knowledge+checklist+compare, scam only      10/wk
 *                      pro:  + research, + virus & malware               40/wk
 *                      max:  same as pro                                 100/wk
 *  virus/malware scan  free 5/wk (no research) | pro 40 | max 100 (research)
 *  manual email scan   max only, researched: counts as a delicate scan
 *  text message scan   every plan, links checked by address only: counts as a fast link scan
 *  live scanning       pro 24h/wk (no research) | max 96h/wk (research)
 *  live email marking  pro + max, uses live hours
 */
const { sendJson, HttpError, readJson, readBody } = require('../lib/http');
const A = require('../lib/auth');
const plans = require('../lib/plans');
const security = require('../lib/security');
const { db, now } = require('../lib/db');
const engine = require('../lib/scan/engine');
const exposure = require('../lib/scan/exposure');
const mySites = require('../lib/scan/mysites');
const { payCheck } = require('../lib/scan/paycheck');
const feeds = require('../lib/scan/feeds');
const { analyze, typedUrl } = require('../lib/scan/url');
const { MAX_FILE_BYTES } = require('../lib/scan/filescan');
const { KINDS } = require('../lib/scan/kinds');
const { classify: classifyQr } = require('../lib/scan/qr');
const texts = require('../lib/scan/texts');
const week = require('../lib/week');
// Kinds the engine can name from evidence; "blocked" is a rule the user set, not a threat kind.
const NAMED_KINDS = Object.keys(KINDS).filter((k) => k !== 'blocked').length;
const { ALL_CHECKS } = require('../lib/scan/checklist');

const ALL = ['scam', 'virus', 'malware'];
/** Asked from this same computer (the Windows app and its own server). */
const local = (req) => /^(127\.|::1$)/.test(String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''));
const UNMETERED = new Set(['texts', 'checkup', 'clipboard', 'download']);

/** Your week (week.js): how many links live scanning checked, how many were dangerous, how many copied your sites. */
const lookalike = (v) => Boolean(v && v.ok && v.checklist && v.checklist.items.some((c) => c.id === 'Y01'));
const dangerous = (v) => Boolean(v && v.ok && (v.overall.badge === 'red' || v.overall.badge === 'orange'));
function countLive(userId, verdicts) {
  week.bump(userId, 'live_links', verdicts.filter((v) => v && v.ok).length);
  week.bump(userId, 'live_flagged', verdicts.filter(dangerous).length);
  week.bump(userId, 'lookalikes', verdicts.filter(lookalike).length);
}

const REPORT_CATEGORIES = new Set([
  'phishing', 'fake_store', 'crypto_scam', 'tech_support_scam', 'investment_scam',
  'romance_scam', 'malware', 'impersonation', 'other'
]);

const REPORTER_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const q = {
  insertReport: db.prepare('INSERT INTO reports (id, host, url, user_id, category, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  myReportFor: db.prepare('SELECT 1 FROM reports WHERE host = ? AND user_id = ?'),
  countReports: db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM reports WHERE host = ?'),
  // Only accounts that confirmed their email and are at least a week old count toward condemning a site for everyone:
  // three accounts made in a minute must not be able to paint a competitor red.
  countThreatReports: db.prepare(`SELECT COUNT(DISTINCT r.user_id) AS n FROM reports r JOIN users u ON u.id = r.user_id
    WHERE r.host = ? AND (CASE WHEN r.category = 'malware' THEN 'malware' ELSE 'scam' END) = ?
      AND u.email_verified_at IS NOT NULL AND u.created_at <= ?`),
  allowlisted: db.prepare('SELECT 1 FROM allowlist WHERE host = ?'),
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
    // No result, no charge: a file too large or empty is refused without using up one of the week's scans.
    refund();
    throw err;
  }
}

function withUsage(user, payload) {
  return { ...payload, usage: plans.usageSummary(A.uq.byId.get(user.id)).usage };
}

function cleanMail(body) {
  const m = (body && typeof body.email === 'object' && body.email) || body || {};
  return {
    from: String(m.from || '').slice(0, 320),
    fromName: String(m.fromName || '').slice(0, 200),
    fromAddress: String(m.fromAddress || '').slice(0, 320),
    replyTo: String(m.replyTo || '').slice(0, 320),
    subject: String(m.subject || '').slice(0, 500),
    body: String(m.body || '').slice(0, 20000),
    links: (Array.isArray(m.links) ? m.links : []).slice(0, 60).map((l) => ({ href: String((l && l.href) || '').slice(0, 2048), text: String((l && l.text) || '').slice(0, 300) })),
    attachments: (Array.isArray(m.attachments) ? m.attachments : []).slice(0, 30).map((a) => String(a).slice(0, 255)),
    // What QR codes in a screenshot of the email hold, read on the person's device. Never the picture.
    qr: (Array.isArray(m.qr) ? m.qr : []).slice(0, 5).map((t) => String(t || '').slice(0, 4096)).filter(Boolean),
    linksTruncated: Array.isArray(m.links) && m.links.length > 60
  };
}

function register(router) {
  /* ---------------------------------------------------- manual link scan */

  router.post('/api/v1/scan/link', async (req, res) => {
    const user = A.requireAgreedUser(req);
    security.rateLimit(`scan-minute:${user.id}`, 30, 60 * 1000, 'Too many scans in a minute. Wait a moment, then try again.');
    const body = await readJson(req);
    if (!body.url || typeof body.url !== 'string') throw new HttpError(400, 'missing_url', 'Paste a link to check');
    const url = typedUrl(body.url);
    if (!analyze(url)) throw new HttpError(400, 'bad_url', 'That is not a web address Sentinel can check');

    const plan = plans.planFor(user);
    // Fast: threat lists, the checklist and comparison. Delicate: all that, and the site researched too. Asked for by
    // the person; a client that does not ask gets the best its plan has, as before there were two.
    const scanMode = body.mode === 'fast' || body.mode === 'delicate' ? body.mode : (plan.features.research ? 'delicate' : 'fast');
    const verdict = await metered(user, scanMode === 'delicate' ? 'deepScans' : 'linkScans', () => engine.scanUrl(url, {
      userId: user.id,
      planId: plan.id,
      research: scanMode === 'delicate' && plan.features.research,
      threats: plan.features.virusMalwareOnLinks ? ALL : ['scam'],
      mode: 'manual',
      record: true
    }));
    if (lookalike(verdict)) week.bump(user.id, 'lookalikes');
    sendJson(res, 200, withUsage(user, { verdict, scanMode }));
  });

  /* ------------------------------------------------------------ QR codes */

  // What a QR code holds, read from a picture on the person's own device: only the text arrives, never the picture.
  // Saying what a code does is not a scan and uses none of the week's scans; a link in it then goes through
  // /scan/link like any pasted link.
  router.post('/api/v1/scan/qr', async (req, res) => {
    const user = A.requireAgreedUser(req);
    security.rateLimit(`scan-minute:${user.id}`, 30, 60 * 1000, 'Too many scans in a minute. Wait a moment, then try again.');
    const body = await readJson(req, 16 * 1024);
    if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'missing_text', 'No QR code was read');
    sendJson(res, 200, { qr: classifyQr(body.text.slice(0, 4096)) });
  });

  /* ------------------------------------------ virus & malware scanner (URL) */

  router.post('/api/v1/scan/threat', async (req, res) => {
    const user = A.requireAgreedUser(req);
    security.rateLimit(`scan-minute:${user.id}`, 30, 60 * 1000, 'Too many scans in a minute. Wait a moment, then try again.');
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
    const user = A.requireAgreedUser(req);
    security.rateLimit(`scan-minute:${user.id}`, 30, 60 * 1000, 'Too many scans in a minute. Wait a moment, then try again.');
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
    const user = A.requireAgreedUser(req);
    security.rateLimit(`scan-minute:${user.id}`, 30, 60 * 1000, 'Too many scans in a minute. Wait a moment, then try again.');
    const plan = plans.planFor(user);
    if (!plan.features.emailManual) {
      throw new HttpError(403, 'plan_required', 'Pasting emails in for a scan is part of Sentinel Max.', { needs: 'max', plan: plan.id });
    }
    const mail = cleanMail(await readJson(req, 128 * 1024));
    if (!mail.from && !mail.fromAddress && !mail.body && !mail.subject && !mail.qr.length) throw new HttpError(400, 'empty_email', 'Paste the email you want checked');
    // A pasted email is researched (its links and sender): a delicate scan.
    const verdict = await metered(user, 'deepScans', () => engine.scanEmail(mail, { userId: user.id, planId: plan.id, research: true, mode: 'manual', record: true }));
    sendJson(res, 200, withUsage(user, { verdict }));
  });

  /* ---------------------------------------------------- text message scan */

  // A text (SMS, WhatsApp, a DM), pasted in or read from a phone screenshot on the person's device. Judged by the same
  // rules as texts in Phone Link (scan/texts.js); its links are checked by their address only, never opened. Like a
  // pasted email it is counted by the checks it gets: an email is researched (a delicate scan), a text is not, so it
  // is one fast link scan, on every plan. The message is read in memory: not stored, not in the history, not logged.
  router.post('/api/v1/scan/text', async (req, res) => {
    const user = A.requireAgreedUser(req);
    security.rateLimit(`scan-minute:${user.id}`, 30, 60 * 1000, 'Too many scans in a minute. Wait a moment, then try again.');
    const body = await readJson(req, 16 * 1024);
    const text = String(body.text || '').slice(0, 2000);
    const from = String(body.from || '').slice(0, 80);
    if (!text.trim()) throw new HttpError(400, 'empty_text', 'Paste the text message you want checked');
    const plan = plans.planFor(user);
    const result = await metered(user, 'linkScans', async () => {
      const r = texts.judgeText({ from, text });
      const verdicts = r.links.length ? await engine.scanUrls(r.links, {
        userId: user.id, planId: plan.id, research: false, threats: plan.features.virusMalwareOnLinks ? ALL : ['scam'], mode: 'manual', detail: 'compact', recordFlagged: false
      }) : [];
      const byUrl = {};
      for (const v of verdicts) byUrl[v.requested] = v;
      return {
        flag: texts.withLinks(r, byUrl),
        sender: texts.senderKind(from),
        links: r.links.map((url) => {
          const v = byUrl[url];
          const ok = v && v.ok;
          return { url, host: ok ? v.host : null, badge: ok ? v.overall.badge : null, label: ok ? v.overall.label : 'Not checked', reason: ok && v.reasons[0] ? v.reasons[0].text : null };
        })
      };
    });
    sendJson(res, 200, withUsage(user, { text: result }));
  });

  /* --------------------------------------------------------- live scanning */

  // Delicate live scanning researches every result, and still has to answer while the person is looking at the
  // results page. Whatever research has not come back inside this budget is left out of that verdict (and is
  // not cached), so the answer is always on time.
  const DELICATE_BUDGET_MS = 4500;

  router.post('/api/v1/live/batch', async (req, res) => {
    const user = A.requireAgreedUser(req);
    const body = await readJson(req);
    const urls = Array.isArray(body.urls) ? body.urls.map(String).filter((u) => u.length < 4096).slice(0, 60) : [];
    if (!urls.length) throw new HttpError(400, 'missing_urls', 'Provide urls: string[]');
    // Links found by the Windows app outside the browser (a text in Phone Link, the browser checkup, a copied link, the site a download came from)
    // are not browsing: they get the fast, private check against the lists and never spend live-scanning minutes.
    // Only the Windows app's own scanner, on the same computer, may ask this way: anywhere else it would be a way
    // around the live-scanning meter.
    if (UNMETERED.has(body.purpose) && local(req)) {
      security.rateLimit(`links:${user.id}`, 30, 60 * 1000, 'Too many links to check in a minute. Wait a moment, then try again.');
      const plan = plans.planFor(user);
      const verdicts = await engine.scanUrls(urls, { userId: user.id, planId: plan.id, research: false, threats: ALL, mode: 'live', detail: 'compact', recordFlagged: false });
      const byUrl = {};
      for (const v of verdicts) byUrl[v.requested] = v;
      sendJson(res, 200, { byUrl, mode: 'fast', fellBack: null, researched: false, live: liveUsage(user, plan) });
      return;
    }
    security.rateLimit(`live:${user.id}`, 240, 60 * 1000);
    // Only a request that will be answered counts as a minute of live scanning.
    const { plan, mode, fellBack } = plans.trackLive(user, body.mode);

    // A private window is protected like any other, and nothing about it is kept: flagged results normally go
    // into the person's history, these do not. Nor are its addresses sent to a registry: it gets the fast checks.
    const isPrivate = body.private === true;
    // `quick`: the first pass of a delicate scan. It is answered from the lists and the checklist alone (a few ms),
    // so marks appear at once; the researched pass follows and refines them. Both count as the same delicate minute.
    const research = mode === 'delicate' && plan.features.liveResearch && !isPrivate && body.quick !== true;
    const started = Date.now();
    // What the results page showed for each address (its title, the search): read, never kept, never for a private window.
    const hints = {};
    if (!isPrivate && body.hints && typeof body.hints === 'object') {
      for (const u of urls) {
        const h = Object.prototype.hasOwnProperty.call(body.hints, u) ? body.hints[u] : null;
        if (h && typeof h === 'object') hints[u] = { title: String(h.title || '').slice(0, 200), query: String(h.query || '').slice(0, 200) };
      }
    }
    const verdicts = await engine.scanUrls(urls, {
      userId: user.id, planId: plan.id, research, budgetMs: DELICATE_BUDGET_MS, threats: ALL, mode: 'live', detail: 'compact', recordFlagged: !isPrivate, hints
    });
    // Counted once per link: a delicate scan's quick first pass is followed by the researched one. Never a private window.
    if (!isPrivate && body.quick !== true) countLive(user.id, verdicts);
    const byUrl = {};
    for (const v of verdicts) byUrl[v.requested] = v;
    sendJson(res, 200, { byUrl, mode, fellBack, researched: research, tookMs: Date.now() - started, live: liveUsage(user, plan) });
  });

  router.post('/api/v1/live/visit', async (req, res) => {
    const user = A.requireAgreedUser(req);
    const body = await readJson(req);
    const { url } = body;
    if (!url || !analyze(String(url))) throw new HttpError(400, 'bad_url', 'Not a web address');
    security.rateLimit(`visit:${user.id}`, 120, 60 * 1000);
    const { plan, mode, fellBack } = plans.trackLive(user, body.mode);
    const research = mode === 'delicate' && plan.features.liveResearch && body.private !== true;
    const verdict = await engine.scanUrl(String(url), {
      userId: user.id, planId: plan.id, research, budgetMs: DELICATE_BUDGET_MS, threats: ALL, mode: 'live', detail: 'compact'
    });
    // Exposure alerts, when the person switched them on: a page that was not a likely or confirmed threat is
    // remembered as a keyed hash for 14 days, in case a list names it later. Never a page in a private window.
    const badge = verdict && verdict.overall && verdict.overall.badge;
    if (body.private !== true) countLive(user.id, [verdict]);
    if (body.remember === true && body.private !== true && badge !== 'red' && badge !== 'orange') {
      try { exposure.remember(user.id, String(url), now(), Number(body.tz)); } catch { /* best effort, like history */ }
    }
    // Your sites, while that is on: a clean page counts towards learning its site (mysites.js). Never a private window.
    if (body.learn === true && body.private !== true && !badge && local(req)) {
      try { mySites.seen(user.id, String(url), now(), Number(body.tz)); } catch { /* best effort */ }
    }
    // Before you pay: at a shop's checkout, a calm word when the shop's address is young or its age unknown. Uses only
    // what is already known (a delicate scan's lookup above, or an earlier one); nothing is looked up for it.
    const pay = payCheck(String(url), {
      verdict, checkout: body.checkout === true,
      mine: () => local(req) && mySites.list(user.id).some((s) => s.host === mySites.siteOf(String(url)))
    });
    sendJson(res, 200, { verdict, mode, fellBack, live: liveUsage(user, plan), ...(pay ? { pay } : {}) });
  });

  /* ------------------------------------------------- exposure alerts */

  // Sites this account visited that a threat list named afterwards (scan/exposure.js), with what to do about each.
  router.get('/api/v1/live/exposures', (req, res) => {
    const user = A.requireAgreedUser(req);
    sendJson(res, 200, { items: exposure.list(user.id) });
  });

  router.post('/api/v1/live/exposures/notified', async (req, res) => {
    const user = A.requireAgreedUser(req);
    const body = await readJson(req);
    const hosts = (Array.isArray(body.hosts) ? body.hosts : []).slice(0, 50).map((h) => String(h).slice(0, 253));
    sendJson(res, 200, { ok: true, marked: exposure.markNotified(user.id, hosts) });
  });

  router.post('/api/v1/live/exposures/dismiss', async (req, res) => {
    const user = A.requireAgreedUser(req);
    const body = await readJson(req);
    sendJson(res, 200, { ok: exposure.dismiss(user.id, String(body.host || '').slice(0, 253)) });
  });

  // Switched off: every remembered visit goes at once.
  router.post('/api/v1/live/exposures/forget', async (req, res) => {
    const user = A.requireAgreedUser(req);
    await readJson(req);
    sendJson(res, 200, { ok: true, forgotten: exposure.forget(user.id) });
  });

  /* ------------------------------------------------------- your sites */

  // The sites this person uses, for look-alike checks (scan/mysites.js). Kept only by the app's own server on the
  // person's computer: asked from anywhere else, there is nothing to show and nothing is kept.
  router.get('/api/v1/my-sites', (req, res) => {
    const user = A.requireAgreedUser(req);
    sendJson(res, 200, { items: local(req) ? mySites.list(user.id) : [], learnDays: mySites.LEARN_DAYS });
  });

  router.post('/api/v1/my-sites/add', async (req, res) => {
    const user = A.requireAgreedUser(req);
    const body = await readJson(req);
    if (!local(req)) throw new HttpError(403, 'local_only', 'Your sites are kept by Sentinel on your own computer.');
    const site = mySites.add(user.id, String(body.host || '').slice(0, 300));
    if (!site) throw new HttpError(400, 'bad_site', 'That does not look like a web address. Try one like mycu.org.');
    sendJson(res, 200, { ok: true, host: site, items: mySites.list(user.id) });
  });

  router.post('/api/v1/my-sites/remove', async (req, res) => {
    const user = A.requireAgreedUser(req);
    const body = await readJson(req);
    mySites.remove(user.id, String(body.host || '').slice(0, 300));
    sendJson(res, 200, { ok: true, items: mySites.list(user.id) });
  });

  router.post('/api/v1/my-sites/forget', async (req, res) => {
    const user = A.requireAgreedUser(req);
    await readJson(req);
    sendJson(res, 200, { ok: true, forgotten: mySites.forget(user.id) });
  });

  router.post('/api/v1/live/email', async (req, res) => {
    const user = A.requireAgreedUser(req);
    if (!plans.planFor(user).features.emailLive) throw new HttpError(403, 'plan_required', 'Email protection is part of Sentinel Pro, Max and Ultimate.', { needs: 'pro' });
    security.rateLimit(`live-email:${user.id}`, 120, 60 * 1000);
    const body = await readJson(req, 512 * 1024);
    // Inbox rows get the quick checks (no research), so they count against fast time, never delicate hours.
    const { plan } = plans.trackLive(user, 'fast');
    const list = Array.isArray(body.emails) ? body.emails.slice(0, 50) : [body];
    const results = [];
    for (const item of list) {
      const mail = cleanMail(item);
      // An inbox row is a preview (sender name, subject, a line of text): no address, no links. Desktop clients say
      // so; anything that sends a whole message is checked as one.
      const verdict = await engine.scanEmail(mail, { userId: user.id, planId: plan.id, research: false, mode: 'live', detail: 'compact', preview: body.preview === true || (item && item.preview === true) });
      results.push({ key: String((item && item.key) || '').slice(0, 200), verdict });
    }
    sendJson(res, 200, { results, live: liveUsage(user, plan) });
  });

  /** Desktop download protection: is this file hash a known threat? (Pro/Max, not metered) */
  router.post('/api/v1/live/file-hash', async (req, res) => {
    const user = A.requireAgreedUser(req);
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
    const user = A.requireAgreedUser(req);
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
    const agreeing = q.countThreatReports.get(host, threat, now() - REPORTER_MIN_AGE_MS).n;
    // A well-known site is never condemned by reports alone.
    const promoted = agreeing >= 3 && !q.allowlisted.get(host);
    if (promoted) q.promote.run(host, category, `Promoted after ${agreeing} ${threat} reports`, threat, now());
    engine.invalidate(host);
    security.audit('report', { userId: user.id, req, detail: host });
    sendJson(res, 201, { ok: true, host, reports: total, promoted });
  });

  router.post('/api/v1/sites/override', async (req, res) => {
    const user = A.requireAgreedUser(req);
    const body = await readJson(req);
    const parsed = analyze(String(body.url || body.host || ''));
    if (!parsed) throw new HttpError(400, 'bad_url', 'That does not look like a web address');
    if (body.action === 'clear') q.clearOverride.run(user.id, parsed.registrable);
    else if (body.action === 'allow' || body.action === 'block') q.setOverride.run(user.id, parsed.registrable, body.action, now());
    else throw new HttpError(400, 'bad_action', 'action must be allow, block or clear');
    sendJson(res, 200, { ok: true, host: parsed.registrable, action: body.action });
  });

  router.get('/api/v1/sites/overrides', (req, res) => {
    const user = A.requireAgreedUser(req);
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
