'use strict';
/**
 * From checks to a verdict: points per threat, the evidence that makes one red, and the reasons a person reads.
 * Pure, with no database, so the engine and the website's in-browser check (offline.js) score an address the same way.
 */
const { runChecklist } = require('./checklist');
const L = require('./lists');

const THREATS = ['scam', 'virus', 'malware'];
const DISCOUNT = { scam: 0.8, virus: 0.85, malware: 0.85 };
const BADGE = { safe: null, caution: null, suspicious: 'yellow', likely: 'orange', confirmed: 'red' };
const LABELS = {
  scam: { safe: 'No scam signs', caution: 'Nothing conclusive', suspicious: 'Suspicious', likely: 'Likely scam', confirmed: 'Confirmed scam' },
  virus: { safe: 'No virus signs', caution: 'Nothing conclusive', suspicious: 'Possible virus', likely: 'Likely virus', confirmed: 'Virus detected' },
  malware: { safe: 'No malware signs', caution: 'Nothing conclusive', suspicious: 'Possible malware', likely: 'Likely malware', confirmed: 'Malware detected' }
};
// A file is called a virus or malware only with evidence (confirmed). Without it the words say what was found, as the
// desktop app's file labels do (desktop/src/downloads.js).
const FILE_LABELS = {
  virus: { ...LABELS.virus, suspicious: 'A few warning signs', likely: 'Warning signs, no proof' },
  malware: { ...LABELS.malware, suspicious: 'A few warning signs', likely: 'Warning signs, no proof' }
};
const SEVERITY = { safe: 0, caution: 1, suspicious: 2, likely: 3, confirmed: 4 };
// Points an address must collect from its own checks before "another page on this
// host is listed" is allowed to make it red. The "nothing conclusive" line.
const INFERENCE_NEEDS = 15;

/* -------------------------------------------------------------- scoring */

function levelFor(score, evidence) {
  if (evidence) return 'confirmed';
  if (score >= 55) return 'likely';
  if (score >= 30) return 'suspicious';
  if (score >= 15) return 'caution';
  return 'safe';
}

// A storage bucket's name ("acme-invoices.s3.amazonaws.com", "myaccount.blob.core.windows.net") is chosen by whoever
// rents it, nearly always a real company. Words or shape in that name and path are never enough to call it a scam:
// without evidence it stays at most "Nothing conclusive", unless it really impersonates a brand (a brand it does not
// own, next to sign-in or verify wording, or on a web page). Files it serves are still judged as downloads (virus).
const IMPERSONATION_IDS = ['U22', 'U23', 'U24', 'U37', 'U40', 'X01', 'P01'];
const CREDENTIAL_IDS = ['U25', 'U37', 'U41', 'P02', 'P03', 'P05', 'P06'];
const KIT_IDS = ['C03', 'C04', 'C05'];
const STORAGE_CAP = 29;
function storageNameOnly(checks, ctx) {
  const p = ctx && ctx.p;
  if (!p || !L.OBJECT_STORAGE.test(p.host)) return false;
  const failed = (ids) => checks.some((c) => c.status === 'fail' && ids.includes(c.id));
  if (failed(KIT_IDS)) return false;
  const u20 = checks.find((c) => c.id === 'U20' && c.status === 'fail');
  const impersonates = failed(IMPERSONATION_IDS) || Boolean(u20 && /named for/.test(u20.detail));
  const asksToSignIn = failed(CREDENTIAL_IDS) || Boolean(u20 && /login wording/.test(u20.detail)) || /verif/i.test(p.host + p.path);
  const webPage = /\.(html?|php|aspx?)$/i.test(p.path) || p.path.endsWith('/');
  return !(impersonates && (asksToSignIn || webPage));
}

function score(checks, know, evidence, ctx = null) {
  const capped = storageNameOnly(checks, ctx);
  const totals = { scam: 0, virus: 0, malware: 0 };
  for (const c of checks) {
    if (c.status === 'skip') continue;
    totals[c.threat] += c.points;
    if (c.extra) for (const [t, pts] of Object.entries(c.extra)) totals[t] += pts;
  }

  const unknown = !know.known && !know.matches.length && !know.userContent;
  const threats = {};
  for (const t of THREATS) {
    let s = totals[t];
    if (unknown && s > 0) s *= DISCOUNT[t];
    s = Math.max(0, Math.min(100, Math.round(s)));
    if (capped && t !== 'virus' && !know.matches.length) s = Math.min(s, STORAGE_CAP);
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

  // Another page on this host is listed, this address is not (knowledge.js). On a
  // throwaway host that is as good as a listing; on a large service it says nothing
  // about this page. The address's own checks tell the two apart: what the lists
  // say does not count towards it.
  for (const m of know.matches) {
    if (m.strength !== 'inferred' || ev[m.threat]) continue;
    const own = checks.reduce((sum, c) => sum + (c.status !== 'skip' && c.threat === m.threat && !/^K\d/.test(c.id) ? c.points : 0), 0);
    if (own >= INFERENCE_NEEDS) ev[m.threat] = `${m.sourceName}: ${m.category.replace(/_/g, ' ')}, and this address fails checks of its own`;
  }

  if (failed('R11') && ctx.finalKnowledge) {
    for (const m of ctx.finalKnowledge.matches.filter((x) => x.strength === 'confirmed')) {
      if (!ev[m.threat]) ev[m.threat] = `Redirect chain includes a known ${m.threat} address`;
    }
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

/** Allowlisted sites skip the heuristics but are still checked for exact malicious URLs. */
function trustedChecks(ctx) {
  return runChecklist({ ...ctx, research: null, researchSkipReason: 'Well-known, verified site' })
    .filter((c) => c.group === 'Known threats' || c.id === 'U36')
    .concat([{ id: 'T01', group: 'Trust', threat: 'scam', title: 'Well-known, verified site', research: false, status: 'pass', points: -40, detail: 'On Sentinel\'s verified list' }]);
}

/** Totals of a list of checks, by outcome. */
function tallyOf(checks) {
  const tally = { total: checks.length, failed: 0, warned: 0, passed: 0, skipped: 0 };
  for (const c of checks) tally[{ fail: 'failed', warn: 'warned', pass: 'passed', skip: 'skipped' }[c.status]]++;
  return tally;
}

/** The checks that raised a concern, most points first: what a verdict says in words. */
function reasonsOf(checks) {
  return checks
    .filter((c) => c.status === 'fail' || c.status === 'warn')
    .sort((a, b) => b.points - a.points)
    .slice(0, 6)
    .map((c) => ({ id: c.id, threat: c.threat, text: c.detail, title: c.title }));
}

module.exports = { THREATS, LABELS, FILE_LABELS, SEVERITY, levelFor, score, evidenceFrom, trustedChecks, tallyOf, reasonsOf };
