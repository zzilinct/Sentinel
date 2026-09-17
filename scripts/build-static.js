'use strict';
/**
 * Exports web/ as a plain static site, for hosts with no Node server
 * (GitHub Pages and the like).
 *
 *   node scripts/build-static.js [--out dist-static] [--base /sentinel/]
 *
 * The marketing pages are the same files the server renders, so the static
 * copy can never drift from the real one:
 *
 *   - `<!-- @include name -->` is expanded exactly as server/lib/http.js does
 *   - root-absolute links become relative, so the site works from a subpath
 *   - extensionless routes (/pricing) become real files (pricing.html)
 *   - the demo verdicts on the home page are computed now and baked in, so
 *     the search demo, mask explorer and Spot-the-scam game still run
 *   - anything that needs the API (sign-in, live scans, the app) is marked
 *     unavailable rather than left to fail against a host that has no API
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = path.resolve(ROOT, argOf('--out', 'dist-static'));

// Pages the static build ships. The app needs accounts and the scan API, so it
// is not exported: its links point at the real site instead.
const PAGES = ['index.html', 'pricing.html', 'download.html', 'privacy.html', 'terms.html', '404.html'];
const ASSET_DIRS = ['assets/css', 'assets/js', 'assets/img', 'assets/fonts'];

/* ------------------------------------------------------------- helpers */

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function expandIncludes(file) {
  const html = fs.readFileSync(file, 'utf8');
  return html.replace(/<!--\s*@include\s+([a-z0-9-]+)\s*-->/g, (_, name) => {
    const partial = path.join(WEB, 'partials', `${name}.html`);
    return fs.existsSync(partial) ? fs.readFileSync(partial, 'utf8') : '';
  });
}

/** Routes the server serves without an extension, and their static filenames. */
const ROUTES = {
  '/': 'index.html',
  '/pricing': 'pricing.html',
  '/download': 'download.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html'
};

/** Pages that only exist with a server: point them at the live site. */
const NEEDS_SERVER = ['/app', '/login', '/signup', '/forgot', '/reset', '/connect', '/welcome'];

function rewriteLinks(html, origin, launched) {
  return html.replace(/(href|src|content)="(\/[^"]*)"/g, (whole, attr, url) => {
    // Absolute URLs into the live origin stay absolute (og:url, and so on).
    if (url.startsWith('//')) return whole;

    // Split path from query and hash, so /signup?plan=pro is still /signup.
    const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
    const pathPart = m[1];
    const tail = (m[2] || '') + (m[3] || '');
    const keep = (file) => `${attr}="${file}${tail}"`;

    // Anything under a server-only route has to reach the real site. Before
    // launch there is no server to reach, so those links are defused instead.
    if (NEEDS_SERVER.some((p) => pathPart === p || pathPart.startsWith(p + '/'))) {
      return launched ? `${attr}="${origin}${pathPart}${tail}"` : `${attr}="#" data-soon`;
    }
    if (ROUTES[pathPart]) return keep(ROUTES[pathPart]);
    if (pathPart === '' || pathPart === '/') return keep('index.html');
    // Plain files (assets, downloads) just lose the leading slash.
    return keep(pathPart.replace(/^\//, ''));
  });
}

/* --------------------------------------------------- demo data snapshot */

/**
 * Run the real scan engine over the home page's examples and bake the result
 * in, so the static site shows genuine verdicts rather than invented ones.
 */
async function demoSnapshot() {
  const demo = require('../server/routes/demo.routes');
  if (typeof demo.buildExamples !== 'function') return null;
  const data = await demo.buildExamples();

  // The home page counters quote live figures; freeze today's numbers in.
  try {
    const { db } = require('../server/lib/db');
    const { ALL_CHECKS } = require('../server/lib/scan/checklist');
    const row = db.prepare('SELECT (SELECT COUNT(*) FROM feed_hosts) + (SELECT COUNT(*) FROM feed_urls) + (SELECT COUNT(*) FROM blocklist) AS n').get();
    data.stats = { trackedThreats: row.n, checks: ALL_CHECKS.length };
  } catch { /* counters fall back to the numbers written in the markup */ }
  return data;
}


/**
 * Pre-launch pass: anything that needs a server we do not have yet becomes a
 * clearly-disabled control, and the page says why once at the top. A dead link
 * is worse than an honest one.
 */
function prelaunch(html) {
  // An anchor with no href is already inert - not focusable, not clickable -
  // so these stay <a> elements and their closing tags need no surgery.
  const inert = (attrs) => `<a ${attrs.replace(/\s*download/, '').trim()} role="link" aria-disabled="true" title="Not available until launch">`;

  // Links rewriteLinks defused, plus downloads whose files are not published
  // here (the installer is far too large for a static host).
  html = html.replace(/<a ([^>]*?)href="#" data-soon([^>]*?)>/g, (_, a, b) => inert(a + b));
  html = html.replace(/<a ([^>]*?)href="downloads\/[^"]*"([^>]*?)>/g, (_, a, b) => inert(a + b));
  // Mark them for styling, inside the existing class list.
  html = html.replace(/<a ([^>]*?)class="([^"]*)"([^>]*?)aria-disabled="true"/g, '<a $1class="$2 is-soon"$3aria-disabled="true"');

  const banner = '<div class="prelaunch" role="status">'
    + '<b>Preview.</b> Sentinel hasn&rsquo;t launched yet, so accounts, scanning and downloads aren&rsquo;t available here. '
    + 'Everything else is the real product &mdash; the verdicts on this page come from Sentinel&rsquo;s own engine.'
    + '</div>';
  // Sits in normal flow at the top of <main>, so it clears the fixed header
  // rather than hiding underneath it.
  html = html.replace(/<body(\s[^>]*)?>/, (_, attrs) => {
    const a = attrs || '';
    return a.includes('class="')
      ? `<body${a.replace(/class="([^"]*)"/, 'class="$1 has-prelaunch"')}>`
      : `<body${a} class="has-prelaunch">`;
  });
  return html.replace(/(<main[^>]*>)/, `$1\n${banner}`);
}

/* ------------------------------------------------------------- build */

async function main() {
  const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand.json'), 'utf8'));
  const origin = argOf('--origin', brand.origin).replace(/\/$/, '');
  // --launched forces the live wiring even while brand.json says otherwise.
  const launched = args.includes('--launched') || brand.launched === true;

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const dir of ASSET_DIRS) {
    const from = path.join(WEB, dir);
    if (fs.existsSync(from)) copyDir(from, path.join(OUT, dir));
  }
  for (const extra of ['manifest.webmanifest']) {
    const from = path.join(WEB, extra);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, extra));
  }
  // GitHub Pages otherwise treats leading-underscore paths as Jekyll sources.
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  let snapshot = null;
  try {
    snapshot = await demoSnapshot();
    console.log(`  demo verdicts   ${Object.keys(snapshot.serp).length} searches, ${snapshot.game.length} game links`);
  } catch (err) {
    console.warn(`  demo verdicts   skipped (${err.message})`);
  }

  const config = `/* Generated by scripts/build-static.js - do not edit. */\n` +
    `window.SENTINEL_STATIC = ${JSON.stringify({ origin, builtAt: Date.now() })};\n` +
    (snapshot ? `window.SENTINEL_DEMO = ${JSON.stringify(snapshot)};\n` : '');
  fs.mkdirSync(path.join(OUT, 'assets', 'js'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'assets', 'js', 'static.js'), config);

  for (const page of PAGES) {
    const file = path.join(WEB, page);
    if (!fs.existsSync(file)) continue;
    let html = expandIncludes(file);
    // Absolute brand URLs (og:url, og:image) point wherever this build lands.
    if (origin !== brand.origin) html = html.split(brand.origin).join(origin);
    html = rewriteLinks(html, origin, launched);
    if (!launched) html = prelaunch(html);

    // The config has to land before boot.js, the first script that reads it.
    const tag = '<script src="assets/js/static.js"></script>';
    const boot = '<script src="assets/js/boot.js"></script>';
    html = html.includes(boot) ? html.replace(boot, `${tag}\n${boot}`) : html.replace('</head>', `${tag}\n</head>`);
    fs.writeFileSync(path.join(OUT, page), html);
    console.log(`  ${page.padEnd(15)} ${(html.length / 1024).toFixed(1)} KB`);
  }

  console.log(`\nStatic site written to ${path.relative(ROOT, OUT)}/`);
  console.log(`Preview: npx serve ${path.relative(ROOT, OUT)}   (or any static server)`);
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
