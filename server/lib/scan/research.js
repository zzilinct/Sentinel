'use strict';
/**
 * Stage 4 - research (Pro and Max). Gathers facts about a site from the outside:
 * who registered it and when (RDAP), whether it resolves and receives mail (DNS),
 * its certificate, where it redirects, and what the page actually contains.
 *
 * Results are cached per host and concurrent requests for the same host share
 * one in-flight lookup, so a results page full of links costs one round of I/O.
 */
const dns = require('dns').promises;
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

async function rdap(registrable) {
  if (config.isTest) return (testFacts.get(registrable) || {}).registration || { available: false, reason: 'offline in tests' };
  const hit = rdapCache.get(registrable);
  if (hit && now() - hit.at < 24 * 60 * 60 * 1000) return hit.value;

  let value;
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(registrable)}`, {
      headers: { Accept: 'application/rdap+json' },
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
  rdapCache.set(registrable, { value, at: now() });
  if (rdapCache.size > 5000) rdapCache.clear();
  return value;
}

/* ------------------------------------------------------------------- dns */

async function dnsFacts(host, registrable) {
  if (config.isTest) return (testFacts.get(registrable) || {}).dns || { resolves: true, addresses: ['203.0.113.10'], privateAddress: false, mx: false, nameservers: [] };
  const settle = (p) => p.then((v) => v, () => null);
  const [v4, v6, mx, ns] = await Promise.all([
    settle(dns.resolve4(host)),
    settle(dns.resolve6(host)),
    settle(dns.resolveMx(registrable)),
    settle(dns.resolveNs(registrable))
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
async function research(p) {
  // Registration and DNS are per host, but page content differs per path.
  const key = `${p.host}${p.path}`.slice(0, 512);
  const cached = q.get.get(key);
  if (cached && now() - cached.checked_at < CACHE_MS && !p.ext) {
    return { ...JSON.parse(cached.payload), cached: true };
  }
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const [registration, dnsInfo, http] = await Promise.all([
      p.isIp ? Promise.resolve({ available: false, reason: 'ip_address' }) : rdap(p.registrable),
      p.isIp ? Promise.resolve({ resolves: true, addresses: [p.host], privateAddress: !isPublicAddress(p.host.replace(/^\[|\]$/g, '')), mx: false, nameservers: [] }) : dnsFacts(p.host, p.registrable),
      fetchPage(p.url)
    ]);

    const facts = { performed: true, checkedAt: now(), registration, dns: dnsInfo, http };
    const { download, ...cacheable } = http;
    q.set.run(key, JSON.stringify({ ...facts, http: { ...cacheable, page: cacheable.page ? slimPage(cacheable.page) : null } }), now());
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
