'use strict';
/**
 * Builds the false-alarm gate's frozen sample of real, honest domains (scripts/fpgate/domains.txt).
 *
 *   node scripts/fpgate/sample.js --csv majestic_million.csv --out domains.txt --date "<list date>"
 *
 * Runs once, on GitHub's machines (.github/workflows/fp-sample.yml), never on a person's computer. The result is
 * committed and then left alone: the gate judges rule changes against it, and rules are never written from it. A new
 * sample is a deliberate, separate commit.
 *
 * Source: the Majestic Million (https://majestic.com/reports/majestic-million), the million registrable domains
 * with the most referring subnets, published under Creative Commons Attribution 3.0. Only the domain names are
 * used; nothing is opened, resolved or looked up.
 *
 * The sample is drawn with a fixed seed, so the same list always gives the same sample:
 *   - rank bands, from the most popular sites to obscure ones (see BANDS);
 *   - real names that contain a brand's name without being that brand's own domain (applebees.com beside apple,
 *     zoominfo.com beside zoom): the honest look-alikes a spelling rule is most likely to get wrong. Chosen by the
 *     brand names in brands.js only, never by what any rule says about them.
 */
const fs = require('fs');
const path = require('path');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const CSV = arg('--csv');
const OUT = path.resolve(arg('--out', path.join(__dirname, 'domains.txt')));
const DATE = arg('--date', 'unknown');
const SEED = 20261027;

// [from rank, to rank, how many]
const BANDS = [[1, 1000, 1000], [1001, 10000, 3000], [10001, 100000, 5000], [100001, 1000000, 8000]];
const BRAND_LIKE = 3000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, n, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

function main() {
  if (!CSV) throw new Error('--csv is required');
  const lines = fs.readFileSync(CSV, 'utf8').split(/\r?\n/);
  const head = lines.shift().split(',');
  const R = head.indexOf('GlobalRank');
  const D = head.indexOf('Domain');
  if (R < 0 || D < 0) throw new Error(`unexpected columns: ${head.join(',')}`);
  const rows = [];
  for (const line of lines) {
    const c = line.split(',');
    const domain = String(c[D] || '').trim().toLowerCase();
    const rank = Number(c[R]);
    if (!domain || !rank || !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(domain) || /^\d+(\.\d+){3}$/.test(domain)) continue;
    rows.push({ rank, domain });
  }
  const rand = rng(SEED);
  const chosen = new Map();
  for (const [from, to, n] of BANDS) {
    for (const r of pick(rows.filter((x) => x.rank >= from && x.rank <= to), n, rand)) chosen.set(r.domain, r.rank);
  }
  const { BRANDS } = require('../../server/lib/scan/brands');
  const own = new Set(BRANDS.flatMap((b) => b.domains));
  const tokens = [...new Set(BRANDS.map((b) => b.token))].filter((t) => t.length >= 4);
  const label = (d) => d.split('.')[0];
  const brandLike = rows.filter((r) => !chosen.has(r.domain) && !own.has(r.domain) && tokens.some((t) => label(r.domain).includes(t)));
  for (const r of pick(brandLike, BRAND_LIKE, rand)) chosen.set(r.domain, r.rank);

  const out = [...chosen].sort((a, b) => a[1] - b[1]).map(([d]) => d);
  const header = [
    '# Sentinel false-alarm gate: a frozen sample of real, honest domains. Do not tune rules on it.',
    '# Source: the Majestic Million, https://majestic.com/reports/majestic-million',
    '# Licence: Creative Commons Attribution 3.0 (CC BY 3.0). Domain names by Majestic.',
    `# List date: ${DATE}. Sampled ${new Date().toISOString().slice(0, 10)} by scripts/fpgate/sample.js, seed ${SEED}.`,
    `# Rank bands: ${BANDS.map(([f, t, n]) => `${n} of ranks ${f}-${t}`).join(', ')}; up to ${BRAND_LIKE} more that contain a brand name but are not its own domain.`,
    `# Domains: ${out.length}, ordered by rank.`
  ];
  fs.writeFileSync(OUT, `${header.join('\n')}\n${out.join('\n')}\n`);
  console.log(`${out.length} domains (${brandLike.length} brand-like candidates in the list) written to ${OUT}`);
}

main();
