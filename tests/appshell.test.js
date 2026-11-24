'use strict';
// 1.21.3: the Overview arrives with its first view drawn (server/lib/appshell.js), so the largest paint does not wait on app.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { serveStatic } = require('../server/lib/http');
const appshell = require('../server/lib/appshell');

const WEB = path.join(__dirname, '..', 'web');
const read = (...p) => fs.readFileSync(path.join(WEB, ...p), 'utf8').replace(/\r\n/g, '\n');

// /app.html as the server sends it, for someone (tweak) or for nobody.
const page = (tweak) => new Promise((resolve) => {
  const res = { headersSent: false, head: null, writeHead(status, h) { this.head = h; }, end(body) { resolve({ body: String(body), head: this.head }); } };
  serveStatic(WEB, '/app.html', { headers: {}, method: 'GET' }, res, 200, tweak);
});
const SAM = { firstName: 'Sam', email: 'sam@example.com', needsTerms: false };

test('a signed-in /app carries the greeting with the name, the box and the confirm bar, in its own styles', async () => {
  const { body, head } = await page((html) => appshell.fill(html, SAM, true));
  const view = body.slice(body.indexOf('<div id="view"'), body.indexOf('</main>'));
  assert.match(view, /^<div id="view" data-tab="home"><div class="verify-bar" data-shell role="status">/, 'the bar first, as app.js puts it');
  assert.match(view, /<span data-email>sam@example\.com<\/span>/);
  assert.match(view, /<div class="view" data-shell><div class="page-title"><div><h1 data-lux="1">[\s\S]*<span data-name>Sam<\/span><\/h1><svg class="lux-rule"/);
  assert.match(view, /<form class="scanbox" data-quick action="\/app\/check" method="get">[\s\S]*<div class="scan-meta">/);
  // What is drawn before the stylesheets arrive must already be styled: the page's inline styles hold the first view's rules.
  const style = body.slice(body.indexOf('<style'), body.indexOf('</style>'));
  for (const rule of ['.page-title{', '.scanbox{', '.verify-bar{', '.greet > span{', '.lux-rule{']) assert.ok(style.includes(rule), `${rule} is in the inline styles`);
  assert.equal(head['Cache-Control'], 'private, no-store', 'a page that holds a name is never shared');
  assert.match(head.Vary, /Cookie/);
});

test('a name or address with markup, or a dollar sign, is written as text and exactly', async () => {
  const { body } = await page((html) => appshell.fill(html, { firstName: '<b>$& Sam', email: '"a"@x.test', needsTerms: false }, true));
  assert.match(body, /<span data-name>&lt;b&gt;\$&amp; Sam<\/span>/);
  assert.match(body, /<span data-email>&quot;a&quot;@x\.test<\/span>/);
  assert.doesNotMatch(body, /<b>\$&/);
});

test('no bar when none is owed; nothing drawn for an account that owes the terms, or for nobody', async () => {
  assert.doesNotMatch((await page((html) => appshell.fill(html, SAM, false))).body.replace(/<template[\s\S]*?<\/template>/g, ''), /class="verify-bar"/);
  const plain = await page(null);
  for (const [user, owed] of [[{ ...SAM, needsTerms: true }, false], [null, false]]) {
    const got = await page((html) => appshell.fill(html, user, owed));
    assert.equal(got.body, plain.body, 'the page as everyone else gets it');
    assert.notEqual(got.head['Cache-Control'], 'private, no-store');
  }
  assert.match(plain.body, /<div id="view"><\/div>/, 'app.js draws the first view');
  assert.match((await page((html) => html)).head.Vary, /Cookie/, '/app differs by who asks, so a cache must know');
});

test('the heading the server draws and the one app.js draws are the same markup, and app.js takes the server\'s over', () => {
  const html = read('app.html'), js = read('assets', 'js', 'app.js'), lux = read('assets', 'js', 'app-lux.js');
  // The rule under a heading is written in two places only because app-lux.js draws it for every other page.
  assert.equal(/<svg class="lux-rule".*?<\/svg>/.exec(html)[0], /const RULE = '(.*?)';/.exec(lux)[1]);
  assert.match(js, /\$\('\.view\[data-shell=""\]', view\)/, 'the drawn view is found while nobody has taken it');
  assert.match(js, /el\.dataset\.shell = 'kept'/);
  assert.match(js, /document\.dispatchEvent\(new Event\('sentinel:shell'\)\)/);
  assert.match(lux, /document\.addEventListener\('sentinel:shell'[\s\S]*seen\.add\(part\)[\s\S]*newPage\(null\)/, 'what is drawn is never staged to arrive again');
  assert.doesNotMatch(js, /\$\{greet\}, \$\{esc\(u\.firstName\)\}/, 'the old copy of the heading is gone');
  // The mask's room is held empty in the first view and the mask takes its place, so nothing below the heading moves when it arrives.
  assert.match(html, /<div class="lux-mask-room" aria-hidden="true"><\/div>/);
  assert.match(lux, /const room = head\.querySelector\('\.lux-mask-room'\);\s+if \(room\) room\.remove\(\);/);
  assert.match(read('assets', 'css', 'app-lux.css'), /\.lux-mask, \.lux-mask-room \{ width: clamp\(84px, 10vw, 128px\);/);
  // The heading says the hour's word before any script (boot.js), from the words the template holds.
  for (const w of ['Up late', 'Good morning', 'Good afternoon', 'Good evening']) assert.ok(html.includes(`>${w}</span>`), w);
  assert.match(read('assets', 'js', 'boot.js'), /dataset\.part = h < 5 \? 'late' : h < 12 \? 'morning' : h < 18 \? 'afternoon' : 'evening'/);
});

test('the page with a person\'s name is never kept: no-store, and the service worker never touches /app', () => {
  const sw = read('sw.js');
  // Every fetch the worker answers is under /assets/ (or the share POST): a page is never cached, so a second person on this browser cannot be shown the first one's name.
  assert.match(sw, /!url\.pathname\.startsWith\('\/assets\/'\)\) return;/);
  assert.doesNotMatch(sw, /PRECACHE = \[[^\]]*'\/app/);
  assert.doesNotMatch(sw, /cache\.put\([^)]*\/app['"\/]/);
});
