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
const config = require('../../config');
const knowledge = require('./knowledge');
const feeds = require('./feeds');
const compare = require('./compare');
const researchMod = require('./research');
const { runChecklist } = require('./checklist');
const { analyze, brandInfo, hostWords } = require('./url');
const kinds = require('./kinds');
const mySites = require('./mysites');
const { scanFile, MAX_FILE_BYTES } = require('./filescan');
const { analyzeEmail, markHost } = require('./email');
const { THREATS, LABELS, SEVERITY, score, evidenceFrom, trustedChecks, tallyOf, reasonsOf } = require('./verdict');

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

/* ------------------------------------------------------------- pipeline */

/** Everything that doesn't depend on who is asking. */
const NO_RESEARCH_PLAN = 'Research is included with Pro, Max and Ultimate scans';
const NO_RESEARCH_LOCAL = 'This copy of Sentinel runs on your computer, and suspicious pages are never opened from here. Research comes with the hosted service.';

async function coreScan(p, { research: wanted, budgetMs, hint }) {
  // Full research where pages may be opened (the hosted service); registry and DNS only where they may not (the desktop app).
  const lite = Boolean(wanted) && !config.researchEnabled && config.researchLite;
  const research = Boolean(wanted) && (config.researchEnabled || lite);
  // Results computed before a feed import (including in-flight scans) cannot
  // satisfy a lookup after that import has completed.
  // What the search result says about the page (its title, what was searched) changes the answer: part of the key.
  const hintKey = hint ? `|h:${require('crypto').createHash('sha1').update(`${hint.title}|${hint.query}`).digest('hex').slice(0, 12)}` : '';
  const key = `${feeds.revision()}|${research ? (lite ? 'l' : 'r') : 'q'}|${p.url}${hintKey}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const flightKey = budgetMs ? `${key}|b` : key;
  if (coreInflight.has(flightKey)) return coreInflight.get(flightKey);

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
      researchSkipReason: research ? null : (wanted ? NO_RESEARCH_LOCAL : NO_RESEARCH_PLAN),
      finalKnowledge: null,
      // What the search engine showed about this result, when it was found on a results page: the page's own title
      // (the site's words about itself) and what the person searched for. Read without opening the page.
      hint: hint || null
    };

    let fileReport = null;
    if (research && !know.trusted) {
      ctx.research = await researchMod.research(p, { lite, budgetMs });
      const http = ctx.research.http;
      if (http.ok && http.page) {
        ctx.contentCompare = compare.compareContent(http.page.text, http.page.htmlLower, p.host);
      }
      if (http.chain && http.chain.length > 1) {
        const destinations = [...new Set(http.chain.slice(1).map(hop => hop.url))];
        const knownHops = await Promise.all(destinations.map(url => {
          const parsed = analyze(url);
          return parsed ? knowledge.lookup(parsed) : { matches: [] };
        }));
        ctx.finalKnowledge = { matches: knownHops.flatMap(k => k.matches) };
      }
      if (http.ok && !http.truncated && http.download && http.download.length && http.download.length <= MAX_FILE_BYTES) {
        const name = (/filename\*?=(?:utf-8'')?"?([^";]+)/i.exec(http.disposition || '') || [])[1] || p.file || 'download';
        fileReport = scanFile(http.download, name);
      }
    }

    let checks = know.trusted ? trustedChecks(ctx) : runChecklist(ctx);
    if (fileReport) checks = checks.concat(fileReport.checks.map((c) => ({ ...c, id: `D-${c.id}`, group: 'Downloaded file', research: true })));
    if (ctx.research && ctx.research.http.truncated) checks.push({ id: 'D-limit', group: 'Downloaded content', threat: 'virus', research: true,
      title: 'Downloaded content was fully inspected', status: 'warn', points: 0,
      detail: 'Only part of the response could be read; a complete file hash and full content scan are unavailable' });

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
      researchSkipReason: ctx.research ? null : ctx.researchSkipReason,
      threats,
      knowledge: {
        known: know.known,
        trusted: know.trusted,
        matches: know.matches.map(({ sourceName, threat, category, strength }) => ({ source: sourceName, threat, category, strength })),
        sources: know.sources,
        feeds: know.feeds,
        discountApplied
      },
      comparison: {
        similarDomains: [...new Set([...ctx.compare.skeletonMatches.map((m) => m.host), ...ctx.compare.tokenMatches.map((m) => m.host)])].slice(0, 10),
        compared: ctx.compare.compared || 0,
        closest: ctx.compare.closest || [],
        kits: ctx.contentCompare.kits.map(({ label, threat, strength }) => ({ label, threat, strength })),
        similarPages: ctx.contentCompare.similarPages
      },
      research: ctx.research ? summarizeResearch(ctx.research) : null,
      file: fileReport ? { name: fileReport.name, sha256: fileReport.sha256, size: fileReport.size, type: fileReport.type } : null,
      realSite: realSiteOf(checks, ctx.brand),
      checks
    };
    const facts = ctx.research;
    const complete = !facts || (facts.registration.reason !== 'not answered in time' && !facts.dns.unavailable &&
      (facts.lite || (facts.http.ok && facts.http.status >= 200 && facts.http.status < 300 && !facts.http.truncated)));
    if (complete) cacheSet(key, result);
    return result;
  })();

  coreInflight.set(flightKey, job);
  try {
    return await job;
  } finally {
    coreInflight.delete(flightKey);
  }
}


// Warnings that lead to the real site: the brand a page imitates, taken from the impersonation checks that failed.
// Only when exactly one brand is named; a page that borrows two, or none, gets no button.
const IMPERSONATION = { U22: 'inDomain', U23: 'inSubdomain', U24: 'lookalike' };
function realSiteOf(checks, brand) {
  const named = new Set();
  for (const c of checks) {
    const b = c.status === 'fail' && IMPERSONATION[c.id] && brand[IMPERSONATION[c.id]];
    if (b) named.add(b.domains[0]);
  }
  return named.size === 1 ? [...named][0] : null;
}

function summarizeResearch(r) {
  const reg = r.registration || {};
  const http = r.http || {};
  return {
    domainAgeDays: reg.createdAt ? Math.floor((now() - reg.createdAt) / 86400000) : null,
    registeredAt: reg.createdAt || null,
    registrar: reg.registrar || null,
    resolves: r.dns && !r.dns.unavailable ? r.dns.resolves : null,
    hasMail: r.dns && !r.dns.unavailable ? r.dns.mx : null,
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

  // Your sites (mysites.js): an address made to look like a site this person uses. Never on a site they trust, nor
  // on one Sentinel has verified.
  const checks = core.checks.slice();
  const copy = userId && override !== 'allow' && !core.knowledge.trusted ? mySites.lookalike(userId, core.url) : null;
  if (copy) {
    checks.unshift({ id: 'Y01', group: 'Your sites', threat: 'scam', title: 'Not a look-alike of a site you use', research: false,
      status: 'fail', points: 70, detail: mySites.warning(copy) });
    if (threats.scam && SEVERITY[threats.scam.level] < SEVERITY.likely) {
      threats.scam = { level: 'likely', badge: 'orange', label: 'Look-alike of your site', score: Math.max(threats.scam.score, 70), evidence: null, ...kinds.describe('impersonation') };
    }
  }
  // The real site, for a page flagged as an imitation: the person's own site it copies, or the brand's official
  // address (brands.js). Never built from the page's own address, and never for a site the person trusts.
  const flagged = threats.scam && (threats.scam.badge === 'orange' || threats.scam.badge === 'red');
  const real = override === 'allow' || !flagged ? null : copy ? copy.site : core.realSite || null;
  const shownChecks = checks.filter((c) => visible.includes(c.threat));
  const tally = tallyOf(shownChecks);
  const reasons = reasonsOf(shownChecks);

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
    researchSkipReason: core.researchSkipReason || null,
    threats,
    overall: { level: worst.level, badge: worst.badge, label: worst.label },
    reasons,
    knowledge: core.knowledge,
    comparison: core.comparison,
    research: core.research,
    file: core.file,
    realSite: real ? { host: real, url: `https://${real}/` } : null,
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
/** A result's title and the search it came from, trimmed; null when there is neither. */
function cleanHint(h) {
  if (!h || typeof h !== 'object') return null;
  const title = String(h.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const query = String(h.query || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return title || query ? { title, query } : null;
}

async function scanUrl(raw, opts = {}) {
  const p = analyze(String(raw || ''));
  const visible = opts.threats || THREATS;
  if (!p) {
    return { ok: false, kind: 'url', url: raw, error: 'not_a_web_link', message: 'That is not a web address Sentinel can check' };
  }
  const core = await coreScan(p, { research: Boolean(opts.research), budgetMs: opts.budgetMs, hint: cleanHint(opts.hint) });
  const verdict = shape(core, { threats: visible, userId: opts.userId, mode: opts.mode || 'manual', detail: opts.detail, planId: opts.planId });
  if (opts.record && opts.userId) record(opts.userId, 'url', p.url, verdict.mode, verdict.threats);
  return verdict;
}

async function scanUrls(urls, opts = {}) {
  const unique = [...new Set(urls.map(String))].slice(0, 60);
  const out = new Array(unique.length);
  let next = 0;
  // `budgetMs` is a promise about the whole batch, not each address: 40 results researched six at a time, each
  // allowed the full budget, could take half a minute. Every address gets what is left of the batch's time, and one
  // started too late for research gets the quick answer instead. "Lite" research (registry and DNS, never the
  // page) is light enough to run twelve at a time.
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : 0;
  const lite = opts.research && !config.researchEnabled && config.researchLite;
  const width = opts.research ? (lite ? 12 : 6) : 16;
  const workers = Array.from({ length: Math.min(width, unique.length) }, async () => {
    while (next < unique.length) {
      const i = next++;
      try {
        const left = deadline ? deadline - Date.now() : 0;
        const each = deadline ? { research: opts.research && left > 400, budgetMs: Math.max(1, left) } : {};
        const hint = opts.hints && Object.prototype.hasOwnProperty.call(opts.hints, unique[i]) ? opts.hints[unique[i]] : null;
        out[i] = await scanUrl(unique[i], { ...opts, ...each, hint, record: false });
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
  const analysis = analyzeEmail(mail, { preview: opts.preview === true });

  // Every link and the sender's own domain go through the URL pipeline.
  const options = { ...opts, detail: 'compact', mode: opts.mode || 'manual', threats: THREATS };
  const linkVerdicts = await scanUrls(analysis.links, options);
  if (analysis.senderUrl && !analysis.links.includes(analysis.senderUrl)) {
    linkVerdicts.push(...await scanUrls([analysis.senderUrl], options));
  }
  const failedLinks = linkVerdicts.filter(v => !v.ok).length;
  const incomplete = failedLinks > 0 || analysis.linksTruncated;

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
    if (!w || SEVERITY[w.threat.level] < SEVERITY.suspicious) return { id: `EL-${t}`, group: 'Email links', threat: t, title,
      status: incomplete || !linkVerdicts.length ? 'skip' : 'pass', points: 0,
      detail: incomplete ? `${linkVerdicts.length - failedLinks} address(es) checked; ${failedLinks} failed${analysis.linksTruncated ? '; additional links exceed the 60-link limit' : ''}` : `${linkVerdicts.length} address(es) checked` };
    if (w.threat.level === 'confirmed') evidence[t] = `${w.v.host}: ${w.threat.evidence || w.threat.label}`;
    return { id: `EL-${t}`, group: 'Email links', threat: t, title, status: 'fail', points: Math.round(w.threat.score * 0.8), detail: `${w.v.host}: ${w.threat.label}`, marks: markHost(mail, w.v.host) };
  };
  checks.push(linkCheck('scam', 'Links and sender domain are not scams'));
  checks.push(linkCheck('malware', 'Links do not lead to malware'));
  checks.push(linkCheck('virus', 'Links do not download viruses'));

  const known = linkVerdicts.some((v) => v.ok && v.knowledge.known);
  const { threats } = score(checks, { known, matches: known ? [{}] : [], userContent: incomplete }, evidence);
  // Wording is never enough on its own. "Security alert", "verify", "will be deleted", a cancelled event: real
  // mail from Google, Canva, a church or a school says all of this, and a warning on it teaches people to ignore
  // Sentinel. A mask needs evidence: a sender that is not who it claims, a look-alike domain, a payment demand, a
  // dangerous attachment or a bad link.
  for (const t of THREATS) {
    const evidenced = checks.some((c) => c.threat === t && c.status === 'fail');
    if (!evidenced && SEVERITY[threats[t].level] >= SEVERITY.suspicious) {
      threats[t] = { ...threats[t], level: 'caution', badge: null, label: LABELS[t].caution, score: Math.min(threats[t].score, 29) };
    }
  }
  const shown = Object.fromEntries(THREATS.map((t) => [t, visible.includes(t) ? threats[t] : null]));
  const worst = Object.values(shown).filter(Boolean).sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level])[0];
  const items = checks.filter((c) => visible.includes(c.threat));

  if (opts.record && opts.userId) record(opts.userId, 'email', `${analysis.sender.address || 'unknown sender'}: ${String(mail.subject || '').slice(0, 80)}`, opts.mode || 'manual', shown);

  return {
    ok: true,
    kind: 'email',
    mode: opts.mode || 'manual',
    sender: analysis.sender,
    threats: shown,
    overall: { level: worst.level, badge: worst.badge, label: incomplete && !worst.badge ? 'Scan incomplete' : worst.label },
    coverage: { complete: !incomplete, checked: linkVerdicts.length - failedLinks, failed: failedLinks, linksTruncated: analysis.linksTruncated },
    reasons: reasonsOf(items),
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
    reasons: reasonsOf(checks),
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
