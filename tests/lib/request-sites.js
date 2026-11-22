'use strict';
/**
 * Every outbound request site in the code, as a fingerprint: the file, the function it sits in, the call, and its
 * target (the URL constant up to its first variable part, or the expression the address comes from). A request
 * swapped for another one, moved to another function or pointed somewhere else changes its fingerprint.
 * tests/privacy-map.test.js holds these against docs/privacy-map.md.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['desktop/src', 'extension/src', 'server', 'web/assets/js'];
// background.firefox.js is built from background.js and lib/api.js (scripts/build-extension.js), which are read.
// mask3d.js is the three.js build (scripts/mask3d): its loaders fetch the site's own models, and its minified names
// change with every build, so it is held by its count of calls instead.
const SKIP = /background\.firefox\.js$/;
const BUNDLES = /web\/assets\/js\/mask3d\.js$/;

// What counts as a request out: fetch, http(s).get/request (also through a chosen library: lib.request), a DNS
// lookup, a WebSocket, a beacon, XMLHttpRequest, and the updater's check. Not the browser's permission prompt.
const CALL = /\bfetch\(|\b[\w$]+\.request\(|\bhttps?\.get\(|new WebSocket\(|\bsendBeacon\(|new XMLHttpRequest\(|\b[\w$]+\.checkForUpdates\(|\bdns(?:\.promises)?\.\w+\(|\bdns\[\w+\]\(/g;
const NOT_A_REQUEST = /^permissions\.request\($/;
// Where a function starts: a declaration, an arrow or function assigned to a name, an object or class method.
const FN = /(?:function\s*\*?\s*([\w$]+)\s*\()|(?:(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[\w$]+\s*=>))|(?:^[ \t]*(?:async\s+)?['"]?([\w$:-]+)['"]?\s*\([^()\n]*\)\s*\{)|(?:router\.(?:get|post)\('([^']+)')/gm;

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function']);
/** Where the bracket that opens at `open` closes. Brackets in strings are counted too: good enough, the same every run. */
function closing(src, open, a = '{', b = '}') {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === a) depth++;
    else if (src[i] === b && --depth === 0) return i;
  }
  return src.length;
}

/** Where a function's body opens, past its parameters (whose defaults may hold braces); -1 for an arrow's expression. */
function bodyOpen(src, m) {
  const end = m.index + m[0].length;
  if (m[0].endsWith('{')) return end - 1;
  let p = m[0].endsWith('(') ? closing(src, end - 1, '(', ')') + 1 : end;
  while (/\s/.test(src[p] || '')) p++;
  if (src.startsWith('=>', p)) { p += 2; while (/\s/.test(src[p] || '')) p++; }
  return src[p] === '{' ? p : -1;
}

/** The innermost named function whose body holds `at`. */
function enclosing(src, at) {
  let name = '(top level)';
  FN.lastIndex = 0;
  for (let m; (m = FN.exec(src)) && m.index < at;) {
    const n = m[1] || m[2] || m[3] || m[4];
    if (!n || KEYWORDS.has(n)) continue;
    const open = bodyOpen(src, m);
    if (open !== -1 && open < at && closing(src, open) > at) name = n;
  }
  return name;
}

function target(args) {
  const s = args.trimStart();
  const q = s[0];
  if (q === "'" || q === '"' || q === '`') {
    const end = s.indexOf(q, 1);
    const lit = s.slice(1, end < 0 ? undefined : end);
    return lit.split(/\$\{|\?/)[0] || lit.slice(0, 40);
  }
  if (s[0] === ')') return '(none)';
  return (/^[\w$.[\]]+/.exec(s) || [''])[0] || '?';
}

/** The request sites in one file's source, as fingerprints. */
function fingerprintsOf(file, src) {
  const out = [];
  CALL.lastIndex = 0;
  for (let m; (m = CALL.exec(src));) {
    const call = m[0].replace(/^new /, '');
    if (NOT_A_REQUEST.test(call)) continue;
    out.push(`${file} | ${enclosing(src, m.index)} | ${call.replace(/\($/, '')} | ${target(src.slice(m.index + m[0].length, m.index + m[0].length + 200))}`);
  }
  return out;
}

function sites() {
  const fingerprints = [];
  const bundles = {};
  for (const dir of DIRS) {
    for (const file of walk(dir).filter((f) => f.endsWith('.js') && !SKIP.test(f))) {
      const found = fingerprintsOf(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
      if (BUNDLES.test(file)) { if (found.length) bundles[file] = found.length; } else fingerprints.push(...found);
    }
  }
  return { fingerprints: fingerprints.sort(), bundles };
}

module.exports = { sites, fingerprintsOf };

if (require.main === module) {
  const { fingerprints, bundles } = sites();
  for (const f of fingerprints) console.log(f);
  console.log(bundles);
}
