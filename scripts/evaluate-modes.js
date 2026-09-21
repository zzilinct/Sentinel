'use strict';
/**
 * How good are the two live-scanning modes, measured the way they are used?
 *
 *   node scripts/evaluate-modes.js [--sample 120]
 *
 * The threat lists are loaded, as they are on any running Sentinel, EXCEPT the one the test addresses come from:
 * today's OpenPhish list is held out, so every phishing address here is one that the loaded lists either know
 * from somewhere else or do not know at all. That is what "a scam you meet today" looks like.
 *
 *   fast      lists + checklist + comparison
 *   delicate  the same + registry age and DNS (the "lite" research the desktop app does), inside its time budget
 *
 * Success = a phishing address is flagged, a legitimate site is not. Both halves are printed, because a single
 * percentage hides which way a scanner is wrong.
 *
 * Nothing on the lists is opened: the lists are text, and delicate asks the public registry (rdap.org) and DNS
 * about a domain name, never the site. Uses a throwaway database.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbFile = path.join(os.tmpdir(), `sentinel-modes-${process.pid}.db`);
process.env.DB_PATH = dbFile;
process.env.FEED_REFRESH_HOURS = '0';
process.env.RESEARCH_ENABLED = '0';
process.env.RESEARCH_LITE = '1';
process.env.NODE_ENV = 'development';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const SAMPLE = Number(arg('--sample', '120'));
const ALL = ['scam', 'virus', 'malware'];
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

async function main() {
  require('../server/seed').run({ quiet: true });
  const { db } = require('../server/lib/db');
  const feeds = require('../server/lib/scan/feeds');
  const engine = require('../server/lib/scan/engine');
  const SAFE = require('./evaluate-sites.json');

  console.log('Loading the public threat lists (text files of addresses)...');
  await feeds.refreshAll({ force: true });
  for (const table of ['feed_urls', 'feed_hosts']) db.prepare(`DELETE FROM ${table} WHERE source = 'openphish'`).run();
  const loaded = db.prepare('SELECT (SELECT COUNT(*) FROM feed_hosts) + (SELECT COUNT(*) FROM feed_urls) AS n').get().n;
  console.log(`  ${loaded.toLocaleString()} listed hosts and addresses loaded; OpenPhish held out\n`);

  const res = await fetch('https://openphish.com/feed.txt', { signal: AbortSignal.timeout(30000) });
  const phish = [...new Set((await res.text()).split(/\r?\n/).map((s) => s.trim()).filter((u) => /^https?:/.test(u)))].slice(0, 300);
  const legit = SAFE.map((h) => `https://${h}/`);

  const run = async (name, urls, opts, concurrency) => {
    const out = new Array(urls.length);
    let next = 0;
    const times = [];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < urls.length) {
        const i = next++;
        const t = Date.now();
        try { out[i] = await engine.scanUrl(urls[i], { threats: ALL, mode: 'live', detail: 'compact', ...opts }); } catch { out[i] = null; }
        times.push(Date.now() - t);
      }
    }));
    times.sort((a, b) => a - b);
    return { verdicts: out, median: times[times.length >> 1], p95: times[Math.floor(times.length * 0.95)] };
  };
  const report = (name, p, l) => {
    const okP = p.verdicts.filter(Boolean);
    const okL = l.verdicts.filter(Boolean);
    const caught = okP.filter((v) => v.overall.badge).length;
    const red = okP.filter((v) => v.overall.badge === 'red').length;
    const falseAlarms = okL.filter((v) => v.overall.badge);
    const success = caught + (okL.length - falseAlarms.length);
    console.log(`${name}`);
    console.log(`  phishing flagged      ${caught}/${okP.length} = ${pct(caught, okP.length)}   (${red} of them red, by a list)`);
    console.log(`  legitimate left alone ${okL.length - falseAlarms.length}/${okL.length} = ${pct(okL.length - falseAlarms.length, okL.length)}${falseAlarms.length ? `   false alarms: ${falseAlarms.map((v) => v.host).join(', ')}` : ''}`);
    console.log(`  right overall         ${success}/${okP.length + okL.length} = ${pct(success, okP.length + okL.length)}`);
    console.log(`  time per address      median ${p.median} ms, 95th percentile ${p.p95} ms\n`);
  };

  const fastP = await run('fast', phish, { research: false }, 16);
  const fastL = await run('fast', legit, { research: false }, 16);
  report(`FAST (all ${phish.length} held-out phishing addresses, ${legit.length} legitimate sites)`, fastP, fastL);

  const sampleP = phish.filter((_, i) => i % Math.max(1, Math.floor(phish.length / SAMPLE)) === 0).slice(0, SAMPLE);
  const sampleL = legit.slice(0, Math.min(legit.length, Math.round(SAMPLE / 2)));
  const delP = await run('delicate', sampleP, { research: true, budgetMs: 4500 }, 8);
  const delL = await run('delicate', sampleL, { research: true, budgetMs: 4500 }, 8);
  report(`DELICATE (a sample of ${sampleP.length} phishing addresses and ${sampleL.length} legitimate sites; registry and DNS only)`, delP, delL);
  const answered = delP.verdicts.filter((v) => v && v.research && v.research.domainAgeDays !== null && v.research.domainAgeDays !== undefined).length;
  console.log(`  the registry answered in time for ${answered}/${sampleP.length} of the phishing sample`);

  const fastSame = await run('fast', sampleP, { research: false }, 16);
  const c = fastSame.verdicts.filter((v) => v && v.overall.badge).length;
  console.log(`  the same phishing sample in fast mode: ${c}/${sampleP.length} = ${pct(c, sampleP.length)}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => {
  setTimeout(() => {
    for (const suffix of ['', '-wal', '-shm', '.lock', '.backup']) { try { fs.unlinkSync(dbFile + suffix); } catch { /* fine */ } }
    const f = dbFile.replace(/\.db$/, '-feeds.db');
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(f + suffix); } catch { /* fine */ } }
    process.exit();
  }, 300);
});
