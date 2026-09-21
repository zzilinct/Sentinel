'use strict';
/**
 * Outbound network guard for research fetches.
 *
 * Research requests go to URLs chosen by users (i.e. potentially attackers), so
 * every hop is checked: http/https only, ports 80/443 only, and the *resolved*
 * IP must be public. The validated address is pinned into the socket via a
 * custom `lookup`, which closes the DNS-rebinding gap between check and connect.
 */
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const config = require('../../config');

const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 8000;

/* ----------------------------------------------------------- address rules */

function ipv4ToInt(ip) {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32]
].map(([base, bits]) => ({ base: ipv4ToInt(base), mask: bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0 }));

function isPrivateV4(ip) {
  const n = ipv4ToInt(ip);
  return V4_BLOCKED.some(({ base, mask }) => ((n & mask) >>> 0) === ((base & mask) >>> 0));
}

function isPrivateV6(ip) {
  if (ip.includes('%')) return true; // interface-scoped addresses are not public research targets
  // URL canonicalization also converts dotted IPv4 tails to hexadecimal.
  // Compare numeric words so compressed, expanded and mapped spellings agree.
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const halves = canonical.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(s => parseInt(s, 16));
  if (words.slice(0, 5).every(n => n === 0) && words[5] === 0xffff) {
    return isPrivateV4([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.'));
  }
  // Only ordinary global unicast; exclude local, NAT64, multicast and reserved space.
  if ((words[0] & 0xe000) !== 0x2000) return true;
  if (words[0] === 0x2001 && words[1] < 0x200) return true; // special-purpose /23, including Teredo
  if (words[0] === 0x2001 && words[1] === 0xdb8) return true; // documentation
  if (words[0] === 0x2002) return true; // 6to4 can embed private IPv4 destinations
  if (words[0] === 0x3fff && words[1] < 0x1000) return true; // documentation /20
  return false;
}

function isPublicAddress(ip) {
  if (config.researchAllowPrivate) return true;
  const family = net.isIP(ip);
  if (family === 4) return !isPrivateV4(ip);
  if (family === 6) return !isPrivateV6(ip);
  return false;
}

function allowedPort(u) {
  if (config.researchAllowPrivate) return true;
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return port === '80' || port === '443';
}

class BlockedError extends Error {
  constructor(message) { super(message); this.code = 'blocked_destination'; }
}

/** DNS lookup that refuses to hand non-public addresses to the socket. */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const safe = addresses.filter((a) => isPublicAddress(a.address));
    if (!safe.length || safe.length !== addresses.length) {
      return callback(new BlockedError(`Refusing to connect to a private or reserved address for ${hostname}`));
    }
    if (options && options.all) return callback(null, safe);
    callback(null, safe[0].address, safe[0].family);
  });
}

/* ------------------------------------------------------------------ fetch */

function requestOnce(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new BlockedError('Invalid URL')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new BlockedError('Only http and https can be researched'));
    if (!allowedPort(u)) return reject(new BlockedError('Only ports 80 and 443 can be researched'));
    if (u.username || u.password) return reject(new BlockedError('URLs with embedded credentials are not fetched'));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && !isPublicAddress(u.hostname.replace(/^\[|\]$/g, ''))) {
      return reject(new BlockedError('Refusing to connect to a private or reserved address'));
    }

    let lib = u.protocol === 'https:' ? https : http;
    let target = u;
    const extraHeaders = {};
    // Test suite only: route every research request to the local fixture server.
    if (config.researchAllowPrivate && process.env.RESEARCH_TEST_PORT) {
      lib = http;
      target = new URL(`http://127.0.0.1:${process.env.RESEARCH_TEST_PORT}${u.pathname}${u.search}`);
      extraHeaders.Host = u.host;
    }
    const started = Date.now();
    const req = lib.request(target, {
      method,
      lookup: guardedLookup,
      timeout: TIMEOUT_MS,
      rejectUnauthorized: false,            // we inspect the certificate instead of failing
      servername: net.isIP(u.hostname) ? undefined : u.hostname,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 SentinelScan/1.0',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        ...extraHeaders,
        ...headers
      }
    }, (res) => {
      const tls = collectTls(res.socket, u.hostname);
      const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      // Pages are only read far enough to analyse them; file downloads are read
      // in full (up to the file scanner's limit) so their fingerprints can match.
      const type = String(res.headers['content-type'] || '').toLowerCase();
      const isPage = !type || /html|text\/|json|xml|javascript/.test(type);
      const limit = isPage ? MAX_BYTES : MAX_DOWNLOAD_BYTES;
      const chunks = [];
      let size = 0;
      let truncated = false;
      stream.on('data', (c) => {
        if (truncated) return;
        size += c.length;
        if (size > limit) {               // also caps decompression bombs
          truncated = true;
          chunks.push(c.subarray(0, c.length - (size - limit)));
          res.destroy();
          stream.destroy();
          finish();
          return;
        }
        chunks.push(c);
      });
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve({
          url: u.href,
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          truncated,
          tls,
          ms: Date.now() - started
        });
      };
      stream.on('end', finish);
      const incomplete = (err) => {
        if (done) return;
        truncated = true;
        if (chunks.length) finish();
        else { done = true; reject(err || new Error('Response ended before its body was read')); }
        res.destroy();
        stream.destroy();
      };
      stream.on('close', () => { if (!done) incomplete(); });
      stream.on('error', incomplete);
      // A compressed response can abort before its decoder receives an end event.
      if (stream !== res) res.on('error', incomplete);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Research request timed out'), { code: 'timeout' })));
    req.on('error', reject);
    req.end();
  });
}

function collectTls(socket, hostname) {
  if (!socket || typeof socket.getPeerCertificate !== 'function') return null;
  try {
    const cert = socket.getPeerCertificate();
    if (!cert || !cert.valid_to) return { present: false };
    const san = String(cert.subjectaltname || '').split(',').map((s) => s.trim().replace(/^DNS:/, '').toLowerCase());
    const covers = san.some((name) => name === hostname || (name.startsWith('*.') && hostname.endsWith(name.slice(1)) && hostname.split('.').length === name.split('.').length));
    return {
      present: true,
      authorized: socket.authorized,
      error: socket.authorizationError ? String(socket.authorizationError) : null,
      issuer: cert.issuer && (cert.issuer.O || cert.issuer.CN) || null,
      selfSigned: Boolean(cert.issuer && cert.subject && cert.issuer.CN === cert.subject.CN && cert.issuer.O === cert.subject.O),
      validFrom: Date.parse(cert.valid_from),
      validTo: Date.parse(cert.valid_to),
      coversHost: covers
    };
  } catch {
    return { present: false };
  }
}

/** Fetch with manual, individually validated redirects. */
async function safeFetch(url, options = {}) {
  const chain = [];
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(current, options);
    chain.push({ url: res.url, status: res.status });
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, res.url).href;
      continue;
    }
    return { ...res, chain, finalUrl: res.url };
  }
  throw Object.assign(new Error('Too many redirects'), { code: 'too_many_redirects', chain });
}

module.exports = { safeFetch, isPublicAddress };
