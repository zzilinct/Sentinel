'use strict';
/**
 * Stage 4 - research (Pro, Max and Ultimate). Gathers facts about a site from the outside:
 * who registered it and when (RDAP), whether it resolves and receives mail (DNS),
 * its certificate, where it redirects, and what the page actually contains.
 *
 * Full research is cached per request URL; registry/DNS-only research is per
 * host. Concurrent requests with the same key share one in-flight lookup.
 */
const dns = require('dns').promises;
const crypto = require('crypto');
const { db, now } = require('../db');
const { safeFetch, isPublicAddress } = require('./netguard');
const content = require('./content');
const config = require('../../config');

const CACHE_MS = 12 * 60 * 60 * 1000;
const RDAP_TIMEOUT = 6000;
const inflight = new Map();

// Test suite only: canned registration / DNS facts per host (never used outside NODE_ENV=test).
const testFacts = new Map();
function setTestFacts(host, facts) { if (config.isTest) testFacts.set(host, facts); }

const q = {
  get: db.prepare('SELECT payload, checked_at FROM research_cache WHERE host = ?'),
  set: db.prepare(`INSERT INTO research_cache (host, payload, checked_at) VALUES (?, ?, ?)
                   ON CONFLICT(host) DO UPDATE SET payload = excluded.payload, checked_at = excluded.checked_at`)
};

/* ------------------------------------------------------------------ rdap */

const rdapCache = new Map();
const rdapInflight = new Map();

// Registries refuse anonymous clients: without a User-Agent, rdap.org answers 403 to everything. (It did, from the
// first version of this file until 1.6.0: domain age never reached a verdict.)
const RDAP_HEADERS = { Accept: 'application/rdap+json', 'User-Agent': `Sentinel/${config.version || '1'} (link safety checker)` };

// IANA publishes which RDAP server answers for each ending. Asking that registry directly is quicker than going
// through a redirector, and no single middleman sees every lookup. rdap.org remains the fallback.
let bootstrap = { at: 0, byTld: null, loading: null };
async function rdapBase(registrable) {
  const fresh = bootstrap.byTld && now() - bootstrap.at < 24 * 60 * 60 * 1000;
  if (!fresh && !bootstrap.loading) {
    bootstrap.loading = (async () => {
      try {
        const res = await fetch('https://data.iana.org/rdap/dns.json', { headers: RDAP_HEADERS, signal: AbortSignal.timeout(4000) });
        const data = await res.json();
        const map = new Map();
        for (const [tlds, urls] of data.services || []) {
          const url = (urls || []).find((u) => /^https:/.test(u));
          if (url) for (const tld of tlds) map.set(String(tld).toLowerCase(), url.endsWith('/') ? url : `${url}/`);
        }
        if (map.size) bootstrap = { at: now(), byTld: map, loading: null };
      } catch { /* keep whatever we had */ } finally { bootstrap.loading = null; }
    })();
  }
  if (!bootstrap.byTld && bootstrap.loading) await bootstrap.loading;
  const tld = registrable.slice(registrable.lastIndexOf('.') + 1).toLowerCase();
  return (bootstrap.byTld && bootstrap.byTld.get(tld)) || 'https://rdap.org/';
}

async function rdap(registrable) {
  if (config.isTest) return (testFacts.get(registrable) || {}).registration || { available: false, reason: 'offline in tests' };
  const hit = rdapCache.get(registrable);
  if (hit && now() - hit.at < 24 * 60 * 60 * 1000) return hit.value;
  if (rdapInflight.has(registrable)) return rdapInflight.get(registrable);

  const job = fetchRdap(registrable);
  rdapInflight.set(registrable, job);
  try {
    return await job;
  } finally {
    rdapInflight.delete(registrable);
  }
}

async function fetchRdap(registrable) {
  let value;
  try {
    const res = await fetch(`${await rdapBase(registrable)}domain/${encodeURIComponent(registrable)}`, {
      headers: RDAP_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(RDAP_TIMEOUT)
    });
    if (res.status === 404) {
      value = { available: true, registered: false };
    } else if (!res.ok) {
      value = { available: false, reason: `rdap_http_${res.status}` };
    } else {
      const data = await res.json();
      const event = (name) => {
        const e = (data.events || []).find((ev) => ev.eventAction === name);
        return e ? Date.parse(e.eventDate) : null;
      };
      const registrar = (data.entities || [])
        .filter((e) => (e.roles || []).includes('registrar'))
        .map((e) => ((e.vcardArray || [])[1] || []).find((v) => v[0] === 'fn'))
        .filter(Boolean)
        .map((v) => v[3])[0] || null;
      value = {
        available: true,
        registered: true,
        createdAt: event('registration'),
        expiresAt: event('expiration'),
        updatedAt: event('last changed'),
        status: data.status || [],
        registrar
      };
    }
  } catch (err) {
    value = { available: false, reason: err.name === 'TimeoutError' ? 'rdap_timeout' : 'rdap_unreachable' };
  }
  // An upstream outage is not a domain fact; retry it on the next uncached scan.
  if (value.available) {
    rdapCache.set(registrable, { value, at: now() });
    if (rdapCache.size > 5000) rdapCache.delete(rdapCache.keys().next().value);
  }
  return value;
}

/* ------------------------------------------------------------------- dns */

// Multiple links often share a host, and subdomains share MX/NS records.
// These facts never replace the fresh, pinned DNS checks in netguard.
const DNS_CACHE_MS = 30_000;
const dnsCache = new Map();
const dnsInflight = new Map();

async function dnsRecord(method, host) {
  const key = `${method}:${host}`;
  const cached = dnsCache.get(key);
  if (cached && now() - cached.at < DNS_CACHE_MS) return cached.value;
  if (dnsInflight.has(key)) return dnsInflight.get(key);
  const job = dns[method](host).then(value => {
    dnsCache.set(key, { value, at: now() });
    if (dnsCache.size > 5000) dnsCache.delete(dnsCache.keys().next().value);
    return value;
  }, () => null);
  dnsInflight.set(key, job);
  try {
    return await job;
  } finally {
    dnsInflight.delete(key);
  }
}

async function dnsFacts(host, registrable) {
  if (config.isTest) return (testFacts.get(registrable) || {}).dns || { resolves: true, addresses: ['203.0.113.10'], privateAddress: false, mx: false, nameservers: [] };
  const [v4, v6, mx, ns] = await Promise.all([
    dnsRecord('resolve4', host),
    dnsRecord('resolve6', host),
    dnsRecord('resolveMx', registrable),
    dnsRecord('resolveNs', registrable)
  ]);
  const addresses = [...(v4 || []), ...(v6 || [])];
  return {
    resolves: addresses.length > 0,
    addresses: addresses.slice(0, 6),
    privateAddress: addresses.some((a) => !isPublicAddress(a)),
    mx: Boolean(mx && mx.length),
    nameservers: (ns || []).slice(0, 4)
  };
}

/* ------------------------------------------------------------ page fetch */

async function fetchPage(url) {
  try {
    const res = await safeFetch(url);
    const type = String(res.headers['content-type'] || '').toLowerCase();
    const disposition = String(res.headers['content-disposition'] || '');
    const isHtml = type.includes('html') || (!type && /^\s*</.test(res.body.subarray(0, 200).toString('utf8')));
    const page = isHtml ? content.parse(res.body.toString('utf8'), res.finalUrl) : null;
    return {
      ok: true,
      status: res.status,
      finalUrl: res.finalUrl,
      chain: res.chain,
      contentType: type,
      disposition,
      bytes: res.body.length,
      truncated: res.truncated,
      tls: res.tls,
      headers: pickHeaders(res.headers),
      page,
      // Kept only for the file scanner when the URL is a direct download.
      download: isHtml ? null : res.body
    };
  } catch (err) {
    return { ok: false, error: err.code || err.message, blocked: err.code === 'blocked_destination', chain: err.chain || [] };
  }
}

function pickHeaders(h) {
  return {
    hsts: Boolean(h['strict-transport-security']),
    csp: Boolean(h['content-security-policy']),
    xfo: Boolean(h['x-frame-options']),
    server: h.server ? String(h.server).slice(0, 60) : null
  };
}

/* ----------------------------------------------------------------- entry */

/**
 * @param {object} p parsed URL
 * @returns {Promise<object>} research facts (download buffers are never cached)
 */
/** Resolve with `fallback` if `promise` has not settled within `ms`. */
const within = (promise, ms, fallback) => (ms ? Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms).unref())]) : promise);

/**
 * `lite`     registration and DNS only: the site itself is never contacted.
 * `budgetMs` live scanning's promise: whatever has not answered by then is reported as not available.
 */
async function research(p, { lite = false, budgetMs = 0 } = {}) {
  // Page content can differ by scheme, port, path and query; fragments are local.
  const requestUrl = new URL(p.url);
  requestUrl.hash = '';
  const key = lite ? `lite:${p.host}` : `url-v2:${crypto.createHash('sha256').update(requestUrl.href).digest('hex')}`;
  const cached = q.get.get(key);
  if (cached && now() - cached.checked_at < CACHE_MS && !p.ext) {
    return { ...JSON.parse(cached.payload), cached: true };
  }
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const [registration, dnsInfo, http] = await Promise.all([
      p.isIp ? Promise.resolve({ available: false, reason: 'ip_address' }) : within(rdap(p.registrable), budgetMs, { available: false, reason: 'not answered in time' }),
      p.isIp ? Promise.resolve({ resolves: true, addresses: [p.host], privateAddress: !isPublicAddress(p.host.replace(/^\[|\]$/g, '')), mx: false, nameservers: [] }) : dnsFacts(p.host, p.registrable),
      lite ? Promise.resolve({ ok: false, error: 'the page is not opened during live scanning on this computer', chain: [], tls: null, disposition: '', contentType: '' }) : within(fetchPage(p.url), budgetMs, { ok: false, error: 'not answered in time', chain: [], tls: null, disposition: '', contentType: '' })
    ]);

    const facts = { performed: true, lite, checkedAt: now(), registration, dns: dnsInfo, http };
    // A lookup that ran out of time is not a fact about the site: do not remember it for a day.
    if (registration.reason === 'not answered in time' || http.error === 'not answered in time') return facts;
    const { download, ...cacheable } = http;
    // Downloads must be fetched again so a cache hit cannot skip their hash scan.
    // Failed and partial responses must not become twelve-hour clean results either.
    if (lite || (http.ok && http.status >= 200 && http.status < 300 && http.page && !http.truncated)) {
      q.set.run(key, JSON.stringify({ ...facts, http: { ...cacheable, page: cacheable.page ? slimPage(cacheable.page) : null } }), now());
    }
    return facts;
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

/** Keep the cache row small: the checks re-read text and html, so trim them. */
function slimPage(page) {
  return { ...page, text: page.text.slice(0, 60000), htmlLower: page.htmlLower.slice(0, 200000) };
}

module.exports = { research, setTestFacts };
