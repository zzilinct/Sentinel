'use strict';
/**
 * anchor-replay  Real links from real pages, through the check that flags a link showing one site and opening
 *                another (server/lib/scan/url.js shownVersusReal, the scanner's X02 and email's E10). The front pages
 *                of the most linked-to sites (wellknown.txt) and pages full of outside links (encyclopedia articles,
 *                link aggregators, documentation) are fetched here, in CI, and every link to another site is
 *                compared, as the companion's and the app's hover would. Honest pages must raise nothing: each
 *                hit is printed with its words and address, for a person to judge. Written to anchor-replay.json.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, result } = require('./_shared');
const { analyze, isWellKnown, shownVersusReal } = require(path.join(ROOT, 'server', 'lib', 'scan', 'url'));

const POPULAR = new Set(fs.readFileSync(path.join(ROOT, 'server', 'lib', 'scan', 'wellknown.txt'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')));
const FRONT_PAGES = 150;
const DEEP = [
  'https://en.wikipedia.org/wiki/PayPal', 'https://en.wikipedia.org/wiki/Microsoft', 'https://en.wikipedia.org/wiki/Phishing',
  'https://en.wikipedia.org/wiki/List_of_most-visited_websites', 'https://en.wikipedia.org/wiki/Domain_name',
  'https://news.ycombinator.com/', 'https://news.ycombinator.com/news?p=2', 'https://lobste.rs/', 'https://old.reddit.com/r/technology/',
  'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a', 'https://nodejs.org/en', 'https://docs.python.org/3/',
  'https://github.com/sindresorhus/awesome', 'https://www.gov.uk/', 'https://www.usa.gov/', 'https://www.bbc.com/news',
  'https://www.theguardian.com/international', 'https://www.npr.org/', 'https://www.producthunt.com/', 'https://alternativeto.net/'
];
const MAX_BYTES = 3 * 1024 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => (ENTITIES[e.toLowerCase()] ?? (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m)));

async function page(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', Accept: 'text/html' } });
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return null;
    const html = (await res.text()).slice(0, MAX_BYTES);
    return { at: res.url || url, html };
  } catch { return null; } finally { clearTimeout(t); }
}

function anchors(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
    if (!href) continue;
    let u;
    try { u = new URL(decode(href[1] ?? href[2] ?? href[3]), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const text = decode(m[2].replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, href: u.href });
  }
  return out;
}

async function checkAnchorReplay() {
  const urls = [...[...POPULAR].slice(0, FRONT_PAGES).map((d) => `https://${d}/`), ...DEEP];
  const pages = [];
  for (let i = 0; i < urls.length; i += 8) pages.push(...await Promise.all(urls.slice(i, i + 8).map(page)));
  let read = 0;
  let compared = 0;
  const hits = [];
  for (const p of pages.filter(Boolean)) {
    read++;
    const host = new URL(p.at).hostname;
    for (const a of anchors(p.html, p.at)) {
      // As the hover does: a link within the site in front is never looked at.
      if (new URL(a.href).hostname === host) continue;
      compared++;
      const real = analyze(a.href);
      const m = shownVersusReal(a.text, a.href, Boolean(real && isWellKnown(real, POPULAR)));
      if (m) hits.push({ page: p.at, text: a.text.slice(0, 120), href: a.href.slice(0, 300), shown: m.shown, real: m.real, brand: Boolean(m.brand) });
    }
  }
  fs.writeFileSync(path.join(OUT, 'anchor-replay.json'), JSON.stringify({ pagesAsked: urls.length, pagesRead: read, compared, hits }, null, 2));
  for (const h of hits.slice(0, 40)) console.log(`  hit: "${h.text}" -> ${h.href} (on ${h.page})`);
  // Too few links read is not a pass: blocked or empty pages prove nothing.
  result('anchor-replay: real links from real pages, compared as a hover would, raise no false "shows one site, opens another"',
    read >= 100 && compared >= 5000 && hits.length === 0, `${read} of ${urls.length} pages read, ${compared} links to other sites compared, ${hits.length} flagged`);
}

module.exports = checkAnchorReplay;
