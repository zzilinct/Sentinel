'use strict';
/**
 * The frozen phishing sample (scripts/evaluate-phish.frozen.txt) is kept defanged, so no complete attack address sits
 * in the repository or on anyone's computer as a clickable link: the scheme reads hxxp and every dot is [.].
 * The evaluation turns an entry back into an address in memory only, to score it. Both directions are plain text
 * rules, so a line that is already a normal address, or already defanged, comes out the same.
 */
const crypto = require('crypto');

const defang = (u) => String(u).replace(/^http/i, 'hxxp').replace(/\./g, '[.]');
const refang = (s) => String(s).trim().replace(/^hxxp/i, 'http').replace(/\[\.\]/g, '.');

/** The addresses in a file's text, back as addresses: one per line, those that are not web addresses dropped, no repeats. */
function parse(text) {
  return [...new Set(String(text).split(/\r?\n/).map(refang).filter((u) => /^https?:/.test(u)))];
}

/** A short name for a sample, so two reports can show they scored the same addresses. */
const sampleId = (urls) => crypto.createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12);

module.exports = { defang, refang, parse, sampleId };
