'use strict';
/**
 * Does each address in scripts/evaluate-freehost.json exist? Run on GitHub's machines only (evaluate.yml), never on a
 * person's computer. These are honest sites: an address counts when a plain request for its front page is answered with
 * a page (2xx after redirects). A free host answers an unknown name with 404 or a "not found" page, so a name from
 * memory that was never a real project drops out. scripts/evaluate-freehost-shapes.json is not checked: it holds made-up
 * names in the platforms' own preview shapes, kept to score, never claimed to exist.
 *
 *   node scripts/evaluate-freehost-check.js     prints survivors and the dead; exits 1 when any address is dead
 */
const urls = require('./evaluate-freehost.json');

async function alive(u) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Sentinel-evaluation-check' } });
      if (r.status >= 200 && r.status < 300) return true;
      if (r.status === 404 || r.status === 410) return false;
    } catch { /* retry once */ }
  }
  return false;
}

(async () => {
  const ok = await Promise.all(urls.map(alive));
  const dead = urls.filter((u, i) => !ok[i]);
  console.log(`FREE-HOST HONEST SET: ${urls.length - dead.length}/${urls.length} resolve`);
  for (const u of dead) console.log(`  dead: ${u}`);
  process.exitCode = dead.length ? 1 : 0;
})();
