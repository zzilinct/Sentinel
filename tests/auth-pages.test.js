'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { serveStatic } = require('../server/lib/http');
const config = require('../server/config');

const WEB = path.join(__dirname, '..', 'web');
const read = (...p) => fs.readFileSync(path.join(WEB, ...p), 'utf8').replace(/\r\n/g, '\n');
const SHELL = ['login', 'signup', 'forgot', 'reset', 'verify', 'connect'];

// Serves a page as the server does, with Google sign-in on or off.
const page = (url, google) => new Promise((resolve) => {
  const saved = [config.google.clientId, config.google.clientSecret];
  config.google.clientId = config.google.clientSecret = google ? 'x' : '';
  const res = { headersSent: false, writeHead() {}, end(body) { resolve(String(body)); } };
  serveStatic(WEB, url, { headers: {}, method: 'GET' }, res);
  [config.google.clientId, config.google.clientSecret] = saved;
});

test('a server without Google sign-in never sends the button or its "or"; a server with it sends them in the page', async () => {
  for (const url of ['/login', '/signup']) {
    const off = await page(url, false);
    assert.doesNotMatch(off, /data-google|class="divider"/, url);
    assert.match(await page(url, true), /data-google[\s\S]*class="divider"/, url);
    assert.match(await page(url, false), /<form data-form/, `${url} still has its form`);
  }
  assert.doesNotMatch(read('assets', 'js', 'auth.js'), /auth\/config|not set up|not configured/);
});

test('every sign-in page shares one shell: the mask, the name, no style attributes, no second logo', () => {
  for (const name of SHELL) {
    const html = read(`${name}.html`);
    assert.match(html, /class="auth"[\s\S]*@include auth-art[\s\S]*id="main"/, `${name}: the stage comes before the form, so a phone shows it first`);
    assert.doesNotMatch(html, /\sstyle="/, `${name}: style attribute`);
    assert.doesNotMatch(html, /class="logo"/, `${name}: a second name beside the stage`);
  }
  const art = read('partials', 'auth-art.html');
  assert.match(art, /<img class="auth__mask" src="\/assets\/img\/masks\/onyx\.webp"/);
  assert.match(art, /<a class="auth__word" href="\/"/);
  assert.ok(fs.existsSync(path.join(WEB, 'assets', 'img', 'masks', 'onyx.webp')));
  for (const script of ['auth.js', 'reset.js', 'connect.js']) assert.doesNotMatch(read('assets', 'js', script), /style="/, script);
});

test('the old art is gone and the stage does not move at rest', () => {
  const css = read('assets', 'css', 'app.css');
  assert.doesNotMatch(css, /\.orbit/);
  const stage = css.slice(css.indexOf('auth pages */'), css.indexOf('.strength {'));
  assert.doesNotMatch(stage, /animation\s*:/, 'nothing on the sign-in pages animates by itself');
});

test('sign-in buttons can be pressed from the start: boot.js holds a press until the form\'s script is ready', () => {
  for (const [file, script] of [['login', 'auth.js'], ['signup', 'auth.js'], ['forgot', 'reset.js'], ['reset', 'reset.js']]) {
    assert.doesNotMatch(read(`${file}.html`), /<button[^>]*disabled/, file);
    assert.match(read('assets', 'js', script), /formReady\(form\)/, script);
  }
  const boot = read('assets', 'js', 'boot.js');
  assert.match(boot, /'\.auth form\[data-form\]'/);
  assert.match(boot, /One moment/);
  assert.match(boot, /did not finish loading/);
  assert.match(read('partials', 'head.html'), /<script src="\/assets\/js\/boot\.js"><\/script>/, 'boot.js runs before the form is on the page');
});

test('an empty field\'s edge stands 3:1 against the page in both themes', () => {
  const css = read('assets', 'css', 'sentinel.css');
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const luminance = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const dark = css.slice(css.indexOf(':root {'), css.indexOf('color-scheme: dark'));
  const light = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf('color-scheme: light', css.indexOf(':root[data-theme="light"]')));
  for (const block of [dark, light]) {
    const page = hex(block.match(/--bg: (#\w{6})/)[1]);
    const fill = hex(block.match(/--field-bg: (#\w{6})/)[1]);
    const [, r, g, b, a] = block.match(/--field-ring: rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/).map(Number);
    const edge = [r, g, b].map((v, i) => v * a + fill[i] * (1 - a));
    const [hi, lo] = [luminance(edge), luminance(page)].sort((x, y) => y - x);
    assert.ok((hi + 0.05) / (lo + 0.05) >= 3, `edge ${edge} on ${page}: ${(hi + 0.05) / (lo + 0.05)}`);
  }
  const app = read('assets', 'css', 'app.css');
  const last = app.lastIndexOf('.input, .textarea {');
  assert.match(app.slice(last, app.indexOf('}', last)), /inset 0 0 0 1px var\(--field-ring\)/);
  assert.ok(last > app.indexOf('.scanbox, .input, .textarea'), 'no later rule takes the edge off again');
});
