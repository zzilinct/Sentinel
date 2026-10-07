'use strict';
/**
 * The fast check with nothing but the address: the full checklist and Sentinel's own shipped lists, no database,
 * no network. scripts/build-static.js bundles this for the public website, where there is no server, so "Try a
 * link" runs in the visitor's browser and the address is never sent anywhere.
 *
 * What it leaves out, and says so: the public threat lists and the comparison with known scam domains (both live
 * in the app's database), and research. An address none of those has anything on scores here exactly as in the
 * app's fast scan; the result never claims a list was checked ("discounted" stays false).
 */
const L = require('./lists');
const { analyze, typedUrl, brandInfo, hostWords, isUserContent } = require('./url');
const kinds = require('./kinds');
const { runChecklist } = require('./checklist');
const { THREATS, SEVERITY, score, evidenceFrom, trustedChecks, tallyOf, reasonsOf } = require('./verdict');

const NOT_HERE = 'Checked in the Sentinel app, against the public threat lists';
const NO_RESEARCH = 'Research into the site runs in the Sentinel app';
const NO_COMPARE = { skeletonMatches: [], tokenMatches: [], nearest: null, compared: 0, closest: [] };

/** knowledge.lookup() with only what ships inside Sentinel: its own confirmed threats and verified sites. */
function shippedKnowledge(p) {
  const bare = p.host.replace(/^www\./, '');
  const hosts = new Set([p.host, p.registrable, bare, `www.${bare}`]);
  const matches = L.SEED_BLOCKLIST.filter((e) => hosts.has(e.host))
    .map((e) => ({ source: 'sentinel', sourceName: 'Sentinel threat database', threat: e.threat, category: e.category, strength: 'confirmed' }));
  const userContent = isUserContent(p.host);
  const allowed = L.DEFAULT_ALLOWLIST.some((h) => hosts.has(h));
  return {
    known: matches.length > 0,
    trusted: !matches.length && allowed && !userContent,
    userContent,
    matches,
    reports: 0,
    reportCounts: { scam: 0, malware: 0 },
    sources: ['Sentinel threat database'],
    feeds: null
  };
}

/**
 * @param {string} raw what the person typed or pasted
 * @returns {object} the same shape as the website's demo scan (demo.routes.js summarize), plus local: true;
 *   or {ok: false, message} when it is not a web address.
 */
function scanAddress(raw) {
  const url = typeof raw === 'string' && raw.trim() ? typedUrl(raw) : null;
  const p = url ? analyze(url) : null;
  if (!p) return { ok: false, message: 'That doesn’t look like a web address.' };
  return assess(p).verdict;
}

function assess(p) {
  const know = shippedKnowledge(p);
  const ctx = {
    p,
    brand: brandInfo(p),
    words: hostWords(p.host),
    knowledge: know,
    compare: NO_COMPARE,
    contentCompare: { kits: [], similarPages: [], fingerprint: null },
    research: null,
    researchSkipReason: NO_RESEARCH,
    finalKnowledge: null,
    hint: null
  };
  // A list or comparison that was not consulted must not read as passed: only what it found stays.
  const checks = (know.trusted ? trustedChecks(ctx) : runChecklist(ctx)).map((c) => (
    (c.group === 'Known threats' || c.group === 'Compared to known scams') && c.status !== 'fail' && c.status !== 'warn'
      ? { ...c, status: 'skip', points: 0, detail: c.research ? c.detail : NOT_HERE }
      : c));

  const evidence = evidenceFrom(checks, know, ctx);
  // Scored as the app scores an address its lists have nothing on, so the two give the same answer for it.
  const { threats } = score(checks, know, evidence);
  const kindOf = kinds.classify({ checks, know, comparison: { kits: [] }, threats });
  for (const t of THREATS) Object.assign(threats[t], kinds.describe(kindOf[t]));

  const worst = Object.values(threats).sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level])[0];
  const tally = tallyOf(checks);
  const verdict = {
    ok: true,
    local: true,
    url: p.url,
    host: p.host,
    threats: Object.fromEntries(THREATS.map((t) => [t, { badge: threats[t].badge, level: threats[t].level, label: threats[t].label, score: threats[t].score, kind: threats[t].kind || null, kindLabel: threats[t].kindLabel || null, kindShort: threats[t].kindShort || null }])),
    overall: { level: worst.level, badge: worst.badge, label: worst.label },
    reasons: reasonsOf(checks).slice(0, 5).map((r) => ({ threat: r.threat, text: r.text })),
    known: know.known,
    discounted: false,
    checks: { total: tally.total, failed: tally.failed, warned: tally.warned, passed: tally.passed, skipped: tally.skipped }
  };
  return { verdict, checks };
}

/** Every check behind an address's verdict, for the tests that hold this to the engine. */
function checksOf(raw) {
  const p = analyze(typedUrl(raw));
  return p ? assess(p).checks : null;
}

module.exports = { scanAddress, _test: { checksOf } };
