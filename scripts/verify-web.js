'use strict';
/**
 * Proves, in a real headless Chrome, what unit tests cannot: the website, the app and the companion working in a real
 * browser. Each check is one file in scripts/verify-web/ (NN-name.js, exporting one async function), run in the order
 * of its number; what they share (servers, browser launch, CDP helpers, result reporting) is in _shared.js. A new check
 * is one new file there, and touches nothing else.
 *
 *   node scripts/verify-web.js [--only site,motion,...] [--skip share,...] [--static dist-static] [--qr qr-samples] [--out verify-web]
 *
 * --only names checks by their file name without the number; by default every check runs. --skip leaves the named
 * ones out (CI runs them in a job of their own). A check that has not finished in CHECK_MINUTES (default 40) is
 * reported as a failure and the next one starts, so one stuck page cannot use up the whole job.
 *
 * Meant for CI (.github/workflows/verify-web.yml), never a person's computer. Every page is local: the sign-in sites
 * are this script's own HTTPS server, reached through --host-resolver-rules with a throwaway self-signed certificate.
 * Exits 1 if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { arg, OUT, report, result } = require('./verify-web/_shared');

const DIR = path.join(__dirname, 'verify-web');
const checks = Object.fromEntries(fs.readdirSync(DIR).filter((f) => /^\d+-[\w-]+\.js$/.test(f)).sort()
  .map((f) => [f.replace(/^\d+-|\.js$/g, ''), require(path.join(DIR, f))]));
const SKIP = arg('--skip', '').split(',');
const ONLY = arg('--only', Object.keys(checks).join(',')).split(',').filter((n) => !SKIP.includes(n));
const LIMIT_MS = Number(process.env.CHECK_MINUTES || 40) * 60000;

/* --------------------------------------------------------------------- run */

async function main() {
  for (const name of ONLY) {
    let timer;
    const limit = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`did not finish in ${LIMIT_MS / 60000} minutes`)), LIMIT_MS); });
    try { await Promise.race([checks[name](), limit]); } catch (err) { result(`${name}: the check itself could not run`, false, err.stack || err.message); } finally { clearTimeout(timer); }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const failed = report.filter((r) => !r.ok).length;
  console.log(`\n${report.length - failed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => { console.log(`FAIL  ${err.stack || err.message}`); process.exit(1); });
