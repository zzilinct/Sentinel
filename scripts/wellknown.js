'use strict';
/**
 * Builds server/lib/scan/wellknown.txt: the most linked-to sites on the web, which url.isWellKnown counts as well
 * known. On those the shape of a link (its length, signed parameters, generated names) and other listed pages on the
 * same site are not held against an address; the threat lists and the download checks still are.
 *
 *   node scripts/wellknown.js --csv majestic_million.csv --date "<list date>"
 *
 * Runs on GitHub's machines (.github/workflows/well-known.yml), never on a person's computer, and the result is
 * committed by hand.
 *
 * Source: the Majestic Million (https://majestic.com/reports/majestic-million), the registrable domains with the most
 * referring subnets, published under Creative Commons Attribution 3.0. Only the names of the top TOP are kept.
 * Nothing is opened, resolved or looked up.
 *
 * Not the false-alarm gate's sample (scripts/fpgate/domains.txt): the gate judges the address rules alone
 * (server/lib/scan/offline.js), which never read this list.
 */
const fs = require('fs');
const path = require('path');
const { analyze } = require('../server/lib/scan/url');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const CSV = arg('--csv');
const DATE = arg('--date', 'unknown');
const OUT = path.join(__dirname, '..', 'server', 'lib', 'scan', 'wellknown.txt');
const TOP = 10000;

const PSL = arg('--psl');

// The Public Suffix List (https://publicsuffix.org, MPL 2.0) names the endings under which each name belongs to
// someone else: "in.net", "blogspot.de", "pantheonsite.io". Such a platform ranks high because of its tenants, and a
// tenant's name ("evil.in.net") must never count as well known, so every top domain the list names, or names an
// ending under, is left out. Only used to leave names out; nothing of it is shipped.
const suffixes = new Set(fs.readFileSync(PSL, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase())
  .filter((l) => l && !l.startsWith('//')).map((l) => l.replace(/^[*!]\./, '').replace(/^!/, '')));
const platform = (d) => suffixes.has(d) || [...suffixes].some((s) => s.endsWith(`.${d}`));

const lines = fs.readFileSync(CSV, 'utf8').split(/\r?\n/);
const head = lines.shift().split(',');
const R = head.indexOf('GlobalRank');
const D = head.indexOf('Domain');
if (R < 0 || D < 0) throw new Error(`unexpected columns: ${head.join(',')}`);
const out = [];
const dropped = [];
for (const line of lines) {
  const c = line.split(',');
  const domain = String(c[D] || '').trim().toLowerCase();
  if (!(Number(c[R]) <= TOP) || !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(domain)) continue;
  // A name someone rents on a shared platform ("x.github.io") is that person's, not the platform's: only names that
  // are their own registrable domain, and no platform's, are kept.
  const p = analyze(`https://${domain}/`);
  if (p && !p.isIp && !p.hosting && p.registrable === domain && !platform(domain)) out.push(domain);
  else dropped.push(domain);
}
const header = [
  '# The most linked-to sites on the web, for url.isWellKnown. Made by scripts/wellknown.js; do not edit by hand.',
  '# Source: the Majestic Million, https://majestic.com/reports/majestic-million',
  '# Licence: Creative Commons Attribution 3.0 (CC BY 3.0). Domain names by Majestic.',
  '# Left out: shared platforms named by the Public Suffix List (https://publicsuffix.org, MPL 2.0).',
  `# List date: ${DATE}. Top ${TOP} by global rank, ${out.length} kept, ordered by rank.`
];
fs.writeFileSync(OUT, `${header.join('\n')}\n${out.join('\n')}\n`);
fs.writeFileSync(`${OUT}.dropped`, `${dropped.join('\n')}\n`);
console.log(`${out.length} of the top ${TOP} written to ${OUT}`);
