'use strict';
/**
 * Proof that a domain added to a brand in server/lib/scan/brands.js is really the brand's own. A wrong entry marks a
 * stranger's domain as the brand's, so its look-alike checks go quiet there. Each added domain needs one of:
 *   redirect  https://<domain>/ ends on one of the brand's domains already listed before this change
 *   link      the brand's main site links to it
 *   tls       its certificate names the same organisation as the main site's, or the main site's certificate covers it
 *   rdap      RDAP names the same registrant as the main site's, or the brand by name
 *
 *   node scripts/brand-proof.js --base <old brands.js>
 *
 * Opens sites and asks RDAP, so it runs on GitHub's machines only (.github/workflows/brand-proof.yml), never on a
 * developer's own computer. Exits 1 when any added domain has no proof.
 */
const fs = require('fs');
const path = require('path');
const tls = require('tls');

/** The domains each brand gains from `before` to `after`, with the ones it already had (the proven ones). */
function addedDomains(before, after) {
  const had = new Map();
  for (const b of before) had.set(b.token, new Set([...(had.get(b.token) || []), ...b.domains]));
  const out = [];
  for (const b of after) {
    // A brand that is new here: its first domain is its name, the rest are proven against it.
    const proven = had.get(b.token) || new Set(b.domains.slice(0, 1));
    for (const d of b.domains) if (!proven.has(d) && /\./.test(d)) out.push({ token: b.token, domain: d, proven: [...proven] });
  }
  return out;
}

const within = (host, domains) => domains.some((d) => host === d || host.endsWith(`.${d}`));
/** Does this page's HTML link to the domain (or a site under it)? */
const linksTo = (html, domain) => new RegExp(`https?://(?:[a-z0-9-]+\\.)*${domain.replace(/\./g, '\\.')}(?=[/"'?#:\\s<]|$)`, 'i').test(String(html));
/** An organisation's name as letters only ("Stripe, Inc." is "stripeinc"); privacy services are no name. */
const orgKey = (s) => {
  const k = String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return !k || /redacted|privacy|proxy|withheld|notdisclosed|dataprotected|domainsbyproxy|contactprivacy|perfectprivacy/.test(k) ? '' : k;
};
const sameOrg = (a, b, token) => Boolean(orgKey(a) && (orgKey(a) === orgKey(b) || orgKey(a).includes(token)));

async function finalHost(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (brand proof check)' } });
    return { host: new URL(res.url).hostname, html: (res.headers.get('content-type') || '').includes('html') ? await res.text() : '' };
  } catch { return { host: null, html: '' }; }
}

function cert(host) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const c = s.getPeerCertificate() || {};
      s.end();
      resolve({ org: (c.subject && c.subject.O) || '', names: String(c.subjectaltname || '').split(/,\s*/).map((n) => n.replace(/^DNS:/, '')) });
    });
    s.on('error', () => resolve({ org: '', names: [] }));
    s.on('timeout', () => { s.destroy(); resolve({ org: '', names: [] }); });
  });
}

async function registrant(domain) {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return '';
    const walk = (entities = []) => {
      for (const e of entities) {
        if ((e.roles || []).includes('registrant')) {
          const v = (e.vcardArray && e.vcardArray[1]) || [];
          const f = v.find((x) => x[0] === 'org') || v.find((x) => x[0] === 'fn');
          if (f && orgKey(f[3])) return String(f[3]);
        }
        const inner = walk(e.entities);
        if (inner) return inner;
      }
      return '';
    };
    return walk((await res.json()).entities);
  } catch { return ''; }
}

/** The first proof found for one added domain, or null. */
async function prove({ token, domain, proven }) {
  const main = proven[0];
  const to = await finalHost(`https://${domain}/`);
  if (to.host && within(to.host, proven)) return `redirect to ${to.host}`;
  const home = await finalHost(`https://${main}/`);
  if (linksTo(home.html, domain)) return `linked from ${main}`;
  const [mine, theirs] = [await cert(domain), await cert(main)];
  if (sameOrg(mine.org, theirs.org, token)) return `certificate organisation "${mine.org}"`;
  if (theirs.names.some((n) => n === domain || n === `*.${domain}`)) return `named in ${main}'s certificate`;
  const [r, rMain] = [await registrant(domain), await registrant(main)];
  if (sameOrg(r, rMain, token)) return `RDAP registrant "${r}"`;
  return null;
}

async function main() {
  const i = process.argv.indexOf('--base');
  if (i < 0) throw new Error('usage: node scripts/brand-proof.js --base <old brands.js>');
  const before = require(path.resolve(process.argv[i + 1])).BRANDS;
  const after = require('../server/lib/scan/brands').BRANDS;
  const added = addedDomains(before, after);
  const lines = [];
  let missing = 0;
  for (const a of added) {
    const proof = await prove(a);
    if (!proof) missing++;
    lines.push(`${proof ? 'proven  ' : 'UNPROVEN'} ${a.domain} (${a.token}): ${proof || 'no redirect, link, certificate or registrant ties it to the brand'}`);
  }
  const text = `${added.length} domain(s) added to brands.js\n${lines.join('\n')}\n`;
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${text}\`\`\`\n`);
  if (missing) process.exit(1);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
module.exports = { addedDomains, linksTo, orgKey, sameOrg };
