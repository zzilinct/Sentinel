'use strict';
/**
 * Threat kinds: what sort of scam, virus or malware the evidence points at.
 *
 * A mask says which family (scam, virus, malware) and how sure Sentinel is
 * (colour). The kind says what it actually is - a fake login page, a parcel
 * fee lure, a program dressed up as a PDF, a fake browser update - so the
 * result is recognisable at a glance and the icon can match.
 *
 * Kinds are derived only from evidence that was actually found: failed or
 * warned checks, confirmed feed categories, and matched scam kits. The most
 * specific kind with evidence wins. No evidence, no kind.
 */

const KINDS = {
  /* ------------------------------------------------------------- scam */
  phishing:      { threat: 'scam', label: 'Fake login page',        short: 'Fake login' },
  crypto:        { threat: 'scam', label: 'Crypto wallet drainer',   short: 'Crypto drainer' },
  delivery:      { threat: 'scam', label: 'Parcel fee lure',         short: 'Parcel lure' },
  support:       { threat: 'scam', label: 'Tech support scam',       short: 'Tech support' },
  prize:         { threat: 'scam', label: 'Prize or giveaway bait',  short: 'Prize bait' },
  store:         { threat: 'scam', label: 'Fake online store',       short: 'Fake store' },
  government:    { threat: 'scam', label: 'Fake government service', short: 'Fake gov' },
  investment:    { threat: 'scam', label: 'Investment scam',         short: 'Investment' },
  romance:       { threat: 'scam', label: 'Romance scam',            short: 'Romance' },
  impersonation: { threat: 'scam', label: 'Brand impersonation',     short: 'Impersonation' },
  address:       { threat: 'scam', label: 'Suspicious address',      short: 'Suspicious' },
  /* ------------------------------------------------------------ virus */
  disguised:     { threat: 'virus', label: 'Program disguised as a document', short: 'Disguised program' },
  macro:         { threat: 'virus', label: 'Macro-enabled document', short: 'Macro document' },
  archive:       { threat: 'virus', label: 'Archive hiding a program', short: 'Archive' },
  program:       { threat: 'virus', label: 'Unexpected program download', short: 'Program download' },
  sample:        { threat: 'virus', label: 'Known malicious file',   short: 'Known file' },
  /* ---------------------------------------------------------- malware */
  fake_update:   { threat: 'malware', label: 'Fake browser update',  short: 'Fake update' },
  paste_command: { threat: 'malware', label: '"Paste this command" lure', short: 'Paste-command' },
  miner:         { threat: 'malware', label: 'Hidden cryptominer',   short: 'Cryptominer' },
  notification:  { threat: 'malware', label: 'Notification trap',    short: 'Notification trap' },
  hidden:        { threat: 'malware', label: 'Hidden or obfuscated code', short: 'Hidden code' },
  drop:          { threat: 'malware', label: 'Malware drop site',    short: 'Drop site' },
  known:         { threat: 'malware', label: 'Known malware site',   short: 'Known malware' },
  stealer:       { threat: 'malware', label: 'Credential-stealing program', short: 'Stealer' },
  /* ------------------------------------------------------- user rules */
  blocked:       { threat: 'scam', label: 'Blocked by you', short: 'Blocked' }
};

/**
 * Evidence that selects each kind, most specific first. `checks` are rule
 * ids that must have failed or warned; `categories` are feed/report
 * categories; `kits` match the label of a scam kit the page resembled.
 */
const RULES = {
  scam: [
    { kind: 'crypto',        checks: ['U27', 'P06'], categories: ['crypto_scam'], kits: /wallet|crypto|drainer|seed phrase/i },
    { kind: 'delivery',      checks: ['U32'], kits: /parcel|delivery|postal|customs/i },
    { kind: 'support',       checks: ['U31', 'P09'], categories: ['tech_support_scam'], kits: /support|virus alert|microsoft/i },
    { kind: 'prize',         checks: ['U26', 'P08'], kits: /prize|giveaway|winner|reward/i },
    { kind: 'store',         checks: ['U28', 'P23', 'P24', 'P25', 'P26'], categories: ['fake_store'], kits: /store|shop|clearance/i },
    { kind: 'government',    checks: ['U33'], kits: /government|tax|refund|irs|hmrc/i },
    { kind: 'investment',    categories: ['investment_scam'], kits: /invest|trading|forex/i },
    { kind: 'romance',       categories: ['romance_scam'] },
    { kind: 'phishing',      checks: ['P02', 'P03', 'P04', 'P05', 'P20', 'P22', 'U30', 'U25', 'U37', 'U41', 'U43', 'U44', 'U46', 'U47', 'U49', 'U50', 'U51', 'U52', 'U53'], categories: ['phishing'], kits: /login|sign.?in|verify|account|password|credential/i },
    { kind: 'impersonation', checks: ['U22', 'U23', 'U24', 'U40', 'P01', 'P21', 'C01', 'C02', 'C05'], categories: ['impersonation'] },
    { kind: 'address',       checks: ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U10', 'U12', 'U13', 'U18', 'U19', 'U20', 'U29', 'U38', 'U42', 'R01', 'R02', 'R08', 'R09', 'R10'] }
  ],
  virus: [
    { kind: 'sample',        checks: ['K03'], categories: ['virus', 'malware_download', 'trojan'] },
    { kind: 'disguised',     checks: ['U15'] },
    { kind: 'macro',         checks: ['U16'] },
    { kind: 'archive',       checks: ['U17'] },
    { kind: 'program',       checks: ['U14', 'P15', 'P16', 'R13'] }
  ],
  malware: [
    { kind: 'known',         checks: ['K02'], categories: ['malware'] },
    { kind: 'fake_update',   kits: /update|flash|chrome|browser/i },
    { kind: 'paste_command', checks: ['P17'], kits: /clickfix|paste|command|captcha/i },
    { kind: 'miner',         checks: ['P14', 'U35'] },
    { kind: 'notification',  checks: ['P18'] },
    { kind: 'hidden',        checks: ['P12', 'P13', 'P19', 'P27'] },
    { kind: 'drop',          checks: ['U34', 'U21', 'U11', 'R06', 'C04'] }
  ]
};

/**
 * @param {object} ctx
 * @param {Array<{id:string,status:string,threat:string}>} ctx.checks
 * @param {{matches?: Array<{threat:string,category?:string,strength?:string}>}} [ctx.know]
 * @param {{kits?: Array<{label?:string,threat?:string}>}} [ctx.comparison]
 * @param {{scam?: object, virus?: object, malware?: object}} ctx.threats  scored threats; only flagged ones get a kind
 * @returns {{scam: string|null, virus: string|null, malware: string|null}}
 */
function classify({ checks = [], know = {}, comparison = {}, threats = {} }) {
  const hit = new Set(checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => c.id));
  const categories = new Set((know.matches || []).map((m) => m.category).filter(Boolean));
  const kitLabels = (comparison.kits || []).map((k) => k.label || '').join(' | ');

  const out = { scam: null, virus: null, malware: null };
  for (const threat of Object.keys(RULES)) {
    const t = threats[threat];
    if (!t || !t.badge) continue;
    for (const rule of RULES[threat]) {
      const byCheck = (rule.checks || []).some((id) => hit.has(id));
      const byCategory = (rule.categories || []).some((c) => categories.has(c));
      const byKit = rule.kits ? rule.kits.test(kitLabels) : false;
      if (byCheck || byCategory || byKit) { out[threat] = rule.kind; break; }
    }
  }
  return out;
}

/**
 * Kind for a scanned file, from the file scanner's own checks (F01-F14 in
 * filescan.js). Most specific evidence first.
 */
const FILE_KINDS = {
  virus: [['F01', 'sample'], ['F02', 'sample'], ['F05', 'disguised'], ['F03', 'disguised'], ['F11', 'archive'], ['F04', 'program']],
  malware: [['F07', 'stealer'], ['F09', 'macro'], ['F08', 'drop'], ['F13', 'drop'], ['F14', 'hidden'], ['F10', 'hidden'], ['F06', 'hidden'], ['F12', 'hidden']]
};

function classifyFile(report, threats) {
  const hit = new Set((report.checks || []).filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => c.id));
  const out = { scam: null, virus: null, malware: null };
  for (const threat of ['virus', 'malware']) {
    if (!threats[threat] || !threats[threat].badge) continue;
    const match = FILE_KINDS[threat].find(([id]) => hit.has(id));
    out[threat] = match ? match[1] : (threat === 'virus' ? 'program' : 'hidden');
  }
  return out;
}

const describe = (id) => (id && KINDS[id]) ? { kind: id, kindLabel: KINDS[id].label, kindShort: KINDS[id].short } : { kind: null, kindLabel: null, kindShort: null };

module.exports = { KINDS, classify, classifyFile, describe };
