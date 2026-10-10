'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('every page the web app routes to is served by the server (a page missing from APP_ROUTES is a 404)', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const routes = new RegExp(server.match(/const APP_ROUTES = \/(.+)\/;/)[1]);
  const pages = [...new Set(fs.readFileSync(path.join(ROOT, 'web', 'assets', 'js', 'app.js'), 'utf8').match(/'\/app\/[a-z]+'/g))].map((p) => p.slice(1, -1));
  assert.ok(pages.length > 10, pages.join(' '));
  for (const page of pages) assert.ok(routes.test(page), `${page} is in app.js but not in server/index.js APP_ROUTES`);
});
