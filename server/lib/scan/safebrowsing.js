'use strict';
/**
 * Google Safe Browsing v4 lookup.
 * Optional: with no API key configured every lookup resolves to "no hit" and
 * Sentinel falls back to its own lists plus heuristics.
 */
const config = require('../../config');

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map();

const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'];

function remember(url, value) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(url, { value, at: Date.now() });
  return value;
}

async function lookup(url) {
  if (!config.safeBrowsingKey) return { hit: false, skipped: true };

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const body = {
    client: { clientId: 'sentinel-scam-scan', clientVersion: '0.1.0' },
    threatInfo: {
      threatTypes: THREAT_TYPES,
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url }]
    }
  };

  try {
    const ctrl = AbortSignal.timeout(4000);
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(config.safeBrowsingKey)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl }
    );
    if (!res.ok) return { hit: false, error: `safe_browsing_http_${res.status}` };
    const data = await res.json();
    const match = data.matches && data.matches[0];
    return remember(url, match
      ? { hit: true, threatType: match.threatType, platform: match.platformType }
      : { hit: false });
  } catch (err) {
    // Never let an upstream outage break a scan; heuristics still apply.
    return { hit: false, error: err.name === 'TimeoutError' ? 'safe_browsing_timeout' : 'safe_browsing_unavailable' };
  }
}

module.exports = { lookup, enabled: () => Boolean(config.safeBrowsingKey) };
