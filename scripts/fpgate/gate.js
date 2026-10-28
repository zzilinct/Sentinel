'use strict';
/**
 * The false-alarm gate: Sentinel's address rules judged on real, honest domains, so a rule written to catch more
 * scams cannot quietly start flagging honest sites.
 *
 *   node scripts/fpgate/gate.js [--root <checkout>] --save flags.json
 *        judge every domain in domains.txt with the rules in <checkout> (default: this one) and save what was flagged
 *        (--save-only: judge and save, compare nothing; how main's rules are run)
 *   node scripts/fpgate/gate.js --against main-flags.json [--save branch-flags.json]
 *        judge with this checkout's rules and fail on any NEW false alarm: a domain these rules flag that main's rules
 *        (main-flags.json) did not, or flag at a higher level, and that is not in the known baseline (baseline.json)
 *   node scripts/fpgate/gate.js --write-baseline
 *        record what this checkout's rules flag today as the known baseline (a deliberate, reviewed commit)
 *
 * Address only, as live scanning's fast check runs on an address its lists know nothing about (server/lib/scan/
 * offline.js): the checklist and Sentinel's shipped lists. No site is opened, resolved or looked up. Runs on GitHub's
 * machines (.github/workflows/test.yml).
 *
 * domains.txt is a frozen, held-out sample (its header names the source, licence and date). Rules are judged by it,
 * never written from it.
 *
 * baseline.json is what the rules of 1.18.1 already flagged in the sample when it was drawn (CI run 40606221962).
 * It mixes honest sites those rules get wrong (a brand's own country site, such as adidas.fr, read as borrowing the
 * brand) with real scams that rank in the list anyway. Known, not failures. Fixing a rule shrinks it; a domain the
 * gate reports as no longer flagged can be deleted from it.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DOMAINS = path.join(HERE, 'domains.txt');
const BASELINE = path.join(HERE, 'baseline.json');
const RANK = { yellow: 1, orange: 2, red: 3 };
const rank = (badge) => RANK[badge] || 0;

function loadDomains(file = DOMAINS) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

/** { domain: { badge, threat, rules: ['U45 detail', ...] } } for every domain the rules in `root` flag. */
function judge(root, domains) {
  process.env.NODE_ENV = 'test';   // config.js must not write a development secret into the checkout
  const offline = require(path.join(path.resolve(root), 'server', 'lib', 'scan', 'offline.js'));
  const flags = {};
  for (const domain of domains) {
    const v = offline.scanAddress(`https://${domain}/`);
    if (!v || !v.ok || !v.overall || !v.overall.badge) continue;
    const threat = Object.keys(v.threats).find((t) => v.threats[t].badge === v.overall.badge) || 'scam';
    const rules = (offline._test.checksOf(`https://${domain}/`) || [])
      .filter((c) => c.status === 'fail' || c.status === 'warn')
      .map((c) => `${c.id} ${c.detail || c.title}`);
    flags[domain] = { badge: v.overall.badge, threat, rules };
  }
  return flags;
}

/**
 * New false alarms: flagged here higher than both main and the known baseline allow.
 * Fixed: in the baseline, no longer flagged here (the baseline can be trimmed).
 */
function compare(branch, main, baseline) {
  const fresh = [];
  for (const [domain, f] of Object.entries(branch)) {
    const allowed = Math.max(rank(main[domain] && main[domain].badge), rank(baseline[domain] && baseline[domain].badge));
    if (rank(f.badge) > allowed) fresh.push({ domain, ...f, before: (main[domain] && main[domain].badge) || null });
  }
  const fixed = Object.keys(baseline).filter((d) => !branch[d]);
  return { fresh, fixed };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

function main() {
  const domains = loadDomains();
  const started = Date.now();
  const flags = judge(arg('--root') || path.join(HERE, '..', '..'), domains);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${domains.length} honest domains judged in ${seconds} s; ${Object.keys(flags).length} flagged.`);
  if (arg('--save')) fs.writeFileSync(arg('--save'), JSON.stringify(flags, null, 1));
  if (process.argv.includes('--save-only')) return;

  if (process.argv.includes('--write-baseline')) {
    const sorted = Object.fromEntries(Object.keys(flags).sort().map((d) => [d, flags[d]]));
    fs.writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 1)}\n`);
    console.log(`Baseline written: ${Object.keys(flags).length} domains.`);
    return;
  }

  const baseline = fs.existsSync(BASELINE) ? readJson(BASELINE) : {};
  const against = arg('--against');
  const mainFlags = against ? readJson(against) : {};
  if (!against) console.log('No main results given: judged against the baseline alone.');
  const { fresh, fixed } = compare(flags, mainFlags, baseline);

  for (const d of fixed) console.log(`  no longer flagged (can leave the baseline): ${d}`);
  if (!fresh.length) {
    console.log('No new false alarms.');
    return;
  }
  console.log(`\n${fresh.length} NEW false alarm(s) on real, honest domains:`);
  for (const f of fresh) {
    console.log(`  ${f.domain}  ${f.before ? `${f.before} -> ` : ''}${f.badge} ${f.threat}`);
    for (const r of f.rules) console.log(`      ${r}`);
  }
  console.log('\nFix the rule, or, if a domain really is a scam, add it to scripts/fpgate/baseline.json with the reason.');
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { loadDomains, judge, compare };
