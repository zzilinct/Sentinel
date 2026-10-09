'use strict';
/**
 * Sentinel API + web app server.
 *   node server/index.js      (no dependencies to install)
 */
const http = require('http');
const path = require('path');
const config = require('./config');
// Before anything opens the database: opening it can mean minutes of migration, and that must be covered too.
require('./lib/dblock').claim();
const { Router, sendJson, send, serveStatic, HttpError, parseUrl } = require('./lib/http');
const security = require('./lib/security');
const { sweep, acquireLock, backupAccounts, resetFeeds } = require('./lib/db');
const seed = require('./seed');
const feeds = require('./lib/scan/feeds');

function buildRouter() {
  const router = new Router();
  require('./routes/auth.routes').register(router);
  require('./routes/account.routes').register(router);
  require('./routes/scan.routes').register(router);
  require('./routes/ai.routes').register(router);
  require('./routes/demo.routes').register(router);
  return router;
}

// Clean URLs for the app shell: /app/scan, /app/settings ... all serve app.html.
const APP_ROUTES = /^\/app(\/(scan|week|threats|email|text|history|sites|protection|plan|security|assistants|download|checkup|recover))?\/?$/;

function createServer() {
  const router = buildRouter();
  const headers = security.baseHeaders();

  // Served only to this computer (the desktop app, development): a web page can point a name of its own at 127.0.0.1
  // (DNS rebinding) and read this server as if it were its own site. Only requests addressed to this computer by
  // name are answered.
  const localOnly = ['127.0.0.1', '::1', 'localhost'].includes(config.host);
  // A server behind a proxy on the same machine is reached by the site's own name, which is also this server.
  const publicHost = (() => { try { return new URL(config.publicOrigin).host.toLowerCase(); } catch { return ''; } })();
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    if (localOnly) {
      const port = req.socket.localPort;
      const host = String(req.headers.host || '').toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && host !== `[::1]:${port}` && host !== publicHost) { send(res, 421, 'Misdirected request'); return; }
    }
    let url;
    try { url = parseUrl(req); } catch { send(res, 400, 'Bad request'); return; }

    for (const [k, v] of Object.entries({ ...headers, ...security.corsHeaders(req) })) res.setHeader(k, v);

    try {
      if (req.method === 'OPTIONS') { send(res, 204, null); return; }

      const isApi = url.pathname.startsWith('/api/');
      if (isApi) {
        // For uptime monitors and the container health check: answers only when the accounts database does.
        if (url.pathname === '/api/v1/health') {
          require('./lib/db').db.prepare('SELECT count(*) AS n FROM users').get();
          sendJson(res, 200, { ok: true }, { 'Cache-Control': 'no-store' });
          return;
        }
        security.rateLimit(`api:${security.clientIp(req)}`, 600, 60 * 1000);
        security.assertSameOrigin(req);
        const route = router.match(req.method, url.pathname);
        if (!route) throw new HttpError(404, 'not_found', `No API route for ${req.method} ${url.pathname}`);
        req.params = route.params;
        await route.handler(req, res);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');

      if (APP_ROUTES.test(url.pathname)) {
        serveStatic(config.webDir, '/app.html', req, res);
        return;
      }
      if (serveStatic(config.webDir, url.pathname, req, res)) return;
      if (!serveStatic(config.webDir, '/404.html', req, res, 404)) send(res, 404, 'Not found');
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(`[error] ${req.method} ${url.pathname}`, err);
      const { closeConnection, ...extra } = err.extra || {};
      const retry = extra.retryAfter ? { 'Retry-After': String(extra.retryAfter) } : {};
      if (closeConnection) retry.Connection = 'close';
      if (!res.headersSent) {
        sendJson(res, status, {
          error: {
            code: err.code && typeof err.code === 'string' && status < 500 ? err.code : status >= 500 ? 'internal_error' : 'error',
            message: status >= 500 ? 'Something went wrong on our end. Please try again.' : err.message,
            ...extra
          }
        }, retry);
      } else {
        res.destroy();
      }
    } finally {
      if (process.env.SENTINEL_LOG === '1') console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });

  // Slow-loris and resource-exhaustion limits.
  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 60;
  server.maxRequestsPerSocket = 1000;
  return server;
}

function start() {
  // One server per database, and a verified copy of the accounts file before
  // anything else happens to it.
  acquireLock();
  // Nothing fails silently. A stray rejected promise is logged and the server carries on; an uncaught exception
  // leaves the process in an unknown state, so it is logged and the process exits for the container to restart.
  process.on('unhandledRejection', (err) => console.error('[crash] unhandled rejection', err));
  process.on('uncaughtException', (err) => { console.error('[crash] uncaught exception', err); process.exit(1); });
  backupAccounts();
  setInterval(backupAccounts, 6 * 60 * 60 * 1000).unref();

  try {
    seed.run();
  } catch (err) {
    // The accounts file was checked when it was opened; damage found now is in the threat-list cache, which is
    // only a cache. A damaged cache found without a cut-off refresh behind it used to stop every start here,
    // for good: throw it away, let it download again, and seed once more.
    if (!/malformed|not a database|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(`${err && err.code} ${err && err.message}`)) throw err;
    resetFeeds(`was damaged (${err.message})`);
    seed.run();
  }
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
  feeds.start();

  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log('');
    console.log(`  ${config.brand.name}  -  real-time scam, virus & malware protection`);
    console.log('  -------------------------------------------------------------');
    console.log(`  site      ${config.publicOrigin}`);
    console.log(`  brand     ${config.brand.origin}`);
    console.log(`  database  ${path.relative(config.root, config.dbPath)}`);
    console.log(`  google    ${config.google.enabled ? 'enabled' : 'not configured (email sign-in works)'}`);
    console.log(`  billing   ${config.billingMode}`);
    console.log('');
  });

  // Local development: "localhost" often resolves to ::1 first, so answer there
  // too instead of making every request wait for the IPv4 fallback.
  let loopback6 = null;
  if (config.host === '127.0.0.1') {
    loopback6 = createServer();
    loopback6.on('error', () => { /* IPv6 unavailable - IPv4 still works */ });
    loopback6.listen(config.port, '::1');
  }

  const shutdown = () => {
    if (loopback6) loopback6.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start();

module.exports = { createServer, start };
