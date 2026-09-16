'use strict';
/**
 * Minimal HTTP plumbing: router, body parsing, cookies, static files with
 * compression and HTML includes. Dependency-free so `node server/index.js` just works.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.dmg': 'application/x-apple-diskimage',
  '.appimage': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:[A-Za-z0-9_]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    }) + '$');
    this.routes.push({ method, rx, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie */ }
  }
  return out;
}

function serializeCookie(name, value, opts = {}) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge != null) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  s += `; Path=${opts.path || '/'}`;
  if (opts.httpOnly !== false) s += '; HttpOnly';
  if (opts.secure) s += '; Secure';
  s += `; SameSite=${opts.sameSite || 'Lax'}`;
  return s;
}

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (tooLarge) {
        // Drain a little so the client can read our 413; cut off anything absurd.
        if (size > limit * 4) req.destroy();
        return;
      }
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'payload_too_large', 'Request body too large', { closeConnection: true }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/** Parse a JSON request body. Requires a JSON content type (blocks form-post CSRF). */
async function readJson(req, limit = 256 * 1024) {
  const type = String(req.headers['content-type'] || '');
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json');
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new HttpError(400, 'bad_json', 'Request body must be a JSON object');
  }
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  send(res, status, body, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  });
}

/* ------------------------------------------------------------ static files */

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.webmanifest']);
const compressedCache = new Map();
const htmlCache = new Map();

function compress(key, raw, encoding) {
  let body = compressedCache.get(key);
  if (!body) {
    body = encoding === 'br'
      ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
      : zlib.gzipSync(raw, { level: 9 });
    if (compressedCache.size > 300) compressedCache.clear();
    compressedCache.set(key, body);
  }
  return body;
}

/**
 * Expand `<!-- @include name -->` with web/partials/name.html. Names are
 * restricted to [a-z0-9-], so includes can never reach outside that folder.
 */
function renderHtml(base, file) {
  const partialsDir = path.join(base, 'partials');
  const stamps = [fs.statSync(file).mtimeMs];
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<!--\s*@include\s+([a-z0-9-]+)\s*-->/g, (_, name) => {
    const partial = path.join(partialsDir, `${name}.html`);
    if (!fs.existsSync(partial)) return '';
    stamps.push(fs.statSync(partial).mtimeMs);
    return fs.readFileSync(partial, 'utf8');
  });
  const version = crypto.createHash('sha1').update(`${file}|${stamps.join('|')}`).digest('hex').slice(0, 16);
  const cached = htmlCache.get(file);
  if (cached && cached.version === version) return cached;
  const entry = { version, buffer: Buffer.from(html, 'utf8') };
  if (htmlCache.size > 200) htmlCache.clear();
  htmlCache.set(file, entry);
  return entry;
}

/** Serve a file from `root`, resolving directories and extensionless paths to .html */
function serveStatic(root, urlPath, req, res, status = 200) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); } catch { send(res, 400, 'Bad request'); return true; }
  if (rel.includes('\0')) { send(res, 400, 'Bad request'); return true; }
  if (rel.endsWith('/')) rel += 'index.html';

  const base = path.resolve(root);
  let file = path.resolve(base, '.' + path.posix.normalize('/' + rel.replace(/\\/g, '/')));
  const relative = path.relative(base, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) { send(res, 403, 'Forbidden'); return true; }
  const segments = relative.split(path.sep);
  if (segments[0] === 'partials') return false;                      // only served inside pages
  if (segments.some((part) => part.startsWith('.'))) return false;   // never serve dotfiles

  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (fs.existsSync(file + '.html')) file = file + '.html';
    else if (fs.existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
    else return false;
  }

  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const longCache = /^(assets|downloads)[\\/]/.test(relative) && !/sw\.js$/.test(relative);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Accept-Encoding'
  };
  if (['.zip', '.exe', '.dmg', '.appimage'].includes(ext)) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;

  const accept = String(req.headers['accept-encoding'] || '');
  const pick = (size) => (COMPRESSIBLE.has(ext) && size > 1024 ? (/\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null) : null);
  const reply = (etag, body, encoding) => {
    if (status === 200 && req.headers['if-none-match'] === etag) { send(res, 304, null, { ETag: etag }); return true; }
    res.writeHead(status, { ...headers, ETag: etag, ...(encoding ? { 'Content-Encoding': encoding } : {}), 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };

  if (ext === '.html') {
    // Pages include partials, so the version covers every included file.
    const page = renderHtml(base, file);
    const encoding = pick(page.buffer.length);
    return reply(`W/"${page.version}"`, encoding ? compress(`${file}|${page.version}|${encoding}`, page.buffer, encoding) : page.buffer, encoding);
  }

  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  const encoding = pick(stat.size);
  if (encoding) return reply(etag, compress(`${file}|${stat.mtimeMs}|${encoding}`, fs.readFileSync(file), encoding), encoding);

  if (status === 200 && req.headers['if-none-match'] === etag) { send(res, 304, null, { ETag: etag }); return true; }
  res.writeHead(status, { ...headers, ETag: etag, 'Content-Length': stat.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
}

module.exports = { Router, parseCookies, serializeCookie, readBody, readJson, HttpError, send, sendJson, serveStatic, parseUrl, MIME };
