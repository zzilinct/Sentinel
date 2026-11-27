'use strict';
/**
 * The accuracy gate. Scores the frozen phishing sample and every honest set with the rules alone (no list loaded, so
 * two runs on one commit give the same numbers) and fails when a release does worse than scripts/evaluate-baseline.json.
 * List hits never gate: which addresses the public lists know moves from day to day.
 *
 *   node scripts/evaluate-gate.js [--bless]   print the numbers and the miss breakdown; --bless writes today's as the baseline
 *
 * Used by tests/accuracy-gate.test.js (every npm test) and by scripts/evaluate-modes.js (the Evaluate detection report).
 * The phishing sample is text and stays defanged on disk; each address is whole in memory only, and nothing is opened.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const BASELINE = path.join(DIR, 'evaluate-baseline.json');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

/** The honest sets, each an array of addresses. Every one must stay unflagged. */
function honestSets() {
  return {
    sites: read('evaluate-sites.json').map((h) => `https://${h}/`),
    pages: read('evaluate-pages.json'),
    lookalikes: read('evaluate-lookalikes.json').map((x) => x.url),
    freehost: read('evaluate-freehost.json'),
    // Made-up names in the platforms' own preview shapes (not claimed to exist; see evaluate-freehost-check.js).
    shapes: read('evaluate-freehost-shapes.json')
  };
}

function frozenSample() {
  return require('./phish-sample').parse(fs.readFileSync(path.join(DIR, 'evaluate-phish.frozen.txt'), 'utf8')).slice(0, 300);
}

/**
 * Scores with the engine as evaluate-modes does. `engine` is server/lib/scan/engine, loaded by the caller after the
 * throwaway-database environment is set.
 */
async function scoreAll(engine, phish = frozenSample(), sets = honestSets()) {
  const one = async (u) => { try { return await engine.scanUrl(u, { threats: ['scam', 'virus', 'malware'], mode: 'live', detail: 'compact', research: false }); } catch { return null; } };
  const many = async (urls) => {
    const out = new Array(urls.length);
    let next = 0;
    await Promise.all(Array.from({ length: 16 }, async () => { while (next < urls.length) { const i = next++; out[i] = await one(urls[i]); } }));
    return out;
  };
  const p = await many(phish);
  const honest = {};
  for (const [name, urls] of Object.entries(sets)) {
    const vs = await many(urls);
    honest[name] = urls.filter((u, i) => vs[i] && vs[i].overall.badge);
  }
  return { phish, verdicts: p, honest };
}

/** free host, campaign domain (one registrable domain with 2 or more sample addresses) or other. */
function classes(phish) {
  const url = require('../server/lib/scan/url');
  const parsed = phish.map((u) => url.analyze(u));
  const perReg = {};
  for (const p of parsed) if (p) perReg[p.registrable] = (perReg[p.registrable] || 0) + 1;
  return parsed.map((p) => (!p ? 'other' : p.hosting ? 'free host' : perReg[p.registrable] >= 2 ? 'campaign domain' : 'other'));
}

function summarize({ phish, verdicts, honest }) {
  const cls = classes(phish);
  const by = {};
  phish.forEach((u, i) => {
    const c = (by[cls[i]] = by[cls[i]] || { total: 0, flagged: 0 });
    c.total++;
    if (verdicts[i] && verdicts[i].overall.badge) c.flagged++;
  });
  const flagged = Object.values(by).reduce((n, c) => n + c.flagged, 0);
  return { flagged, total: phish.length, byClass: by, honestFalseAlarms: honest };
}

/** The failures, as words; an empty list means the gate holds. */
function compare(now, base) {
  const out = [];
  if (now.flagged < base.flagged) out.push(`rules alone flag ${now.flagged}/${now.total} of the frozen sample, below the baseline ${base.flagged}`);
  for (const [c, b] of Object.entries(base.byClass)) {
    const n = (now.byClass[c] || { flagged: 0 }).flagged;
    if (n < b.flagged) out.push(`${c}: ${n} flagged, below the baseline ${b.flagged}`);
  }
  // Known false alarms may only shrink: a new one fails, and one that is fixed must leave the baseline (--bless).
  for (const [k, urls] of Object.entries(now.honestFalseAlarms)) {
    const known = base.honestFalseAlarms[k] || [];
    for (const u of urls) if (!known.includes(u)) out.push(`new false alarm on an honest address in "${k}": ${u}`);
    for (const u of known) if (!urls.includes(u)) out.push(`fixed, remove from the baseline with --bless: ${u}`);
  }
  return out;
}

function print(now) {
  const honest = now.honestFalseAlarms;
  const lines = [`GATE (rules alone, frozen sample): ${now.flagged}/${now.total} flagged`];
  for (const [c, v] of Object.entries(now.byClass)) lines.push(`  ${c.padEnd(16)} ${v.flagged}/${v.total} flagged, ${v.total - v.flagged} missed`);
  for (const [k, v] of Object.entries(honest)) lines.push(`  honest ${k.padEnd(10)} ${v.length} false alarm(s)${v.length ? ': ' + v.join(' ') : ''}`);
  return lines.join('\n');
}

const baseline = () => JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

module.exports = { honestSets, frozenSample, scoreAll, summarize, compare, print, baseline, BASELINE };

if (require.main === module) {
  const os = require('os');
  process.env.DB_PATH = path.join(os.tmpdir(), `sentinel-gate-${process.pid}.db`);
  Object.assign(process.env, { FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', RESEARCH_LITE: '1', NODE_ENV: 'development' });
  require('../server/seed').run({ quiet: true });
  scoreAll(require('../server/lib/scan/engine')).then((r) => {
    const now = summarize(r);
    console.log(print(now));
    if (process.argv.includes('--bless')) { fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n'); console.log('baseline written'); }
    else { const f = compare(now, baseline()); f.forEach((x) => console.log('FAIL ' + x)); process.exitCode = f.length ? 1 : 0; }
  }).finally(() => setTimeout(() => process.exit(), 300));
}
