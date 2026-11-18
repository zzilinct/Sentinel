'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('every page the web app routes to is served by the server (a page missing from APP_ROUTES is a 404)', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const routes = new RegExp(server.match(/const APP_ROUTES = \/(.+)\/;/)[1]);
  const pages = [...new Set(require('./fixtures').appScript().match(/'\/app\/[a-z]+'/g))].map((p) => p.slice(1, -1));
  assert.ok(pages.length > 10, pages.join(' '));
  for (const page of pages) assert.ok(routes.test(page), `${page} is in the app but not in server/index.js APP_ROUTES`);
});

test('each page of the web app is a file of its own, fetched when it opens; the first screen loads none of them', () => {
  const js = (f) => fs.readFileSync(path.join(ROOT, 'web', 'assets', 'js', f), 'utf8');
  const app = js('app.js');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'app.html'), 'utf8');
  const exported = new Set(/const App = window\.SentinelApp = \{([^}]*)\}/.exec(app)[1].split(',').map((s) => s.trim()).filter((s) => /^\w+$/.test(s)));
  const files = JSON.parse(`{${/const FILES = \{([^}]*)\};/.exec(app)[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"')}}`);
  // What app.html loads up front: no page's own script or style.
  for (const dep of Object.values(files).flat()) assert.ok(!html.includes(`"${dep}"`), `app.html loads ${dep}, which only a page uses`);
  const routes = [...app.matchAll(/page\('(\w+)', '(\w+)'\)/g)].map((m) => [m[1], m[2]]);
  assert.ok(routes.length >= 15, 'the routes name their page files');
  const any = new Proxy(function () { return any; }, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : any), apply: () => any });
  for (const file of Object.keys(files)) {
    const src = js(`app/${file}.js`);
    for (const dep of files[file]) assert.ok(fs.existsSync(path.join(ROOT, 'web', dep)), `${dep} is missing`);
    // Every name it takes from app.js is one app.js hands over.
    for (const name of /const \{([^}]*)\} = window\.SentinelApp;/.exec(src)[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      assert.ok(exported.has(name), `app/${file}.js takes ${name}, which app.js does not hand over`);
    }
    // Run in a stand-in page, it leaves every page the routes ask of it, and no page's code is left in app.js.
    const pages = {};
    require('vm').runInNewContext(src, { window: { UI: any, SentinelApp: new Proxy({ pages }, { get: (t, k) => (k === 'pages' ? pages : any) }), SentinelRoute: any },
      document: any, localStorage: any, location: any, navigator: { userAgent: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) });
    for (const [f, fn] of routes.filter(([f]) => f === file)) {
      assert.equal(typeof pages[fn], 'function', `app/${f}.js does not leave ${fn}`);
      assert.ok(!app.includes(`function ${fn}(`), `${fn} is still in app.js`);
    }
  }
});
