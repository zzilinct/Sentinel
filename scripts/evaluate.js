'use strict';
/**
 * Real-world accuracy check.
 *
 *   node scripts/evaluate.js [--research-safe]
 *
 * 1. Downloads today's live phishing URLs (OpenPhish) and scans them with the
 *    knowledge base EMPTY - measuring how well the checklist alone catches
 *    brand-new scams nobody has reported yet.
 * 2. Scans ~120 popular legitimate sites the same way, to measure false alarms.
 * 3. With --research-safe, researches a sample of the legitimate sites over the
 *    real network (RDAP, DNS, TLS, page content) to check research doesn't
 *    wrongly accuse them. Live phishing sites are never fetched by this script.
 *
 * Uses a throwaway database, so it never touches real data.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbFile = path.join(os.tmpdir(), `sentinel-eval-${process.pid}.db`);
process.env.DB_PATH = dbFile;
process.env.FEED_REFRESH_HOURS = '0';
process.env.NODE_ENV = process.env.NODE_ENV === 'test' ? 'development' : (process.env.NODE_ENV || 'development');

// Popular legitimate sites, shared with evaluate-modes.js.
const SAFE = require('./evaluate-sites.json');

async function main() {
  const researchSafe = process.argv.includes('--research-safe');
  require('../server/seed').run({ quiet: true });
  const engine = require('../server/lib/scan/engine');
  const ALL = ['scam', 'virus', 'malware'];

  if (process.argv.includes('--with-feeds')) {
    // With every live feed loaded, known threats are caught by knowledge; what
    // matters here is that legitimate sites are never caught in the crossfire.
    console.log('Loading live threat feeds...');
    await require('../server/lib/scan/feeds').refreshAll({ log: true });
    const fp = [];
    for (const host of SAFE) {
      for (const url of [`https://${host}/`, `https://${host}/login`, `https://${host}/help`]) {
        const v = await engine.scanUrl(url, { threats: ALL, research: false });
        if (v.overall.badge) fp.push(`${url} -> ${v.overall.label}: ${v.reasons.map((r) => r.text).join(' | ')}`);
      }
    }
    console.log(`\nLegitimate pages with live feeds loaded: false alarms ${fp.length}/${SAFE.length * 3}`);
    fp.forEach((l) => console.log(`    ${l}`));
    return;
  }

  console.log('Downloading live phishing URLs from OpenPhish...');
  const res = await fetch('https://openphish.com/feed.txt', { signal: AbortSignal.timeout(30000) });
  const phish = [...new Set((await res.text()).split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].slice(0, 300);
  console.log(`  ${phish.length} live phishing URLs\n`);

  const bucket = { none: 0, yellow: 0, orange: 0, red: 0 };
  const missed = [];
  for (const url of phish) {
    const v = await engine.scanUrl(url, { threats: ALL, research: false });
    if (!v.ok) continue;
    const badge = v.overall.badge || 'none';
    bucket[badge]++;
    if (badge === 'none') missed.push(`${v.threats.scam.score.toString().padStart(3)}  ${url.slice(0, 100)}`);
  }
  const flagged = bucket.yellow + bucket.orange + bucket.red;
  console.log('Live phishing, checklist only (no known-scam data, no research):');
  console.log(`  flagged ${flagged}/${phish.length} = ${pct(flagged, phish.length)}   (yellow ${bucket.yellow}, orange ${bucket.orange}, red ${bucket.red})`);

  const fp = [];
  for (const host of SAFE) {
    const v = await engine.scanUrl(`https://${host}/`, { threats: ALL, research: false });
    if (v.overall.badge) fp.push(`${host} -> ${v.overall.label} (${v.reasons.map((r) => r.id).join(',')})`);
  }
  console.log(`\nLegitimate sites, checklist only:`);
  console.log(`  false alarms ${fp.length}/${SAFE.length} = ${pct(fp.length, SAFE.length)}`);
  fp.forEach((l) => console.log(`    ${l}`));

  if (researchSafe) {
    const sample = SAFE.filter((_, i) => i % 4 === 0);
    const rfp = [];
    let reached = 0;
    console.log(`\nResearching ${sample.length} legitimate sites over the network...`);
    for (const host of sample) {
      const v = await engine.scanUrl(`https://${host}/`, { threats: ALL, research: true });
      if (v.research && v.research.reachable) reached++;
      if (v.overall.badge) rfp.push(`${host} -> ${v.overall.label}: ${v.reasons.map((r) => `${r.id} ${r.text}`).join(' | ')}`);
    }
    console.log(`  reachable ${reached}/${sample.length}; false alarms ${rfp.length}/${sample.length} = ${pct(rfp.length, sample.length)}`);
    rfp.forEach((l) => console.log(`    ${l}`));
  }

  if (process.argv.includes('--show-missed')) {
    console.log('\nMissed phishing URLs (scam score, url):');
    missed.slice(0, 60).forEach((l) => console.log(`  ${l}`));
  }
}

const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => { for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) { try { fs.unlinkSync(f); } catch { /* ignore */ } } });
