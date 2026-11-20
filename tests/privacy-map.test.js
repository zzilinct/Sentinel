'use strict';
/**
 * docs/privacy-map.md is the list of every place data can leave a person's device. A new outbound request in the
 * Windows app, its embedded server, the companion or the web app, with no line in the map's call-site table, fails here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MAP = read('docs/privacy-map.md');

// What counts as a request out: fetch, http(s).get/request (also through a chosen library: lib.request), a DNS
// lookup, a WebSocket, a beacon, XMLHttpRequest, and the updater's check. Not the browser's permission prompt.
const OUTBOUND = /\bfetch\(|(?<!permissions)\.request\(|\bhttps?\.get\(|new WebSocket\(|sendBeacon\(|XMLHttpRequest|checkForUpdates\(|\bdns(?:\.promises)?\.\w+\(|\bdns\[\w+\]\(/g;
const DIRS = ['desktop/src', 'extension/src', 'server', 'web/assets/js'];

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
}

function found() {
  const out = {};
  for (const dir of DIRS) {
    // background.firefox.js is built from background.js and lib/api.js (scripts/build-extension.js), which are counted.
    for (const f of walk(dir).filter((x) => x.endsWith('.js') && !x.endsWith('background.firefox.js'))) {
      const n = (read(f).match(OUTBOUND) || []).length;
      if (n) out[f] = n;
    }
  }
  return out;
}

function listed() {
  const out = {};
  for (const m of MAP.matchAll(/^\| `([^`]+\.js)` \| (\d+) \|/gm)) out[m[1]] = Number(m[2]);
  return out;
}

test('privacy map: every outbound request in the code is in docs/privacy-map.md, with its count', () => {
  const code = found();
  const map = listed();
  for (const [f, n] of Object.entries(code)) {
    assert.ok(f in map, `${f} makes ${n} outbound request(s) that docs/privacy-map.md does not list: say where it goes and why, then update web/privacy.html`);
    assert.equal(map[f], n, `${f} now makes ${n} outbound request(s), the map says ${map[f]}: say what changed in docs/privacy-map.md and web/privacy.html`);
  }
  for (const f of Object.keys(map)) assert.ok(f in code, `docs/privacy-map.md lists ${f}, which no longer makes a request`);
});

test('privacy map: the count catches a new request (the check can fail)', () => {
  const sample = 'await fetch(u); https.get(u); dns.promises.resolveMx(h); new WebSocket(u); ext.permissions.request({})';
  assert.equal((sample.match(OUTBOUND) || []).length, 4);
});

test('privacy: delicate scanning, which asks a registry about each site, is only ever a choice', () => {
  // The server: a client that names no mode gets fast.
  assert.match(read('server/lib/plans.js'), /let mode = wanted === 'delicate' \? 'delicate' : 'fast';/);
  // The companion: fast by default, its choice sent with every check.
  for (const f of ['extension/src/lib/api.js', 'extension/src/options.js']) assert.match(read(f), /liveMode: 'fast'/, f);
  assert.match(read('extension/src/options.html'), /<select id="liveMode"><option value="fast">Fast<\/option><option value="delicate">Delicate<\/option><\/select>/);
  const bg = read('extension/src/background.js');
  assert.equal((bg.match(/'\/api\/v1\/live\/visit', \{ method: 'POST', body: \{ url: sendable\(details\.url, isPrivate\), mode: liveMode\(settings\)/g) || []).length, 2);
  assert.match(bg, /const mode = liveMode\(settings\);/);
  // The Windows app: fast until chosen.
  assert.match(read('desktop/src/main.js'), /store\.get\('liveMode', 'fast'\)/);
});

test('privacy: the companion sends no fragment, and nothing past ? from a private window', async () => {
  const src = /const sendable = \(url, isPrivate\) => (.+);/.exec(read('extension/src/background.js'));
  assert.ok(src, 'sendable() is where an address is trimmed before it is sent');
  const sendable = new Function('url', 'isPrivate', `return ${src[1]};`);
  assert.equal(sendable('https://a.example/p?q=1#access_token=x', false), 'https://a.example/p?q=1');
  assert.equal(sendable('https://a.example/p?q=1#t', true), 'https://a.example/p');
});

test('privacy: companion email protection is off until it is turned on', () => {
  for (const f of ['extension/src/lib/api.js', 'extension/src/options.js']) assert.match(read(f), /emailProtection: false/, f);
});

test('privacy: no server log holds a visited address, a query, a message or an email address', () => {
  const caddy = read('deploy/Caddyfile');
  assert.doesNotMatch(caddy.replace(/#.*$/gm, ''), /\blog\s*\{/, 'the hosted proxy keeps no access log');
  const compose = read('deploy/docker-compose.yml');
  assert.match(compose, /max-size: 5m, max-file: "3"/);
  assert.equal((compose.match(/logging:/g) || []).length, 2, 'both services cap their logs');
  // Error lines carry the method and the path only.
  assert.match(read('server/index.js'), /console\.error\(`\[error\] \$\{req\.method\} \$\{url\.pathname\}`/);
  assert.match(read('server/routes/scan.routes.js'), /console\.error\(`\[error\] \$\{req\.method\} \$\{String\(req\.url\)\.replace\(\/\[\?#\]\.\*\$\/, ''\)\}`/);
  assert.match(read('server/index.js'), /console\.log\(`\$\{req\.method\} \$\{url\.pathname\} \$\{res\.statusCode\}/);
  assert.doesNotMatch(read('server/lib/mailer.js'), /not sent: "\$\{subject\}" to \$\{to\}/);
  // On the computer: watch.log keeps no query or fragment.
  assert.match(read('desktop/src/main.js'), /\$\{item\.label\} \$\{String\(item\.url\)\.replace\(\/\[\?#\]\.\*\$\/, ''\)\}/);
});

test('privacy: which minutes live scanning ran is kept 8 days, enough for the week it counts', () => {
  const db = read('server/lib/db.js');
  assert.match(db, /DELETE FROM live_minutes WHERE minute < \?'\)\.run\(Math\.floor\(\(t - 8 \* day\) \/ 60000\)\)/);
  assert.match(db, /DELETE FROM fast_minutes WHERE minute < \?'\)\.run\(Math\.floor\(\(t - 8 \* day\) \/ 60000\)\)/);
});

test('privacy page: no third-party script, style or font on the website', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'web')).filter((x) => x.endsWith('.html'))) {
    const html = read(`web/${f}`);
    // A canonical or alternate link only names a page; it loads nothing.
    for (const m of html.matchAll(/<(script|link|img|iframe)\b[^>]*>/g)) {
      if (/\brel="(canonical|alternate)"/.test(m[0])) continue;
      const far = /\b(?:src|href)="(?:https?:)?\/\/([^"/]+)/.exec(m[0]);
      if (far) assert.fail(`${f} loads ${far[1]}: the privacy page says the site loads nothing from anyone else`);
    }
  }
});
