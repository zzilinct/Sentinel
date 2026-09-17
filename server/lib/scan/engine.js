'use strict';
/**
 * Sentinel scan pipeline.
 *
 *   1. Knowledge   - is this site already known (threat DB, public feeds, reports, Safe Browsing)?
 *                    No record anywhere lowers the final risk.
 *   2. Checklist   - dozens of individual address checks.
 *   3. Compare     - does it resemble known scams (name patterns, page kits, copied pages)?
 *   4. Research    - Pro/Max: registration, DNS, certificate, redirects, page content, downloads.
 *
 * Three independent threats come out, each with its own mask:
 *   scam, virus, malware  ->  none | yellow (suspicious) | orange (likely) | red (confirmed)
 *
 * Red is reserved for evidence: a knowledge-base match, a strong match to a
 * known scam kit on an impersonating page, a known malicious file, or
 * unambiguous hostile behaviour. Heuristics alone top out at orange.
 */
const { db, now } = require('../db');
const knowledge = require('./knowledge');
const compare = require('./compare');
const researchMod = require('./research');
const { runChecklist } = require('./checklist');
const { analyze, brandInfo, hostWords } = require('./url');
const kinds = require('./kinds');
const { scanFile, MAX_FILE_BYTES } = require('./filescan');
const { analyzeEmail } = require('./email');

const THREATS = ['scam', 'virus', 'malware'];
const DISCOUNT = { scam: 0.8, virus: 0.85, malware: 0.85 };
const BADGE = { safe: null, caution: null, suspicious: 'yellow', likely: 'orange', confirmed: 'red' };
const LABELS = {
  scam: { safe: 'No scam signs', caution: 'Nothing conclusive', suspicious: 'Suspicious', likely: 'Likely scam', confirmed: 'Confirmed scam' },
  virus: { safe: 'No virus signs', caution: 'Nothing conclusive', suspicious: 'Possible virus', likely: 'Likely virus', confirmed: 'Virus detected' },
  malware: { safe: 'No malware signs', caution: 'Nothing conclusive', suspicious: 'Possible malware', likely: 'Likely malware', confirmed: 'Malware detected' }
};
const SEVERITY = { safe: 0, caution: 1, suspicious: 2, likely: 3, confirmed: 4 };

const q = {
  override: db.prepare('SELECT action FROM overrides WHERE user_id = ? AND (host = ? OR host = ?)'),
  history: db.prepare('INSERT INTO scan_history (user_id, kind, target, mode, scam, virus, malware, created_at, kinds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
};

/* ----------------------------------------------------------- core cache */

// Plan-independent results, shared by every user for a few minutes. Per-user
// overrides and threat visibility are applied on the way out.
const CORE_TTL = 10 * 60 * 1000;
const coreCache = new Map();
const coreInflight = new Map();

function cacheGet(key) {
  const hit = coreCache.get(key);
  if (!hit) return null;
  if (now() - hit.at > CORE_TTL) { coreCache.delete(key); return null; }
  coreCache.delete(key);          // refresh LRU position
  coreCache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  coreCache.set(key, { value, at: now() });
  if (coreCache.size > 5000) coreCache.delete(coreCache.keys().next().value);
}

function invalidate(host) {
  for (const key of coreCache.keys()) if (key.includes(`//${host}`) || key.includes(`.${host}`)) coreCache.delete(key);
}

/* -------------------------------------------------------------- scoring */

function levelFor(score, evidence) {
  if (evidence) return 'confirmed';
  if (score >= 55) return 'likely';
  if (score >= 30) return 'suspicious';
  if (score >= 15) return 'caution';
  return 'safe';
}

function score(checks, know, evidence) {
  const totals = { scam: 0, virus: 0, malware: 0 };
  for (const c of checks) {
    if (c.status === 'skip') continue;
    totals[c.threat] += c.points;
    if (c.extra) for (const [t, pts] of Object.entries(c.extra)) totals[t] += pts;
  }

  const unknown = !know.known && !know.matches.length;
  const threats = {};
  for (const t of THREATS) {
    let s = totals[t];
    if (unknown && s > 0) s *= DISCOUNT[t];
    s = Math.max(0, Math.min(100, Math.round(s)));
    if (evidence[t]) s = Math.max(s, 90);
    const level = levelFor(s, evidence[t]);
    threats[t] = { level, badge: BADGE[level], label: LABELS[t][level], score: s, evidence: evidence[t] || null };
  }
  return { threats, discountApplied: unknown };
}

function evidenceFrom(checks, know, ctx) {
  const ev = { scam: null, virus: null, malware: null };
  for (const m of know.matches) {
    if (m.strength === 'confirmed' && !ev[m.threat]) ev[m.threat] = `${m.sourceName}: ${m.category.replace(/_/g, ' ')}`;
  }
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  const failed = (id) => byId[id] && byId[id].status === 'fail';

  if (failed('R11') && ctx.finalKnowledge) {
    const m = ctx.finalKnowledge.matches.find((x) => x.strength === 'confirmed');
    if (m && !ev[m.threat]) ev[m.threat] = `Redirects to a known ${m.threat} site`;
  }

  // A known scam kit on a page that impersonates a brand or collects credentials.
  const impersonating = ctx.brand.inDomain || ctx.brand.inSubdomain || ctx.brand.lookalike || failed('P01') || failed('P02') || failed('P03') || failed('P06');
  if (failed('C03') && byId.C03.points >= 55 && impersonating && !ev.scam) ev.scam = 'Matches a known scam kit on an impersonating page';
  if (failed('C05') && !ev.scam) ev.scam = 'Copy of a page already confirmed as a scam';
  if (failed('P06') && (impersonating || failed('C03')) && !ev.scam) ev.scam = 'Asks for a wallet recovery phrase while posing as a wallet';

  if (failed('P17') && byId.P17.points >= 60 && !ev.malware) ev.malware = 'Tells visitors to paste and run a hidden command';
  if ((failed('P14') || failed('U35')) && !ev.malware) ev.malware = 'Runs a hidden cryptocurrency miner';
  if (failed('C04') && byId.C04.points >= 55 && !ev.malware) ev.malware = 'Matches a known malware lure page';
  return ev;
}

/* ------------------------------------------------------------- pipeline */

/** Everything that doesn't depend on who is asking. */
async function coreScan(p, { research }) {
  const key = `${research ? 'r' : 'q'}|${p.url}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  if (coreInflight.has(key)) return coreInflight.get(key);

  const job = (async () => {
    const know = await knowledge.lookup(p);
    const brand = brandInfo(p);
    const ctx = {
      p,
      brand,
      words: hostWords(p.host),
      knowledge: know,
      compare: compare.compareDomain(p),
      contentCompare: { kits: [], similarPages: [], fingerprint: null },
      research: null,
      researchSkipReason: research ? null : 'Research is included with Pro, Max and Ultimate scans',
      finalKnowledge: null
    };

    let fileReport = null;
    if (research && !know.trusted) {
      ctx.research = await researchMod.research(p);
      const http = ctx.research.http;
      if (http.ok && http.page) {
        ctx.contentCompare = compare.compareContent(http.page.text, http.page.htmlLower, p.host);
      }
      if (http.ok && http.finalUrl) {
        const final = analyze(http.finalUrl);
        if (final && final.registrable !== p.registrable) ctx.finalKnowledge = await knowledge.lookup(final);
      }
      if (http.ok && http.download && http.download.length && http.download.length <= MAX_FILE_BYTES) {
        const name = (/filename\*?=(?:utf-8'')?"?([^";]+)/i.exec(http.disposition || '') || [])[1] || p.file || 'download';
        fileReport = scanFile(http.download, name);
      }
    }

    let checks = know.trusted ? trustedChecks(ctx) : runChecklist(ctx);
    if (fileReport) checks = checks.concat(fileReport.checks.map((c) => ({ ...c, id: `D-${c.id}`, group: 'Downloaded file', research: true })));

    const evidence = evidenceFrom(checks, know, ctx);
    if (fileReport) for (const t of ['virus', 'malware']) if (fileReport.evidence[t] && !evidence[t]) evidence[t] = fileReport.evidence[t];

    const { threats, discountApplied } = score(checks, know, evidence);
    // What sort of threat the evidence points at, for the label and the icon.
    const kindOf = kinds.classify({ checks, know, comparison: { kits: ctx.contentCompare.kits }, threats });
    for (const t of THREATS) Object.assign(threats[t], kinds.describe(kindOf[t]));

    // Learn confirmed scam pages so copies elsewhere match next time.
    if (threats.scam.level === 'confirmed' && ctx.contentCompare.fingerprint) {
      compare.learn(ctx.contentCompare.fingerprint, p.registrable, 'scam', threats.scam.evidence);
    }

    const result = {
      url: p.url,
      host: p.host,
      domain: p.registrable,
      researched: Boolean(ctx.research),
      threats,
      knowledge: {
        known: know.known,
        trusted: know.trusted,
        matches: know.matches.map(({ sourceName, threat, category, strength }) => ({ source: sourceName, threat, category, strength })),
        sources: know.sources,
        discountApplied
      },
      comparison: {
        similarDomains: [...ctx.compare.skeletonMatches.map((m) => m.host), ...ctx.compare.tokenMatches.map((m) => m.host)].slice(0, 5),
        kits: ctx.contentCompare.kits.map(({ label, threat, strength }) => ({ label, threat, strength })),
        similarPages: ctx.contentCompare.similarPages
      },
      research: ctx.research ? summarizeResearch(ctx.research) : null,
      file: fileReport ? { name: fileReport.name, sha256: fileReport.sha256, size: fileReport.size, type: fileReport.type } : null,
      checks
    };
    cacheSet(key, result);
    return result;
  })();

  coreInflight.set(key, job);
  try {
    return await job;
  } finally {
    coreInflight.delete(key);
  }
}

/** Allowlisted sites skip the heuristics but are still checked for exact malicious URLs. */
function trustedChecks(ctx) {
  return runChecklist({ ...ctx, research: null, researchSkipReason: 'Well-known, verified site' })
    .filter((c) => c.group === 'Known threats' || c.id === 'U36')
    .concat([{ id: 'T01', group: 'Trust', threat: 'scam', title: 'Well-known, verified site', research: false, status: 'pass', points: -40, detail: 'On Sentinel\'s verified list' }]);
}

function summarizeResearch(r) {
  const reg = r.registration || {};
  const http = r.http || {};
  return {
    domainAgeDays: reg.createdAt ? Math.floor((now() - reg.createdAt) / 86400000) : null,
    registeredAt: reg.createdAt || null,
    registrar: reg.registrar || null,
    resolves: r.dns ? r.dns.resolves : null,
    hasMail: r.dns ? r.dns.mx : null,
    reachable: Boolean(http.ok),
    status: http.status || null,
    finalUrl: http.finalUrl || null,
    redirects: Math.max(0, (http.chain || []).length - 1),
    certificateIssuer: http.tls && http.tls.issuer ? http.tls.issuer : null,
    pageTitle: http.page ? http.page.title : null,
    cached: Boolean(r.cached)
  };
}

/* --------------------------------------------------------------- shaping */

function shape(core, { threats: visible, userId, mode, detail = 'full', planId }) {
  let threats = {};
  for (const t of THREATS) threats[t] = visible.includes(t) ? core.threats[t] : null;

  let override = null;
  if (userId) {
    const p = analyze(core.url);
    const row = p && q.override.get(userId, p.registrable, p.host);
    if (row) override = row.action;
  }
  if (override === 'allow') {
    threats = Object.fromEntries(THREATS.map((t) => [t, threats[t] && { level: 'safe', badge: null, label: 'Trusted by you', score: 0, evidence: null }]));
  } else if (override === 'block' && threats.scam) {
    threats.scam = { level: 'confirmed', badge: 'red', label: 'Blocked by you', score: 100, evidence: 'You blocked this site', ...kinds.describe('blocked') };
  }

  const shownChecks = core.checks.filter((c) => visible.includes(c.threat));
  const tally = { total: shownChecks.length, failed: 0, warned: 0, passed: 0, skipped: 0 };
  for (const c of shownChecks) tally[{ fail: 'failed', warn: 'warned', pass: 'passed', skip: 'skipped' }[c.status]]++;

  const reasons = shownChecks
    .filter((c) => c.status === 'fail' || c.status === 'warn')
    .sort((a, b) => b.points - a.points)
    .slice(0, 6)
    .map((c) => ({ id: c.id, threat: c.threat, text: c.detail, title: c.title }));

  const worst = Object.values(threats).filter(Boolean).sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level])[0]
    || { level: 'safe', badge: null, label: 'No issues found' };

  return {
    ok: true,
    kind: 'url',
    url: core.url,
    host: core.host,
    domain: core.domain,
    mode,
    plan: planId,
    override,
    researched: core.researched,
    threats,
    overall: { level: worst.level, badge: worst.badge, label: worst.label },
    reasons,
    knowledge: core.knowledge,
    comparison: core.comparison,
    research: core.research,
    file: core.file,
    checklist: {
      ...tally,
      items: detail === 'full' ? shownChecks : shownChecks.filter((c) => c.status === 'fail' || c.status === 'warn')
    },
    checkedAt: now()
  };
}

/* ------------------------------------------------------------ public API */

/**
 * @param {string} raw
 * @param {{userId?: string, planId?: string, research?: boolean, threats?: string[], mode?: string, detail?: string, record?: boolean}} opts
 */
async function scanUrl(raw, opts = {}) {
  const p = analyze(String(raw || ''));
  const visible = opts.threats || THREATS;
  if (!p) {
    return { ok: false, kind: 'url', url: raw, error: 'not_a_web_link', message: 'That is not a web address Sentinel can check' };
  }
  const core = await coreScan(p, { research: Boolean(opts.research) });
  const verdict = shape(core, { threats: visible, userId: opts.userId, mode: opts.mode || 'manual', detail: opts.detail, planId: opts.planId });
  if (opts.record && opts.userId) record(opts.userId, 'url', p.url, verdict.mode, verdict.threats);
  return verdict;
}

async function scanUrls(urls, opts = {}) {
  const unique = [...new Set(urls.map(String))].slice(0, 60);
  const out = new Array(unique.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(opts.research ? 6 : 16, unique.length) }, async () => {
    while (next < unique.length) {
      const i = next++;
      try {
        out[i] = await scanUrl(unique[i], { ...opts, record: false });
      } catch {
        out[i] = { ok: false, kind: 'url', url: unique[i], error: 'scan_failed' };
      }
      out[i].requested = unique[i];
    }
  });
  await Promise.all(workers);
  if (opts.userId && opts.recordFlagged) {
    for (const v of out) if (v.ok && v.overall.badge) record(opts.userId, 'url', v.url, v.mode, v.threats);
  }
  return out;
}

async function scanEmail(mail, opts = {}) {
  const visible = opts.threats || THREATS;
  const analysis = analyzeEmail(mail);

  // Every link and the sender's own domain go through the URL pipeline.
  const targets = [...analysis.links];
  if (analysis.senderUrl) targets.push(analysis.senderUrl);
  const linkVerdicts = await scanUrls(targets, { ...opts, detail: 'compact', mode: opts.mode || 'manual', threats: THREATS });

  const checks = [...analysis.checks];
  const evidence = { scam: null, virus: null, malware: null };
  const worstLink = {};
  for (const v of linkVerdicts) {
    if (!v.ok) continue;
    for (const t of THREATS) {
      const th = v.threats[t];
      if (!th) continue;
      if (!worstLink[t] || SEVERITY[th.level] > SEVERITY[worstLink[t].threat.level]) worstLink[t] = { v, threat: th };
    }
  }
  const linkCheck = (t, title) => {
    const w = worstLink[t];
    if (!w || SEVERITY[w.threat.level] < SEVERITY.suspicious) return { id: `EL-${t}`, group: 'Email links', threat: t, title, status: 'pass', points: 0, detail: `${linkVerdicts.length} address(es) checked` };
    if (w.threat.level === 'confirmed') evidence[t] = `${w.v.host}: ${w.threat.evidence || w.threat.label}`;
    return { id: `EL-${t}`, group: 'Email links', threat: t, title, status: 'fail', points: Math.round(w.threat.score * 0.8), detail: `${w.v.host} - ${w.threat.label}` };
  };
  checks.push(linkCheck('scam', 'Links and sender domain are not scams'));
  checks.push(linkCheck('malware', 'Links do not lead to malware'));
  checks.push(linkCheck('virus', 'Links do not download viruses'));

  const known = linkVerdicts.some((v) => v.ok && v.knowledge.known);
  const { threats } = score(checks, { known, matches: known ? [{}] : [] }, evidence);
  const shown = Object.fromEntries(THREATS.map((t) => [t, visible.includes(t) ? threats[t] : null]));
  const worst = Object.values(shown).filter(Boolean).sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level])[0];
  const items = checks.filter((c) => visible.includes(c.threat));

  if (opts.record && opts.userId) record(opts.userId, 'email', `${analysis.sender.address || 'unknown sender'} - ${String(mail.subject || '').slice(0, 80)}`, opts.mode || 'manual', shown);

  return {
    ok: true,
    kind: 'email',
    mode: opts.mode || 'manual',
    sender: analysis.sender,
    threats: shown,
    overall: { level: worst.level, badge: worst.badge, label: worst.label },
    reasons: items.filter((c) => c.status === 'fail' || c.status === 'warn').sort((a, b) => b.points - a.points).slice(0, 6).map((c) => ({ id: c.id, threat: c.threat, text: c.detail, title: c.title })),
    links: linkVerdicts.filter((v) => v.ok).map((v) => ({ url: v.url, host: v.host, overall: v.overall })),
    checklist: {
      total: items.length,
      failed: items.filter((c) => c.status === 'fail').length,
      warned: items.filter((c) => c.status === 'warn').length,
      passed: items.filter((c) => c.status === 'pass').length,
      skipped: items.filter((c) => c.status === 'skip').length,
      items: opts.detail === 'compact' ? items.filter((c) => c.status === 'fail' || c.status === 'warn') : items
    },
    checkedAt: now()
  };
}

function scanUpload(buffer, name, opts = {}) {
  const report = scanFile(buffer, name);
  const checks = report.checks;
  const known = Boolean(report.evidence.virus || report.evidence.malware);
  const { threats } = score(checks, { known, matches: known ? [{}] : [] }, { scam: null, ...report.evidence });
  delete threats.scam;
  const kindOf = kinds.classifyFile(report, threats);
  for (const t of ['virus', 'malware']) Object.assign(threats[t], kinds.describe(kindOf[t]));
  const worst = [threats.virus, threats.malware].sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level])[0];
  if (opts.record && opts.userId) record(opts.userId, 'file', name, 'manual', { scam: null, ...threats });
  return {
    ok: true,
    kind: 'file',
    file: { name: report.name, sha256: report.sha256, size: report.size, type: report.type },
    threats: { scam: null, virus: threats.virus, malware: threats.malware },
    overall: { level: worst.level, badge: worst.badge, label: worst.label },
    reasons: checks.filter((c) => c.status === 'fail' || c.status === 'warn').sort((a, b) => b.points - a.points).slice(0, 6).map((c) => ({ id: c.id, threat: c.threat, text: c.detail, title: c.title })),
    checklist: {
      total: checks.length,
      failed: checks.filter((c) => c.status === 'fail').length,
      warned: checks.filter((c) => c.status === 'warn').length,
      passed: checks.filter((c) => c.status === 'pass').length,
      skipped: checks.filter((c) => c.status === 'skip').length,
      items: checks
    },
    checkedAt: now()
  };
}

function record(userId, kind, target, mode, threats) {
  const lvl = (t) => (threats[t] ? threats[t].level : null);
  const kindsJson = JSON.stringify(Object.fromEntries(['scam', 'virus', 'malware'].filter((t) => threats[t] && threats[t].kind).map((t) => [t, threats[t].kind])));
  try { q.history.run(userId, kind, String(target).slice(0, 500), mode, lvl('scam'), lvl('virus'), lvl('malware'), now(), kindsJson === '{}' ? null : kindsJson); } catch { /* history is best-effort */ }
}

module.exports = { scanUrl, scanUrls, scanEmail, scanUpload, invalidate };
