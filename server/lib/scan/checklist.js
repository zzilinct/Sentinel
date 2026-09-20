'use strict';
/**
 * Stage 2 (and the content half of stage 4) - the checklist.
 *
 * Every rule is a named, individually explainable check with the threat it
 * speaks to (scam, virus or malware). A check returns:
 *   fail  - adds its points to that threat
 *   warn  - adds (fewer) points
 *   pass  - checked and fine; may carry negative points as a trust signal
 *   skip  - not applicable, or needs research this scan didn't include
 * `extra` lets one finding contribute to a second threat.
 */
const L = require('./lists');
const config = require('../../config');
const { analyze, entropy, hostWords } = require('./url');

const reported = new Set();

const fail = (points, detail, extra) => ({ status: 'fail', points, detail, extra });
const warn = (points, detail, extra) => ({ status: 'warn', points, detail, extra });
const pass = (detail, points = 0) => ({ status: 'pass', points, detail });
const skip = (detail) => ({ status: 'skip', points: 0, detail });

const CREDENTIAL_WORDS = ['verify', 'verification', 'validate', 'secure', 'security', 'account', 'signin', 'login', 'logon', 'auth', 'update', 'unlock', 'suspended', 'recovery', 'recover', 'confirm', 'support', 'helpdesk', 'billing', 'invoice', 'password',
  'bank', 'banking', 'onlinebanking', 'online', 'webmail', 'mailbox', 'quota', 'owa', 'reactivate', 'deactivate', 'deactivation', 'expired', 'session', 'urgent', 'notice', 'required', 'action', 'immediately', 'attention',
  'payroll', 'salary', 'benefits', 'w2', 'enrollment', 'hr', 'docs', 'document', 'documents', 'fileshare', 'sharefile', 'portal', 'sso', 'adfs', 'authenticate', 'authentication'];
const MONEY_WORDS = ['free', 'gift', 'giftcard', 'giveaway', 'bonus', 'prize', 'winner', 'reward', 'claim', 'refund', 'cashback', 'lottery', 'survey', 'loyalty', 'win'];
const CRYPTO_WORDS = ['btc', 'eth', 'bitcoin', 'ethereum', 'crypto', 'giveaway', 'airdrop', 'presale', 'wallet', 'walletconnect', 'restore', 'seed', 'staking', 'doubler', 'elon', 'dapp', 'defi', 'sync', 'rectify', 'mint', 'nft', 'swap', 'bridge', 'kyc', 'ledger', 'trezor', 'metamask', 'phantom'];
const SHOP_WORDS = ['outlet', 'clearance', 'liquidation', 'closingdown', 'sale', 'off', 'discount', 'cheap', 'wholesale'];

/** A domain that is one plain name: no hyphens, no digits, nothing in front of it. */
const plainName = (p) => !p.isIp && !/[-\d]/.test(p.sld) && !p.subdomains.filter((s) => s !== 'www').length;

/**
 * Bait wording scores by how it is combined. One plain word that IS the whole
 * domain (support.com, wallet.com, invoice.com) is a business name, not a
 * lure, and gets a fraction; a lure is that word next to a brand, another
 * bait word, hyphens or digits.
 */
function keywordScore(words, list, cap, p) {
  const hits = list.filter((w) => words.has(w));
  let points = Math.min(cap, hits.reduce((sum, w) => sum + (L.HOST_KEYWORDS[w] || 8), 0));
  if (p && plainName(p) && /^(com|org|net|co\.uk|gov|edu|io)$/.test(p.suffix)) points = Math.min(points, 10);
  return { hits, points };
}

const page = (ctx) => ctx.research && ctx.research.http && ctx.research.http.page;
const needsResearch = (ctx) => (ctx.research ? null : skip(ctx.researchSkipReason || 'Research is not part of this scan'));

/* ======================================================================
   URL checks - run on every scan, every plan
   ====================================================================== */

const URL_CHECKS = [
  { id: 'U01', group: 'Address', threat: 'scam', title: 'Uses a real domain name, not a raw IP address',
    run: ({ p }) => {
      if (!p.isIp) return pass('Uses a domain name');
      const login = CREDENTIAL_WORDS.some((w) => p.path.toLowerCase().includes(w));
      return fail(login ? 40 : 22, login ? 'A login page on a bare IP address: no real service signs people in this way' : 'The link points at a bare IP address, which legitimate sites almost never do', { malware: 12 });
    } },

  { id: 'U02', group: 'Address', threat: 'scam', title: 'No look-alike international characters (punycode)',
    run: ({ p }) => (/(^|\.)xn--/.test(p.host) ? fail(30, 'Punycode domain - characters may imitate a different alphabet') : pass('Plain characters only')) },

  { id: 'U03', group: 'Address', threat: 'scam', title: 'Destination is not hidden behind an "@"',
    run: ({ p }) => {
      if (!p.hasUserinfo) return pass('No hidden destination');
      const before = (/^[a-z]+:\/\/([^/@]*)@/i.exec(p.url) || [])[1] || '';
      if (!/\./.test(before)) return fail(24, 'Everything before "@" is ignored by the browser - the real destination is hidden');
      const decoyWords = hostWords(before);
      const decoyBrand = L.PROTECTED_BRANDS.find((b) => decoyWords.has(b.token));
      return fail(decoyBrand ? 40 : 32, `"${before.slice(0, 40)}" is a decoy${decoyBrand ? ` posing as ${decoyBrand.domains[0]}` : ''} - everything before "@" is ignored and the real site is ${p.host}`);
    } },

  { id: 'U04', group: 'Address', threat: 'scam', title: 'Reasonable subdomain depth',
    run: ({ p }) => (p.subdomains.length >= 4 ? fail(12, `${p.subdomains.length} levels of subdomains`) : pass(`${p.subdomains.length} subdomain level(s)`)) },

  { id: 'U05', group: 'Address', threat: 'scam', title: 'Domain name is not unusually long',
    run: ({ p }) => (!p.isIp && p.sld.length > 25 ? warn(8, `${p.sld.length}-character name`) : pass('Normal length')) },

  { id: 'U06', group: 'Address', threat: 'scam', title: 'Domain is not stuffed with hyphens',
    run: ({ p }) => {
      const n = (p.sld.match(/-/g) || []).length;
      if (n >= 3) return fail(12, `${n} hyphens in the domain name`);
      if (n === 2) return warn(5, 'Two hyphens in the domain name');
      return pass('Few or no hyphens');
    } },

  { id: 'U07', group: 'Address', threat: 'scam', title: 'No digits disguised inside words',
    run: ({ p }) => (!p.isIp && /[a-z]\d|\d[a-z]/.test(p.sld) && !/^[a-z]{1,4}\d{1,3}$/.test(p.sld) ? warn(6, 'Digits mixed into the name (e.g. "0" for "o")') : pass('No mixed digits')) },

  { id: 'U08', group: 'Address', threat: 'scam', title: 'Served on a standard port',
    run: ({ p }) => (p.port && !['80', '443'].includes(p.port) ? fail(8, `Uses port ${p.port}`, { malware: 8 }) : pass('Standard port')) },

  { id: 'U09', group: 'Address', threat: 'scam', title: 'Uses an encrypted (HTTPS) connection',
    run: ({ p }) => (p.scheme === 'http' ? warn(8, 'Unencrypted HTTP - anything you type can be read in transit') : pass('HTTPS')) },

  { id: 'U10', group: 'Address', threat: 'scam', title: 'Top-level domain is not heavily abused',
    run: ({ p }) => {
      const risk = L.RISKY_TLDS[p.suffix];
      return risk ? fail(Math.round(risk * 0.9), `.${p.suffix} has a very high share of scam registrations`, { malware: Math.round(risk * 0.3) }) : pass(p.suffix ? `.${p.suffix}` : 'n/a');
    } },

  { id: 'U11', group: 'Address', threat: 'malware', title: 'Name is not machine-generated gibberish',
    run: ({ p }) => {
      if (p.isIp || p.sld.length < 12) return pass('Short or readable name');
      const e = entropy(p.sld.replace(/-/g, ''));
      const consonants = /[bcdfghjklmnpqrstvwxz]{5,}/.test(p.sld);
      return e > 3.5 && consonants ? fail(16, 'Random-looking name typical of generated malware domains', { scam: 6 }) : pass('Readable name');
    } },

  { id: 'U12', group: 'Address', threat: 'scam', title: 'Link is not excessively long',
    run: ({ p }) => (p.url.length > 180 ? warn(5, `${p.url.length}-character link`) : pass('Normal length')) },

  { id: 'U13', group: 'Address', threat: 'scam', title: 'No heavily encoded parameters',
    run: ({ p }) => ((p.query.match(/%[0-9a-f]{2}/gi) || []).length > 12 ? warn(8, 'Query string is heavily percent-encoded') : pass('Readable parameters')) },

  { id: 'U14', group: 'Downloads', threat: 'virus', title: 'Link does not download a program',
    run: ({ p }) => {
      if (!L.EXECUTABLE_EXT.has(p.ext)) return pass('Not an executable download');
      // A program served from a raw IP, a heavily abused ending or a throwaway
      // host is far more likely to be malicious than one from an established site.
      const shadyHost = p.isIp || Boolean(L.RISKY_TLDS[p.suffix]) || Boolean(p.hosting) || L.DYNAMIC_DNS.some((d) => p.host.endsWith('.' + d));
      return shadyHost
        ? fail(42, `Downloads a .${p.ext} program from ${p.isIp ? 'a bare IP address' : `a .${p.suffix} address`}`, { malware: 12 })
        : fail(30, `Downloads a .${p.ext} file, which runs code on your computer`, { malware: 12 });
    } },

  { id: 'U15', group: 'Downloads', threat: 'virus', title: 'No disguised double file extension',
    run: ({ p }) => {
      const e = p.exts;
      if (e.length >= 2 && L.DOC_EXT.has(e[e.length - 2]) && (L.EXECUTABLE_EXT.has(e[e.length - 1]) || L.ARCHIVE_EXT.has(e[e.length - 1]))) {
        return fail(45, `"${p.file}" pretends to be a .${e[e.length - 2]} but is a .${e[e.length - 1]}`);
      }
      return pass('No double extension');
    } },

  { id: 'U16', group: 'Downloads', threat: 'virus', title: 'Not a macro-enabled Office document',
    run: ({ p }) => (L.MACRO_DOC_EXT.has(p.ext) ? fail(18, `.${p.ext} documents can run macros`) : pass('No macro document')) },

  { id: 'U17', group: 'Downloads', threat: 'virus', title: 'Not a compressed archive download',
    run: ({ p }) => (L.ARCHIVE_EXT.has(p.ext) ? warn(6, `.${p.ext} archives are a common way to smuggle malware past filters`) : pass('Not an archive')) },

  { id: 'U18', group: 'Address', threat: 'scam', title: 'Real destination is visible (not a URL shortener)',
    run: ({ p }) => (L.URL_SHORTENERS.has(p.registrable) || L.URL_SHORTENERS.has(p.host) ? warn(14, 'Shortened link - the destination is hidden until you click') : pass('Not shortened')) },

  { id: 'U19', group: 'Address', threat: 'scam', title: 'Does not bounce you to another site through a parameter',
    run: ({ p }) => {
      const m = /[?&](url|u|redirect|redirect_uri|next|target|dest|destination|goto|continue|r)=((https?%3A|https?:)[^&]+)/i.exec(p.query);
      if (!m) return pass('No redirect parameter');
      const target = analyze(decodeURIComponent(m[2]));
      return target && target.registrable !== p.registrable ? warn(14, `Forwards to ${target.host}`) : pass('Redirects stay on the same site');
    } },

  { id: 'U20', group: 'Hosting', threat: 'scam', title: 'Not a free hosting or site-builder subdomain',
    run: ({ p, brand, words }) => {
      if (L.PATH_HOSTING.includes(p.host) && p.path.length > 1) {
        const lower = p.path.toLowerCase();
        if (CREDENTIAL_WORDS.some((w) => lower.includes(w))) return fail(20, `User-made page on ${p.host} using login wording`);
        if (/\.html?$/.test(lower) && L.OBJECT_STORAGE.test(p.host)) return fail(CREDENTIAL_WORDS.some((w) => lower.includes(w)) ? 32 : 22, `Web page served straight from a storage bucket on ${p.host}, where anyone can upload one`);
        return warn(8, `User-made page on ${p.host}`);
      }
      if (L.OBJECT_STORAGE.test(p.host) && /\.html?$/i.test(p.path)) {
        const login = CREDENTIAL_WORDS.some((w) => p.path.toLowerCase().includes(w));
        return fail(login ? 32 : 22, `Web page served straight from a storage bucket (${p.host}), where anyone can upload one${login ? ', with login wording' : ''}`);
      }
      const hosted = L.FREE_HOSTING.find((d) => p.host === d || p.host.endsWith('.' + d));
      if (!hosted || p.host === hosted) return pass('Own domain');
      const bait = brand.inSubdomain || CREDENTIAL_WORDS.some((w) => words.has(w));
      return bait ? fail(26, `Free ${hosted} page using brand or login wording`) : warn(10, `Hosted on free ${hosted}`);
    } },

  { id: 'U38', group: 'Hosting', threat: 'scam', title: 'Free-hosting page name is not machine-generated',
    run: ({ p }) => {
      if (!p.hosting) return skip('Not on a hosting platform');
      const label = p.sld;
      const digits = (label.match(/\d/g) || []).length;
      const hyphens = (label.match(/-/g) || []).length;
      const dated = /\d{1,2}-\d{1,2}-(19|20)\d{2}/.test(label);
      const random = label.length >= 12 && entropy(label.replace(/[-\d]/g, '')) > 3.3 && /[bcdfghjklmnpqrstvwxz]{4,}/.test(label);
      if (dated || (hyphens >= 3 && digits >= 3) || random) return fail(20, `Throwaway page name "${label}" on ${p.hosting}`);
      return pass('Readable page name');
    } },

  { id: 'U39', group: 'Address', threat: 'scam', title: 'Link does not carry a tracking token identifying you',
    run: ({ p }) => {
      const segs = p.path.split('/').filter(Boolean);
      const token = segs.find((s) => s.length >= 12 && /^[A-Za-z0-9_-]+={0,2}$/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d|[A-Z].*[A-Z].*[A-Z]/.test(s) && !/\.(html?|php|aspx?)$/.test(s));
      const emailInUrl = /[?&=/][^?&=/]*%40|[?&=][a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i.test(p.path + p.query);
      if (emailInUrl) return fail(14, 'The link contains an email address - it was generated for one victim');
      return token ? warn(6, 'Link carries an encoded per-recipient token') : pass('No per-recipient token');
    } },

  { id: 'U21', group: 'Hosting', threat: 'malware', title: 'Not a dynamic-DNS throwaway hostname',
    run: ({ p }) => {
      const d = L.DYNAMIC_DNS.find((x) => p.host.endsWith('.' + x));
      return d ? fail(24, `Dynamic DNS hostname under ${d}`, { scam: 10 }) : pass('Not dynamic DNS');
    } },

  { id: 'U22', group: 'Impersonation', threat: 'scam', title: 'Does not borrow a brand name it does not own',
    run: ({ brand }) => (brand.inDomain ? fail(38, `Uses "${brand.inDomain.token}" but is not ${brand.inDomain.domains[0]}`) : pass('No borrowed brand in the domain')) },

  { id: 'U23', group: 'Impersonation', threat: 'scam', title: 'No brand name planted in a subdomain',
    run: ({ brand }) => (brand.inSubdomain && !brand.inDomain ? fail(34, `Puts "${brand.inSubdomain.token}" in front of an unrelated domain`) : pass('No planted brand')) },

  { id: 'U24', group: 'Impersonation', threat: 'scam', title: 'Not a misspelling of a well-known brand',
    run: ({ brand }) => {
      if (!brand.lookalike) return pass('No typosquatting');
      // Nobody accidentally registers a one-letter-off "steamcommunity"; a word
      // one letter off "apple" is far more often innocent.
      const t = brand.lookalike.token;
      return t.length >= 7
        ? fail(70, `Near-identical spelling of ${brand.lookalike.domains[0]}`)
        : fail(36, `Similar spelling to ${brand.lookalike.domains[0]}`);
    } },

  { id: 'U25', group: 'Wording', threat: 'scam', title: 'No account-security bait in the address',
    run: ({ words, p }) => {
      const { hits, points } = keywordScore(words, CREDENTIAL_WORDS, 30, p);
      return hits.length ? fail(points, `Address uses: ${hits.slice(0, 4).join(', ')}`) : pass('None found');
    } },

  { id: 'U26', group: 'Wording', threat: 'scam', title: 'No prize or free-money bait in the address',
    run: ({ words, p }) => {
      const { hits, points } = keywordScore(words, MONEY_WORDS, 30, p);
      return hits.length ? fail(points, `Address uses: ${hits.slice(0, 4).join(', ')}`) : pass('None found');
    } },

  { id: 'U27', group: 'Wording', threat: 'scam', title: 'No crypto-drainer wording in the address',
    run: ({ words, p }) => {
      const { hits, points } = keywordScore(words, CRYPTO_WORDS, 40, p);
      return hits.length ? fail(points, `Address uses: ${hits.slice(0, 4).join(', ')}`) : pass('None found');
    } },

  { id: 'U28', group: 'Wording', threat: 'scam', title: 'No fake-clearance-store wording',
    run: ({ words, p }) => {
      const { hits, points } = keywordScore(words, SHOP_WORDS, 20, p);
      return hits.length ? warn(points, `Address uses: ${hits.join(', ')}`) : pass('None found');
    } },

  { id: 'U29', group: 'Wording', threat: 'scam', title: 'Bait words are not stacked together',
    run: ({ words }) => {
      const n = [...CREDENTIAL_WORDS, ...MONEY_WORDS, ...CRYPTO_WORDS, ...SHOP_WORDS].filter((w) => words.has(w)).length;
      return n >= 3 ? fail(10, `${n} bait words in one address`) : pass('No stacking');
    } },

  { id: 'U30', group: 'Wording', threat: 'scam', title: 'Path is not a known credential-trap pattern',
    run: ({ p }) => {
      const lower = (p.path + p.query).toLowerCase();
      const hits = Object.keys(L.PATH_KEYWORDS).filter((k) => lower.includes(k));
      return hits.length ? fail(Math.min(30, hits.reduce((s, k) => s + L.PATH_KEYWORDS[k], 0)), `Path contains ${hits.map((h) => '/' + h).join(', ')}`) : pass('Ordinary path');
    } },

  { id: 'U31', group: 'Wording', threat: 'scam', title: 'Not styled as a tech-support alert',
    run: ({ words }) => {
      const hits = L.TECH_SUPPORT_WORDS.filter((w) => words.has(w));
      return hits.length ? fail(Math.min(24, 12 * hits.length), `Address uses: ${hits.join(', ')}`) : pass('None found');
    } },

  { id: 'U32', group: 'Wording', threat: 'scam', title: 'Not a parcel-fee or delivery lure',
    run: ({ p, words, brand }) => {
      const hits = L.DELIVERY_WORDS.filter((w) => words.has(w));
      if (!hits.length) return pass('None found');
      const courier = brand.inDomain && ['usps', 'dhl', 'fedex', 'ups', 'royalmail', 'evri', 'canadapost', 'auspost'].includes(brand.inDomain.token);
      if (courier || words.has('fee') || words.has('pay')) return fail(18, `Delivery wording: ${hits.join(', ')}`);
      // Real couriers don't run parcel sites on the endings scammers buy in bulk.
      if (L.RISKY_TLDS[p.suffix] || p.hosting) return fail(16, `Parcel-themed address (${hits.join(', ')}) on a throwaway .${p.suffix} domain`);
      return warn(6, `Delivery wording: ${hits.join(', ')}`);
    } },

  { id: 'U33', group: 'Impersonation', threat: 'scam', title: 'Does not pose as a government service',
    run: ({ p, words }) => {
      const hits = L.GOV_WORDS.filter((w) => words.has(w));
      const realGov = /(^|\.)(gov|mil|gov\.[a-z]{2}|gc\.ca|gouv\.fr|europa\.eu)$/.test(p.host) || p.suffix === 'gov';
      return hits.length && !realGov ? fail(22, `Uses government wording (${hits.join(', ')}) on a non-government domain`) : pass('No government impersonation');
    } },

  { id: 'U34', group: 'Downloads', threat: 'malware', title: 'Path is not a known malware drop pattern',
    run: ({ p }) => (/\/(bins?|mozi\.[a-z]|mips|mpsl|arm7|x86_64|i\.sh)\b|\.sh$/i.test(p.path) && (p.isIp || p.port) ? fail(32, 'Looks like an IoT/botnet payload path') : pass('Ordinary path')) },

  { id: 'U35', group: 'Hosting', threat: 'malware', title: 'Not a browser cryptominer host',
    run: ({ p }) => (L.CRYPTOMINER_HOSTS.includes(p.registrable) ? fail(70, `${p.registrable} serves in-browser cryptominers`) : pass('Not a miner host')) },

  { id: 'U37', group: 'Impersonation', threat: 'scam', title: 'Brand name is not paired with account-security wording',
    run: ({ brand, words }) => {
      const b = brand.inDomain || brand.inSubdomain || brand.lookalike;
      const hits = CREDENTIAL_WORDS.filter((w) => words.has(w));
      return b && hits.length ? fail(12, `"${b.token}" combined with "${hits[0]}" - a classic combosquatting pattern`) : pass('No brand + security combination');
    } },

  { id: 'U36', group: 'Trust', threat: 'scam', title: 'Official domain of a well-known brand',
    run: ({ brand }) => (brand.official ? pass(`Official ${brand.official.domains[0]}`, -60) : skip('Not a protected brand')) }
];

/* ======================================================================
   Knowledge checks - how stage 1 is reported in the checklist
   ====================================================================== */

const KNOWLEDGE_CHECKS = [
  { id: 'U40', group: 'Impersonation', threat: 'scam', title: 'Path does not carry a brand the site does not own',
    run: ({ p, brand, words }) => {
      if (brand.official) return pass('Official site');
      // An archive's path IS another site's address (web.archive.org/web/2020/https://www.paypal.com/). That is a copy, not a costume.
      if (p.path.includes('://') && L.ARCHIVES.includes(p.host)) return pass('An archived copy of another site');
      const segments = p.path.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
      const hit = L.PROTECTED_BRANDS.find((b) => segments.includes(b.token) && !b.domains.includes(p.registrable));
      if (!hit) return pass('No brand names in the path');
      const login = CREDENTIAL_WORDS.some((w) => words.has(w) || p.path.toLowerCase().includes(w));
      return fail(login ? 30 : 22, `Path mentions "${hit.token}" but this is not ${hit.domains[0]}${login ? ', next to login wording' : ''}`);
    } },

  { id: 'U41', group: 'Wording', threat: 'scam', title: 'Not a login page parked in a site\'s file folders',
    run: ({ p, brand }) => {
      if (brand.official) return pass('Official site');
      const lower = p.path.toLowerCase();
      const folder = /\/(wp-content|wp-includes|cgi-bin|\.well-known|includes|tmp|temp|old|backup|css|js|img|images|fonts|assets|uploads|files)\//.test(lower);
      const kitFile = /(^|\/)(login|signin|sign-in|verify|validate|validation|confirm|update|secure|auth|session|account|identity|password)[\w-]*\.(php|html?|aspx?)(\?|$)/.test(lower) && !/wp-login\.php/.test(lower);
      const loginWords = CREDENTIAL_WORDS.some((w) => lower.includes(w));
      const victimParam = /[?&](email|e|user|username|login|id|u|token)=/.test(p.query.toLowerCase());
      if (folder && (loginWords || /\.(php|html?)(\?|$)/.test(lower))) {
        return fail(victimParam ? 36 : kitFile ? 26 : 18, `Login-style page inside a folder meant for site files (${lower.match(/\/[^/]+\//)[0]})${victimParam ? ', addressed to one person' : ''}`);
      }
      if (kitFile) return fail(14, `Kit-style file name ${lower.split('/').pop().split('?')[0]}`);
      return pass('Ordinary page location');
    } },

  { id: 'U42', group: 'Address', threat: 'scam', title: 'No random-looking subdomain in front of bait wording',
    run: ({ p, words }) => {
      const label = p.subdomains[0] || (p.hosting ? p.sld : '');
      if (label.length < 6 || !/\d/.test(label) || !/[a-z]/.test(label)) return pass('No random subdomain');
      const digits = (label.match(/\d/g) || []).length;
      const random = entropy(label) > 2.8 || (digits >= 2 && !/[aeiou]{2}/.test(label) && !/^(www|mail|api|cdn|app|m|static|img|ftp)\d*$/.test(label));
      if (!random) return pass('Readable subdomain');
      const bait = [...CREDENTIAL_WORDS, ...CRYPTO_WORDS, ...MONEY_WORDS].some((w) => words.has(w) || p.path.toLowerCase().includes(w));
      return bait ? fail(14, `Random subdomain "${label}" on an address using bait wording`) : warn(4, `Random-looking subdomain "${label}"`);
    } },

  { id: 'U43', group: 'Wording', threat: 'scam', title: 'Address is not a stack of bait words',
    run: ({ p, words, brand }) => {
      if (brand.owner || p.isIp) return pass('Not applicable');
      // One bait word is a business name. Three or more, hyphenated together
      // ("account-verify-center", "your-pc-is-infected-call-now"), is a lure built to be clicked.
      const PRESSURE = ['call', 'now', 'urgent', 'locked', 'suspended', 'virus', 'm365', 'o365', 'office365'];
      const BAIT = [...CREDENTIAL_WORDS, ...MONEY_WORDS, ...CRYPTO_WORDS, ...SHOP_WORDS, ...L.TECH_SUPPORT_WORDS, ...L.DELIVERY_WORDS, ...PRESSURE];
      const parts = p.sld.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const inName = [...new Set(parts.filter((w) => BAIT.includes(w)))];
      // Needs a name of three or more hyphenated parts, at least two of them bait.
      if (parts.length < 3 || inName.length < 2) return pass('No stacked bait wording');
      const inPath = p.path.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && BAIT.includes(w));
      const all = [...new Set([...inName, ...inPath])];
      return fail(all.length >= 4 ? 20 : 14, `Built from bait words: ${all.slice(0, 5).join(', ')}`);
    } },

  { id: 'U44', group: 'Address', threat: 'scam', title: 'Name does not imitate a country ending',
    run: ({ p, brand }) => {
      if (brand.owner || p.isIp || !p.subdomains || !p.subdomains.length) return pass('Not applicable');
      // "allegrolokalnie.pl-65445.lol" is read as "allegrolokalnie.pl". The real name is "pl-65445".
      const m = /^(pl|de|fr|uk|us|it|es|nl|br|ru|cn|jp|au|ca|in|se|no|dk|fi|ch|at|be|cz|pt|gr|tr|mx|ar|co|com|net|org|gov)-[a-z0-9-]{3,}$/.exec(p.sld.toLowerCase());
      if (!m) return pass('No imitation ending');
      const shown = `${p.subdomains[p.subdomains.length - 1]}.${m[1]}`;
      return fail(30, `Made to be read as "${shown}"; the real site is ${p.registrable}`);
    } },

  { id: 'U45', group: 'Address', threat: 'scam', title: 'Name is more than a long number',
    run: ({ p, brand }) => {
      if (brand.owner || p.isIp) return pass('Not applicable');
      // Short numeric names are ordinary in some countries (163.com, 12306.cn). Seven digits and up is a serial number.
      if (/^\d{7,}$/.test(p.sld)) return fail(24, 'The name is only a long number, the mark of domains registered in bulk');
      // A shorter number is only telling on an ending that is sold in bulk for next to nothing.
      if (/^\d{4,6}$/.test(p.sld) && L.RISKY_TLDS[p.suffix]) return fail(24, `A bare number on .${p.suffix}, the mark of domains registered in bulk`);
      return pass('Not a bare number');
    } },

  { id: 'U46', group: 'Address', threat: 'scam', title: 'Not a help desk, sign-in or wallet page on free hosting',
    run: ({ p, brand }) => {
      if (!p.hosting || brand.owner) return pass('Not applicable');
      // Whoever made the page chose this name. No real company keeps its sign-in
      // page, help centre or wallet on a free subdomain of somebody else's service.
      const STEMS = ['helpcenter', 'helpcentre', 'helpdesk', 'support', 'verif', 'login', 'loggin', 'logon', 'signin', 'secure', 'account',
        'recover', 'appeal', 'wallet', 'billing', 'confirm', 'unlock', 'badge', 'copyright', 'suspend', 'restrict', 'webmail', 'password'];
      const first = (p.path.split('/').filter(Boolean)[0] || '').toLowerCase();
      const clean = (text) => text.toLowerCase().replace(/[^a-z]+/g, '');
      const inName = STEMS.filter((s) => clean(p.sld).includes(s));
      const inPath = STEMS.filter((s) => clean(first).includes(s));
      // One such word in a folder name is documentation ("/login-guide"). In the site's own name it is a claim.
      const hits = [...new Set(inName.length || inPath.length >= 2 ? [...inName, ...inPath] : [])];
      if (!hits.length) return pass('An ordinary name');
      const lure = hits.length >= 2 || brand.inDomain || brand.inSubdomain || brand.lookalike;
      return fail(lure ? 40 : 28, `A free ${p.hosting} page that calls itself "${hits.slice(0, 3).join('", "')}"`);
    } },

  { id: 'U47', group: 'Address', threat: 'scam', title: 'No domain ending buried inside the subdomains',
    run: ({ p, brand }) => {
      if (brand.owner || p.isIp || p.subdomains.length < 2) return pass('Not applicable');
      // "ebay.item.co.uk.login.example.com": the eye stops at ".co.uk". The site is example.com.
      // Only whole endings count (".com", ".co.uk", ".com.br"): a lone "co" or "us" is how
      // American county and state sites are really named (www.co.washington.or.us).
      const m = /^((?:[a-z0-9-]+\.)*?[a-z0-9-]+\.(?:com|net|org|gov|edu|co\.[a-z]{2}|com\.[a-z]{2}))(?:\.|$)/.exec(p.subdomains.join('.').toLowerCase());
      if (!m) return pass('No buried ending');
      return fail(30, `Made to be read as "${m[1]}"; the real site is ${p.registrable}`);
    } },

  { id: 'U48', group: 'Address', threat: 'scam', title: 'Name on a cheap ending can be pronounced',
    run: ({ p, brand }) => {
      if (brand.owner || p.isIp || !L.RISKY_TLDS[p.suffix] || p.hosting) return pass('Not applicable');
      if (p.sld.length < 5 || p.sld.length > 11 || /[-\d]/.test(p.sld)) return pass('Not applicable');
      return /[bcdfghjklmnpqrstvwxz]{4,}/.test(p.sld.toLowerCase())
        ? fail(18, `"${p.sld}" is a string of letters rather than a name, on an ending sold in bulk`)
        : pass('Readable name');
    } },

  { id: 'U49', group: 'Address', threat: 'scam', title: 'No brand name glued to a lure word',
    run: ({ p, brand }) => {
      if (brand.owner || brand.inDomain || p.isIp) return pass('Not applicable');
      // Short brand names only count as whole words ("apple" is also in "pineapple"). But glued to nothing
      // except lure words, in any of the languages the lists are full of, the name is borrowed:
      // "applesoporte", "appleidmapa", "wwapplecloud".
      const LURE = ['support', 'soporte', 'suporte', 'suport', 'service', 'servicio', 'secure', 'security', 'seguro', 'login', 'signin', 'verify', 'verif', 'account',
        'cuenta', 'conta', 'cloud', 'mapa', 'maps', 'map', 'find', 'fmi', 'locate', 'wallet', 'pay', 'bank', 'update', 'help', 'ayuda', 'center', 'centre',
        'online', 'id', 'app', 'care', 'team', 'alert', 'billing', 'recover', 'unlock'];
      const FILLER = ['www', 'ww', 'my', 'the', 'get', 'go', 'e', 'i'];
      const madeOf = (text, words) => {
        if (!text) return true;
        return words.some((w) => text.startsWith(w) && madeOf(text.slice(w.length), words));
      };
      for (const part of p.sld.toLowerCase().split(/[-_]/)) {
        for (const b of L.PROTECTED_BRANDS) {
          const t = b.token;
          if (t.length < 4 || t.length > 7 || part === t) continue;
          const at = part.indexOf(t);
          if (at < 0) continue;
          const before = part.slice(0, at);
          const after = part.slice(at + t.length);
          if (!before && !after) continue;
          if (madeOf(before, FILLER) && after && madeOf(after, LURE)) return fail(38, `"${t}" glued to "${after}": the name is borrowed; the real site is ${b.domains[0]}`);
          if (before && madeOf(before, LURE) && !after) return fail(38, `"${t}" glued to "${before}": the name is borrowed; the real site is ${b.domains[0]}`);
        }
      }
      return pass('No glued brand name');
    } },

  { id: 'U50', group: 'Address', threat: 'scam', title: 'Path is not dressed up as another site\'s address',
    run: ({ p, brand }) => {
      if (brand.owner || !p.path || p.path.includes('://')) return pass('Not applicable');
      // "s4w.in/roblox-com-users-...-profile", "gurl.pro/wwwrobloxcom-users-...": the eye reads roblox.com. The site is s4w.in.
      const path = p.path.toLowerCase();
      for (const b of L.PROTECTED_BRANDS) {
        if (b.token.length < 4) continue;
        const re = new RegExp(`(^|[/._-])(www[._-]?)?${b.token}[._-]?com([/._-]|$)`);
        if (re.test(path)) return fail(38, `The path is written to look like ${b.domains[0]}; the real site is ${p.registrable}`);
      }
      return pass('Ordinary path');
    } },

  { id: 'U51', group: 'Address', threat: 'scam', title: 'Page is not a known phishing kit\'s file',
    run: ({ p, brand }) => {
      if (brand.owner) return pass('Not applicable');
      // File names counted across the public phishing lists: each recurs on many unrelated domains, which is
      // what a kit copied from site to site looks like. The second group are ordinary names that kits also use.
      const name = (p.path.split('/').filter(Boolean).pop() || '').toLowerCase();
      if (L.KIT_FILES.signature.includes(name)) return fail(38, `"${name}" is a phishing kit's file: the same name sits on many unrelated sites on the phishing lists`);
      if (L.KIT_FILES.strong.includes(name)) return fail(22, `"${name}" is a file name phishing kits reuse across many sites`);
      if (L.KIT_FILES.weak.includes(name)) return warn(10, `"${name}" is a file name often seen in phishing kits`);
      return pass('Not a kit file name');
    } },

  { id: 'K01', group: 'Known threats', threat: 'scam', title: 'Not a known scam',
    run: ({ knowledge }) => matchCheck(knowledge, 'scam', 'scam') },
  { id: 'K02', group: 'Known threats', threat: 'malware', title: 'Not a known malware site',
    run: ({ knowledge }) => matchCheck(knowledge, 'malware', 'malware') },
  { id: 'K03', group: 'Known threats', threat: 'virus', title: 'Not a known virus distributor',
    run: ({ knowledge }) => matchCheck(knowledge, 'virus', 'virus') },
  { id: 'K04', group: 'Known threats', threat: 'scam', title: 'Not reported by the Sentinel community',
    run: ({ knowledge }) => {
      if (!knowledge.reports) return pass('No reports');
      return knowledge.reports >= 3
        ? fail(100, `Confirmed by ${knowledge.reports} independent Sentinel user reports`)
        : warn(16 * knowledge.reports, `${knowledge.reports} Sentinel user report(s)`);
    } },
  { id: 'K05', group: 'Known threats', threat: 'scam', title: 'Checked against every threat source',
    run: ({ knowledge }) => pass(`${knowledge.sources.length} sources: ${knowledge.sources.join(', ')}`) }
];

function matchCheck(knowledge, threat, noun) {
  const confirmed = knowledge.matches.filter((m) => m.threat === threat && m.strength === 'confirmed' && m.source !== 'community');
  if (confirmed.length) {
    const wording = {
      hosts_phishing_page: 'hosting a listed phishing page',
      hosts_malware: 'hosting a listed malware download',
      compromised_host: 'hosting several listed malicious files'
    };
    const what = wording[confirmed[0].category] || `listed as ${confirmed[0].category.replace(/_/g, ' ')}`;
    return fail(100, `${what[0].toUpperCase()}${what.slice(1)} by ${[...new Set(confirmed.map((m) => m.sourceName))].join(', ')}`);
  }
  // Other pages on this host are listed, this address is not. Worth weight, and the
  // engine turns it into evidence when the address also fails checks of its own.
  const inferred = knowledge.matches.filter((m) => m.threat === threat && m.strength === 'inferred');
  if (inferred.length) {
    const n = Math.max(...inferred.map((m) => m.listed || 1));
    const who = [...new Set(inferred.map((m) => m.sourceName))].join(', ');
    // "Likely", not "confirmed": nobody has listed this address, but the odds are poor.
    return fail(55, n >= 3
      ? `${n} other addresses on this site are listed by ${who}; this one is not`
      : `Another page on this site is listed by ${who}; this address is not`);
  }
  const likely = knowledge.matches.filter((m) => m.threat === threat && m.strength === 'likely');
  if (likely.length) return fail(45, `Several known ${noun} links are hosted here`);
  return pass(`No ${noun} record`);
}

/* ======================================================================
   Comparison checks - stage 3
   ====================================================================== */

const COMPARE_CHECKS = [
  { id: 'C01', group: 'Compared to known scams', threat: 'scam', title: 'Name is not a variant of a known scam domain',
    run: ({ compare, brand, p, knowledge }) => {
      if (brand.owner) return pass(`Official ${brand.owner.domains[0]}`);
      // A service Sentinel knows by name, where people's content lives in the path (web.archive.org,
      // docs.google.com): the domain is the service's own, whatever scam borrowed the same word.
      if (knowledge && knowledge.userContent && !p.hosting) return pass('A known service; its pages are judged one by one');
      if (plainName(p) && !brand.inDomain && !brand.lookalike && compare.skeletonMatches.every((m) => m.generic)) return pass('A plain name; the look-alikes borrowed a common word');
      const m = compare.skeletonMatches[0];
      return m ? fail(34, `Nearly the same name as known ${String(m.category || m.threat).replace(/_/g, ' ')} site ${m.host}`) : pass('No near-duplicate');
    } },
  { id: 'C02', group: 'Compared to known scams', threat: 'scam', title: 'Name does not follow a known scam naming pattern',
    run: ({ compare, brand, p }) => {
      if (brand.owner) return pass(`Official ${brand.owner.domains[0]}`);
      const m = compare.tokenMatches[0];
      if (m && plainName(p) && !brand.inDomain && !brand.lookalike) return warn(6, `Shares "${m.shared.join('" + "')}" with known scam ${m.host}, but is one plain name`);
      return m ? warn(Math.min(24, 10 + 6 * m.shared.length), `Shares "${m.shared.join('" + "')}" with known scam ${m.host}`) : pass('No shared pattern');
    } },
  { id: 'C03', group: 'Compared to known scams', threat: 'scam', title: 'Page content does not match a known scam kit',
    research: true,
    run: (ctx) => kitCheck(ctx, 'scam') },
  { id: 'C04', group: 'Compared to known scams', threat: 'malware', title: 'Page content does not match a known malware lure',
    research: true,
    run: (ctx) => kitCheck(ctx, 'malware') },
  { id: 'C05', group: 'Compared to known scams', threat: 'scam', title: 'Page is not a copy of a confirmed scam page',
    research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      if (!page(ctx)) return skip('No page content to compare');
      const m = ctx.contentCompare.similarPages[0];
      return m ? fail(45, `${m.similarity}% similar to confirmed ${m.threat} page on ${m.host}`) : pass('No copied scam page');
    } }
];

function kitCheck(ctx, threat) {
  const r = needsResearch(ctx); if (r) return r;
  if (!page(ctx)) return skip('No page content to compare');
  const kit = ctx.contentCompare.kits.find((k) => k.threat === threat);
  if (!kit) return pass('No known kit phrases');
  return kit.strength === 'strong'
    ? fail(55, `Matches "${kit.label}" (${kit.hits.length} signature phrases)`)
    : warn(28, `Partly matches "${kit.label}"`);
}

/* ======================================================================
   Research checks - infrastructure (Pro, Max and Ultimate)
   ====================================================================== */

const DAY = 24 * 60 * 60 * 1000;

const INFRA_CHECKS = [
  { id: 'R01', group: 'Registration', threat: 'scam', title: 'Domain is not brand new', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const reg = ctx.research.registration;
      if (!reg.available || !reg.registered || !reg.createdAt) return skip('Registration date unavailable');
      const days = Math.floor((Date.now() - reg.createdAt) / DAY);
      if (days < 14) return fail(30, `Registered ${days} day(s) ago`, { malware: 10 });
      if (days < 60) return fail(22, `Registered ${days} days ago`, { malware: 6 });
      if (days < 180) return warn(10, `Registered ${Math.round(days / 30)} months ago`);
      if (days >= 5 * 365) return pass(`Registered ${Math.floor(days / 365)} years ago`, -16);
      if (days >= 2 * 365) return pass(`Registered ${Math.floor(days / 365)} years ago`, -8);
      return pass(`Registered ${Math.floor(days / 30)} months ago`);
    } },

  { id: 'R02', group: 'Registration', threat: 'scam', title: 'Not registered for the minimum possible time', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const reg = ctx.research.registration;
      if (!reg.createdAt || !reg.expiresAt) return skip('Registration term unavailable');
      const term = reg.expiresAt - reg.createdAt;
      const young = Date.now() - reg.createdAt < 365 * DAY;
      return young && term <= 380 * DAY ? warn(6, 'One-year registration on a young domain') : pass('Normal registration term');
    } },

  { id: 'R03', group: 'Registration', threat: 'scam', title: 'Registrar has not suspended the domain', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const status = (ctx.research.registration.status || []).join(' ').toLowerCase();
      return /hold|pending delete|redemption/.test(status) ? fail(26, `Registry status: ${status}`) : pass('No suspension');
    } },

  { id: 'R04', group: 'Registration', threat: 'scam', title: 'Domain is actually registered', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const reg = ctx.research.registration;
      return reg.available && reg.registered === false ? fail(20, 'Nobody owns this domain - the link is fake or already taken down') : pass(reg.available ? 'Registered' : 'Registry not reachable');
    } },

  { id: 'R05', group: 'Network', threat: 'scam', title: 'Domain resolves to a server', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      return ctx.research.dns.resolves ? pass(`Resolves to ${ctx.research.dns.addresses[0]}`) : warn(10, 'Does not resolve - possibly taken down after abuse reports');
    } },

  { id: 'R06', group: 'Network', threat: 'malware', title: 'Does not point at a private network address', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      return ctx.research.dns.privateAddress ? fail(30, 'Public domain resolving to a private/internal address') : pass('Public address');
    } },

  { id: 'R07', group: 'Network', threat: 'scam', title: 'Brand-style domain can receive email', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const brandish = ctx.brand.inDomain || ctx.brand.lookalike;
      if (!brandish) return skip('Only checked for brand-style domains');
      return ctx.research.dns.mx ? pass('Has mail servers') : warn(6, 'No mail servers - a real company domain would have them');
    } },

  { id: 'R08', group: 'Certificate', threat: 'scam', title: 'Valid, trusted HTTPS certificate', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const http = ctx.research.http;
      if (ctx.p.scheme !== 'https') return skip('Not an HTTPS link');
      if (!http.ok) return skip('Site did not respond');
      const tls = http.tls;
      if (!tls || !tls.present) return skip('No certificate information');
      if (tls.selfSigned) return fail(20, 'Self-signed certificate');
      if (tls.validTo && tls.validTo < Date.now()) return fail(18, 'Certificate has expired');
      if (tls.coversHost === false) return fail(18, 'Certificate belongs to a different site');
      if (tls.authorized === false) return warn(12, `Certificate not trusted (${tls.error || 'unknown'})`);
      return pass(`Issued by ${tls.issuer || 'a trusted authority'}`);
    } },

  { id: 'R09', group: 'Certificate', threat: 'scam', title: 'Certificate is not freshly minted', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const tls = ctx.research.http.tls;
      if (!tls || !tls.validFrom) return skip('No certificate date');
      const days = (Date.now() - tls.validFrom) / DAY;
      return days < 5 ? warn(8, `Certificate issued ${Math.max(0, Math.round(days))} day(s) ago`) : pass(`Certificate ${Math.round(days)} days old`);
    } },

  { id: 'R10', group: 'Redirects', threat: 'scam', title: 'No chain of redirects across different sites', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const chain = ctx.research.http.chain || [];
      const domains = [...new Set(chain.map((c) => (analyze(c.url) || {}).registrable).filter(Boolean))];
      if (domains.length >= 3) return fail(14, `Bounces through ${domains.join(' → ')}`);
      if (domains.length === 2) return warn(8, `Redirects to ${domains[1]}`);
      return pass(chain.length > 1 ? 'Redirects within the same site' : 'No redirects');
    } },

  { id: 'R11', group: 'Redirects', threat: 'scam', title: 'Final destination is not a known threat', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const fk = ctx.finalKnowledge;
      if (!fk) return pass('Lands on the same site');
      const m = fk.matches.find((x) => x.strength === 'confirmed');
      return m ? fail(90, `Redirects to known ${m.category.replace(/_/g, ' ')} site`, m.threat !== 'scam' ? { [m.threat]: 90 } : undefined) : pass('Destination has no threat record');
    } },

  { id: 'R12', group: 'Network', threat: 'scam', title: 'Site responds normally', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const http = ctx.research.http;
      if (http.blocked) return fail(14, 'Link resolves to a blocked internal destination', { malware: 10 });
      if (!http.ok) return skip(`Could not load the page (${http.error})`);
      return http.status >= 400 ? warn(4, `HTTP ${http.status}`) : pass(`HTTP ${http.status}`);
    } },

  { id: 'R13', group: 'Downloads', threat: 'virus', title: 'Page does not push a file download at you', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const http = ctx.research.http;
      if (!http.ok) return skip('Page not loaded');
      const disp = http.disposition.toLowerCase();
      const name = (/filename\*?=(?:utf-8'')?"?([^";]+)/i.exec(http.disposition) || [])[1] || '';
      const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      if (L.EXECUTABLE_EXT.has(ext)) return fail(34, `Serves the program "${name}" straight away`, { malware: 12 });
      if (/application\/(x-msdownload|x-msdos-program|vnd\.microsoft\.portable-executable|java-archive|vnd\.android\.package-archive)/.test(http.contentType)) {
        return fail(34, `Serves executable content (${http.contentType})`, { malware: 12 });
      }
      if (disp.includes('attachment')) return warn(8, `Forces a download${name ? ` of "${name}"` : ''}`);
      return pass('No forced download');
    } }
];

/* ======================================================================
   Research checks - page content (Pro, Max and Ultimate)
   ====================================================================== */

const URGENCY = ['account has been suspended', 'account will be suspended', 'within 24 hours', 'within 48 hours', 'immediately', 'final notice', 'unusual activity', 'verify your identity', 'action required', 'your account will be closed', 'last warning', 'avoid suspension'];
const REWARD = ['you have won', 'you won', 'claim your prize', 'claim your reward', 'congratulations', 'selected winner', 'free iphone', 'double your', 'giveaway', 'airdrop is live'];
const SUPPORT_SCARE = ['your computer is infected', 'call microsoft', 'call apple support', 'do not shut down', 'do not close this page', 'toll-free', 'toll free', 'error #', 'windows defender alert', 'trojan spyware'];
const PAY_ODDLY = /pay(ment)?\s+(only\s+)?(with|using|via|by)\s+(bitcoin|btc|usdt|crypto|gift\s?cards?|itunes|steam\s?cards?|google play cards?|western union|moneygram)/;

function brandInTitle(ctx) {
  const pg = page(ctx);
  if (!pg || !pg.titleLower) return null;
  const words = new Set(pg.titleLower.split(/[^a-z0-9]+/));
  return L.PROTECTED_BRANDS.find((b) => (b.token.length >= 5 ? pg.titleLower.includes(b.token) : words.has(b.token))
    && !b.domains.some((d) => ctx.p.registrable === d || ctx.p.host.endsWith('.' + d))) || null;
}

const hasPassword = (pg) => pg.inputs.some((i) => i.type === 'password');

const CONTENT_CHECKS = [
  { id: 'P01', group: 'Page content', threat: 'scam', title: 'Page does not claim to be a brand it is not', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      if (!page(ctx)) return skip('No page content');
      const b = brandInTitle(ctx);
      return b ? fail(hasPassword(page(ctx)) ? 40 : 22, `Page title presents itself as ${b.token} on ${ctx.p.registrable}`) : pass('Title matches the site');
    } },

  { id: 'P02', group: 'Page content', threat: 'scam', title: 'Does not ask for a password on an unofficial site', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      if (!hasPassword(pg)) return pass('No password field');
      return ctx.brand.inDomain || ctx.brand.inSubdomain || ctx.brand.lookalike || brandInTitle(ctx)
        ? fail(30, 'Asks for a password while impersonating a brand')
        : pass('Login form on its own site');
    } },

  { id: 'P03', group: 'Page content', threat: 'scam', title: 'Login details stay on this site', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const leaking = pg.forms.find((f) => f.external && f.inputs.some((i) => i.type === 'password'));
      return leaking ? fail(26, `Password form sends to ${leaking.actionHost}`) : pass('Forms submit to this site');
    } },

  { id: 'P04', group: 'Page content', threat: 'scam', title: 'Does not ship data to a Telegram bot or mail script', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      if (pg.htmlLower.includes('api.telegram.org/bot')) return fail(45, 'Sends form data to a Telegram bot - a phishing-kit hallmark');
      if (pg.forms.some((f) => /^mailto:/i.test(f.action))) return fail(20, 'Form emails your details to someone');
      return pass('No exfiltration endpoints');
    } },

  { id: 'P05', group: 'Page content', threat: 'scam', title: 'Card details are not requested on a suspicious page', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const card = pg.inputs.some((i) => /cc-?num|card.?num|cardnumber|cvv|cvc|cc-csc|security.?code/.test(`${i.name} ${i.autocomplete} ${i.placeholder}`));
      if (!card) return pass('No card fields');
      return ctx.brand.inDomain || ctx.brand.lookalike || brandInTitle(ctx) ? fail(28, 'Card form on a brand look-alike') : warn(6, 'Page collects card details');
    } },

  { id: 'P06', group: 'Page content', threat: 'scam', title: 'Never asks for a wallet recovery phrase', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const phraseText = /(recovery|seed|secret|mnemonic) phrase|private key|12[- ]word|24[- ]word/.test(pg.text);
      const wordInputs = pg.inputs.filter((i) => /word\s*\d+|phrase|mnemonic/.test(`${i.name} ${i.placeholder}`)).length;
      return phraseText && (wordInputs >= 1 || pg.inputs.some((i) => i.type === 'text' || i.type === 'password'))
        ? fail(55, 'Asks you to type a wallet recovery phrase - no legitimate site ever does')
        : pass('No seed-phrase request');
    } },

  { id: 'P07', group: 'Page content', threat: 'scam', title: 'No pressure or threat language', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const hits = URGENCY.filter((u) => pg.text.includes(u));
      if (hits.length >= 2) return fail(16, `"${hits.slice(0, 2).join('", "')}"`);
      if (hits.length === 1) return warn(6, `"${hits[0]}"`);
      return pass('No urgency language');
    } },

  { id: 'P08', group: 'Page content', threat: 'scam', title: 'No too-good-to-be-true prize wording', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const hits = REWARD.filter((u) => pg.text.includes(u));
      return hits.length >= 2 ? fail(18, `"${hits.slice(0, 2).join('", "')}"`) : hits.length ? warn(6, `"${hits[0]}"`) : pass('None found');
    } },

  { id: 'P09', group: 'Page content', threat: 'scam', title: 'Not a fake virus-warning / call-support page', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const hits = SUPPORT_SCARE.filter((u) => pg.text.includes(u));
      const phone = /\+?1?[\s.-]?\(?8(00|33|44|55|66|77|88)\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(pg.text);
      return hits.length >= 2 || (hits.length && phone) ? fail(34, `Scare wording${phone ? ' with a toll-free number' : ''}`) : pass('None found');
    } },

  { id: 'P10', group: 'Page content', threat: 'scam', title: 'No fake countdown timer', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      return /countdown|timer-(hours|minutes)|offer ends in|expires in \d/.test(pg.htmlLower) ? warn(8, 'Countdown timer pressures a decision') : pass('No timer');
    } },

  { id: 'P11', group: 'Page content', threat: 'scam', title: 'Does not block right-click or developer tools', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      return /keycode\s*===?\s*123|oncontextmenu\s*=\s*["']?return false|contextmenu[^;]{0,60}preventdefault|devtools-detect|disable-devtool/.test(pg.htmlLower)
        ? warn(10, 'Tries to stop visitors inspecting the page') : pass('Page can be inspected');
    } },

  { id: 'P12', group: 'Page behaviour', threat: 'malware', title: 'No hidden frames loading other sites', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const hidden = pg.iframes.filter((f) => f.hidden && /^https?:/i.test(f.src) && (analyze(f.src) || {}).registrable !== ctx.p.registrable);
      return hidden.length ? fail(28, `${hidden.length} invisible frame(s) loading ${(analyze(hidden[0].src) || {}).host}`) : pass('No hidden frames');
    } },

  { id: 'P13', group: 'Page behaviour', threat: 'malware', title: 'Scripts are not deliberately obfuscated', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const js = pg.inlineJs;
      let signals = 0;
      if (/eval\s*\(\s*(atob|unescape|decodeuricomponent|function\s*\(p,a,c,k,e)/i.test(js)) signals += 2;
      if ((js.match(/string\.fromcharcode/gi) || []).length > 5) signals += 1;
      if ((js.match(/\\x[0-9a-f]{2}/gi) || []).length > 200) signals += 1;
      if (/[A-Za-z0-9+/]{600,}={0,2}/.test(js)) signals += 1;
      if (/_0x[0-9a-f]{4,}/.test(js)) signals += 1;
      if (signals >= 3) return fail(30, 'Heavily obfuscated inline scripts');
      if (signals >= 2) return warn(14, 'Obfuscated inline scripts');
      return pass('Readable scripts');
    } },

  { id: 'P14', group: 'Page behaviour', threat: 'malware', title: 'No hidden cryptocurrency miner', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const hostHit = pg.scripts.find((s) => s.host && L.CRYPTOMINER_HOSTS.some((m) => s.host === m || s.host.endsWith('.' + m)));
      const inline = /coinhive|cryptonight|coinimp|webminepool|miner\.start\(|new\s+client\.anonymous/i.test(pg.inlineJs);
      return hostHit || inline ? fail(60, `Runs a cryptominer${hostHit ? ` from ${hostHit.host}` : ''}`) : pass('No miner');
    } },

  { id: 'P15', group: 'Downloads', threat: 'virus', title: 'Page does not auto-start a program download', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const ext = String.raw`\.(exe|scr|msi|apk|hta|js|vbs|bat|jar|iso|zip|rar)\b`;
      const refresh = new RegExp(`url=[^"']*${ext}`, 'i').test(pg.metaRefresh);
      const scripted = new RegExp(`(location(\\.href)?\\s*=|window\\.open\\()\\s*["'][^"']*${ext}`, 'i').test(pg.inlineJs);
      return refresh || scripted ? fail(36, 'Starts downloading a program without asking', { malware: 14 }) : pass('No automatic download');
    } },

  { id: 'P16', group: 'Downloads', threat: 'virus', title: 'Page does not link to program downloads', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const exe = pg.links.filter((h) => {
        const a = analyze(h.startsWith('http') ? h : `http://x.invalid/${h.replace(/^\/+/, '')}`);
        return a && L.EXECUTABLE_EXT.has(a.ext);
      });
      if (!exe.length) return pass('No program links');
      return ctx.p.registrable && (ctx.brand.official || ctx.knowledge.trusted) ? pass('Program downloads from an established site') : warn(12, `${exe.length} link(s) to program files`);
    } },

  { id: 'P17', group: 'Page behaviour', threat: 'malware', title: 'No "paste this command" instructions', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const clipboard = /navigator\.clipboard\.writetext|document\.execcommand\(\s*["']copy/i.test(pg.inlineJs);
      const instructions = /(win(dows)?\s*(key)?\s*\+\s*r|press\s+windows|run dialog|ctrl\s*\+\s*v|powershell|mshta|cmd\s*\/c)/.test(pg.text);
      if (clipboard && instructions) return fail(60, 'Copies a command to your clipboard and tells you to run it (ClickFix attack)');
      if (instructions && /verify|captcha|robot|human/.test(pg.text)) return fail(40, 'Fake verification asking you to run a command');
      return pass('No command instructions');
    } },

  { id: 'P18', group: 'Page behaviour', threat: 'malware', title: 'Does not trick you into allowing notifications', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const asks = /notification\.requestpermission|pushmanager\.subscribe/i.test(pg.inlineJs);
      const bait = /click allow|press allow|confirm (that )?you are not a robot/.test(pg.text);
      return asks && bait ? fail(26, 'Uses "click Allow" bait to enable spam notifications') : pass('No notification bait');
    } },

  { id: 'P19', group: 'Page behaviour', threat: 'malware', title: 'No HTML-smuggled file payloads', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const js = pg.inlineJs;
      const blob = /new\s+blob\s*\(/i.test(js) && /createobjecturl|mssaveoropenblob/i.test(js) && /\.download\s*=/.test(js);
      const payload = /[A-Za-z0-9+/]{2000,}={0,2}/.test(js);
      return blob && payload ? fail(40, 'Builds a file inside the page and forces it to download') : pass('No smuggling pattern');
    } },

  { id: 'P20', group: 'Page content', threat: 'scam', title: 'Login page has real content around it', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      return hasPassword(pg) && pg.words < 80 && !ctx.brand.official ? warn(10, `Bare login form with only ${pg.words} words of content`) : pass('Normal amount of content');
    } },

  { id: 'P21', group: 'Page content', threat: 'scam', title: 'Does not hot-link a brand\'s logos from the real site', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg || ctx.brand.official) return skip('Not applicable');
      const b = L.PROTECTED_BRANDS.find((brand) => pg.resourceHosts.some((h) => brand.domains.some((d) => h === d || h.endsWith('.' + d))) && pg.titleLower.includes(brand.token));
      return b ? fail(26, `Loads ${b.token} images/icons directly from ${b.domains[0]}`) : pass('Uses its own assets');
    } },

  { id: 'P22', group: 'Page content', threat: 'scam', title: 'Login page is not hidden from search engines', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      return hasPassword(pg) && pg.robots.includes('noindex') && !ctx.brand.official ? warn(8, 'Login page asks search engines not to index it') : pass('Indexable or not a login page');
    } },

  { id: 'P23', group: 'Shopping', threat: 'scam', title: 'Store shows contact, refund and privacy information', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const shop = /add to cart|add to bag|checkout|buy now/.test(pg.text);
      if (!shop) return skip('Not a shop page');
      const policy = pg.links.some((h) => /privacy|contact|terms|refund|return|shipping/i.test(h));
      return policy ? pass('Store policies linked') : warn(12, 'Shop with no contact, refund or privacy pages');
    } },

  { id: 'P24', group: 'Shopping', threat: 'scam', title: 'Discounts are believable', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const max = Math.max(0, ...[...pg.text.matchAll(/(\d{2})\s?% off/g)].map((m) => Number(m[1])));
      return max >= 75 ? warn(14, `Advertises ${max}% off`) : pass(max ? `Up to ${max}% off` : 'No extreme discounts');
    } },

  { id: 'P25', group: 'Shopping', threat: 'scam', title: 'Accepts normal, protected payment methods', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      return PAY_ODDLY.test(pg.text) ? fail(30, 'Demands payment by crypto, gift cards or wire transfer - none of which can be reversed') : pass('No unusual payment demands');
    } },

  { id: 'P26', group: 'Shopping', threat: 'scam', title: 'Contact is not limited to WhatsApp or Telegram', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const chat = pg.links.some((h) => /wa\.me|api\.whatsapp\.com|t\.me\//i.test(h));
      const other = /@[a-z0-9-]+\.[a-z]{2,}/.test(pg.text) || pg.links.some((h) => /^mailto:|^tel:/i.test(h));
      return chat && !other ? warn(8, 'The only contact option is a chat app') : pass('Ordinary contact options');
    } },

  { id: 'P27', group: 'Redirects', threat: 'scam', title: 'Scripts do not silently send you elsewhere', research: true,
    run: (ctx) => {
      const r = needsResearch(ctx); if (r) return r;
      const pg = page(ctx);
      if (!pg) return skip('No page content');
      const m = /(?:window\.|document\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)/i.exec(pg.inlineJs) || /url=(https?:\/\/[^"';]+)/i.exec(pg.metaRefresh);
      const target = m && analyze(m[1]);
      return target && target.registrable !== ctx.p.registrable ? warn(10, `Script redirects to ${target.host}`) : pass('No off-site script redirects');
    } }
];

const ALL_CHECKS = [...KNOWLEDGE_CHECKS, ...URL_CHECKS, ...COMPARE_CHECKS, ...INFRA_CHECKS, ...CONTENT_CHECKS];

/** Run every check against a scan context. Exceptions in one check never break the scan. */
function runChecklist(ctx) {
  const results = [];
  for (const check of ALL_CHECKS) {
    let out;
    try {
      out = check.run(ctx) || pass('');
    } catch (err) {
      // A broken rule must never break a scan in production - but it must be
      // loud everywhere else, or it silently stops protecting anyone.
      if (!config.isProd) throw new Error(`Checklist rule ${check.id} crashed: ${err.message}`);
      if (!reported.has(check.id)) { reported.add(check.id); console.error(`[checklist] ${check.id} crashed:`, err); }
      out = skip('Check could not run');
    }
    results.push({ id: check.id, group: check.group, threat: check.threat, title: check.title, research: Boolean(check.research), ...out });
  }
  return results;
}

module.exports = { runChecklist, ALL_CHECKS };
