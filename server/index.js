'use strict';
/**
 * Sentinel API + web app server.
 *   node server/index.js      (no dependencies to install)
 */
const http = require('http');
const path = require('path');
const config = require('./config');
const { Router, sendJson, send, serveStatic, HttpError, parseUrl } = require('./lib/http');
const security = require('./lib/security');
const { sweep, acquireLock, backupAccounts } = require('./lib/db');
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
const APP_ROUTES = /^\/app(\/(scan|threats|email|history|sites|protection|plan|security|assistants|download))?\/?$/;

function createServer() {
  const router = buildRouter();
  const headers = security.baseHeaders();

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    let url;
    try { url = parseUrl(req); } catch { send(res, 400, 'Bad request'); return; }

    for (const [k, v] of Object.entries({ ...headers, ...security.corsHeaders(req) })) res.setHeader(k, v);

    try {
      if (req.method === 'OPTIONS') { send(res, 204, null); return; }

      const isApi = url.pathname.startsWith('/api/');
      if (isApi) {
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
  backupAccounts();
  setInterval(backupAccounts, 6 * 60 * 60 * 1000).unref();

  seed.run();
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
