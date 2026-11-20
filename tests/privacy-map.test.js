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

const { sites, fingerprintsOf } = require('./lib/request-sites');

/** The map's call-site table: one fingerprint per row, in the shape request-sites.js makes them. */
function listed() {
  const rows = [...MAP.matchAll(/^\| `([^`]+\.js)` \| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \| (.+) \|$/gm)];
  for (const r of rows) assert.ok(r[5].trim(), `docs/privacy-map.md does not say where ${r[1]} ${r[2]} goes`);
  return rows.map((r) => `${r[1]} | ${r[2]} | ${r[3]} | ${r[4]}`).sort();
}

test('privacy map: every outbound request in the code is in docs/privacy-map.md, by file, function, call and target', () => {
  const { fingerprints, bundles } = sites();
  const map = listed();
  const missing = fingerprints.filter((f) => !map.includes(f));
  const gone = map.filter((f) => !fingerprints.includes(f));
  assert.deepEqual(missing, [], 'requests the map does not list: say where each goes and why in docs/privacy-map.md, then in web/privacy.html');
  assert.deepEqual(gone, [], 'the map lists requests the code no longer makes');
  // Two sites with one fingerprint are listed twice.
  assert.equal(map.length, fingerprints.length);
  for (const [file, n] of Object.entries(bundles)) assert.match(MAP, new RegExp(`^\\| \`${file}\` \\| ${n} \\|`, 'm'), `${file} now makes ${n} requests`);
});

test('privacy map: a request moved, swapped or pointed elsewhere gets another fingerprint (the check can fail)', () => {
  const was = 'async function lookUp(host) {\n  const r = await fetch(`https://rdap.example/domain/${host}`, { headers: {} });\n  return r;\n}\n';
  const [fp] = fingerprintsOf('x.js', was);
  assert.equal(fp, 'x.js | lookUp | fetch | https://rdap.example/domain/');
  assert.notEqual(fingerprintsOf('x.js', was.replace('rdap.example', 'tracker.example'))[0], fp, 'pointed elsewhere');
  assert.notEqual(fingerprintsOf('x.js', was.replace('lookUp', 'report'))[0], fp, 'moved to another function');
  assert.notEqual(fingerprintsOf('x.js', was.replace('await fetch(', 'https.get('))[0], fp, 'swapped for another kind of call');
  // Defaults in the parameters do not hide the function, and a browser permission prompt is not a request.
  assert.equal(fingerprintsOf('y.js', 'export async function api(p, { method = "GET" } = {}) {\n  return fetch(base + p);\n}\n')[0], 'y.js | api | fetch | base');
  assert.deepEqual(fingerprintsOf('z.js', 'ext.permissions.request({ origins: [] }); new WebSocket(u); dns.promises.resolveMx(h);').map((f) => f.split(' | ')[2]), ['WebSocket', 'dns.promises.resolveMx']);
});

test('privacy: Have I Been Pwned is sent only the first 5 characters of the SHA-1 hash, and nothing else', async () => {
  const config = require('../server/config');
  const security = require('../server/lib/security');
  const asked = [];
  const realFetch = globalThis.fetch;
  const wasTest = config.isTest;
  // The password is made here, from pieces: its SHA-1 hash is worked out below and only its first 5 characters may go.
  const password = ['correct', 'horse', 'battery'].join('-');
  const sha1 = require('crypto').createHash('sha1').update(password).digest('hex').toUpperCase();
  globalThis.fetch = async (url, opts = {}) => { asked.push({ url: String(url), opts }); return { ok: true, text: async () => `${sha1.slice(5)}:3\r\n` }; };
  config.isTest = false;
  try {
    assert.equal(await security.breachedPassword(password), true, 'a match on the rest of the hash is found on our side');
  } finally {
    config.isTest = wasTest;
    globalThis.fetch = realFetch;
  }
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, `https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
  assert.equal(asked[0].opts.body, undefined, 'no body');
  assert.equal(asked[0].opts.method, undefined, 'a plain GET');
  const sent = JSON.stringify(asked[0]);
  assert.ok(!sent.includes(sha1.slice(5, 12)) && !sent.includes(password), 'neither the rest of the hash nor the password');
  assert.equal(asked[0].opts.headers['Add-Padding'], 'true', 'the answer is padded, so its size says nothing');
  assert.match(read('web/privacy.html'), /only the first 5 of the 40 characters of the password&rsquo;s SHA-1 hash, never the password or the rest of its hash/);
});

test('privacy: scan history is kept 30 days, and the policy and Settings say so', () => {
  assert.match(read('server/lib/db.js'), /DELETE FROM scan_history WHERE created_at < \?'\)\.run\(t - 30 \* day\)/);
  assert.match(read('web/privacy.html'), /<td>30 days, or until you delete it on the History page/);
  assert.match(read('web/assets/js/app/settings.js'), /hint: 'Kept for 30 days\. Delete one entry/);
});

test('privacy: Your sites says it is kept on this computer only', () => {
  assert.match(read('web/assets/js/app/settings.js'), /Your sites are learned and kept on this computer only, and never sent anywhere\./);
});

test('privacy: someone who had email protection by default is told once that it is off, and can turn it back on', () => {
  const bg = read('extension/src/background.js');
  assert.match(bg, /details\.reason === 'update' && !\('emailProtection' in chose\) \? \{ emailNoteDue: true \}/, 'only an update, only someone who never chose');
  assert.match(bg, /ext\.storage\.local\.set\(\{ emailDefaultOff: true,/, 'once: the mark is set whatever happens');
  assert.match(read('extension/src/popup.html'), /id="emailNote" role="status" hidden/);
  const popup = read('extension/src/popup.js');
  assert.match(popup, /Email checking is now off until you turn it on\./);
  assert.match(popup, /SentinelStore\.set\(\{ emailProtection: on \}\); await ext\.storage\.local\.remove\('emailNoteDue'\)/, 'either answer is saved as a choice and the note goes');
});

test('privacy page: update checks are listed with why', () => {
  assert.match(read('web/privacy.html'), /asks GitHub for updates every two hours and downloads one when there is one, so a fix for a new kind of scam or a security problem reaches you within hours/);
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
