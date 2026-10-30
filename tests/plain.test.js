'use strict';
/**
 * The result page's honesty: every finding has one plain sentence (server/lib/scan/plain.js), a clue is said once, and
 * no part that did not run ever reads as green (web/assets/js/ui.js).
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { SENTENCES, plainFor, cluesOf, withPlain, researchGaps, listGaps, coverage } = require('../server/lib/scan/plain');
const { ALL_CHECKS } = require('../server/lib/scan/checklist');
const { analyzeEmail } = require('../server/lib/scan/email');
const { scanFile } = require('../server/lib/scan/filescan');
const { _test: { checksOf } } = require('../server/lib/scan/offline');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'scan', file), 'utf8');
const idsIn = (text, re) => [...new Set([...text.matchAll(re)].map((m) => m[1]))];

// Checks that only ever pass: they speak for a site, so they never need a reason.
const NEVER_A_CONCERN = new Set(['U36', 'K05']);
const everyId = [
  ...ALL_CHECKS.map((c) => c.id),
  ...idsIn(source('email.js'), /add\('(E\d+)'/g),
  ...idsIn(source('filescan.js'), /add\('(F\d+)'/g),
  'Y01', 'EL-scam', 'EL-malware', 'EL-virus', 'D-limit'
];

/* ------------------------------------------------------------ the sentences */

test('every check that can raise a concern has a plain sentence, and no sentence is left over', () => {
  const missing = everyId.filter((id) => !NEVER_A_CONCERN.has(id) && !SENTENCES[id]);
  assert.deepEqual(missing, []);
  const leftOver = Object.keys(SENTENCES).filter((id) => !everyId.includes(id));
  assert.deepEqual(leftOver, []);
  assert.ok(everyId.length > 150, `the scan of the source found only ${everyId.length} checks`);
});

// Words a person who does not work with computers would have to look up.
const JARGON = /punycode|subdomain|\bdns\b|\btld\b|\bhttps?\b|\btls\b|\bssl\b|\brdap\b|registrar|registry|\bhash\b|sha-?256|entropy|obfuscat|\biframe|\bapi\b|\bvps\b|\bparameter|percent-encoded|combosquat|phishing|\bredirect|\beicar\b|\bdropper|\bpe\b/i;

test('each sentence is one calm sentence: no rule id, no jargon, no em dash', () => {
  for (const [id, [clue, first, ...rest]] of Object.entries(SENTENCES)) {
    assert.match(clue, /^[a-z-]+$/, id);
    const sentences = [first, ...rest.filter((x) => typeof x === 'string')].filter(Boolean);
    assert.ok(sentences.length || first === null, `${id} has no sentence`);
    for (const s of sentences) {
      assert.match(s, /[.]$/, `${id}: "${s}"`);
      assert.doesNotMatch(s.replace(/\.\$?\d?[a-z]*\b/gi, ''), /[.!?]\s+[A-Z]/, `${id} says more than one sentence: "${s}"`);
      assert.doesNotMatch(s, /\b[A-Z]{1,2}\d{2}\b/, `${id} carries a rule id: "${s}"`);
      assert.doesNotMatch(s, JARGON, `${id}: "${s}"`);
      assert.ok(!s.includes('—'), `${id} has an em dash`);
      assert.ok(s.length <= 125, `${id} is long for one sentence (${s.length}): "${s}"`);
    }
  }
});

test('a sentence fills in what the check found, and falls back when the detail changes', () => {
  assert.equal(plainFor({ id: 'U24', detail: 'Near-identical spelling of paypal.com' }), 'The name is spelled almost like paypal.com, but it is a different site.');
  assert.equal(plainFor({ id: 'R01', detail: 'Registered 3 day(s) ago' }), 'This site was created less than two weeks ago.');
  assert.equal(plainFor({ id: 'R01', detail: 'Registered 40 days ago' }), 'This site was created only 40 days ago.');
  assert.equal(plainFor({ id: 'U24', detail: 'Reworded next year' }), 'The name is spelled almost like a well-known site, but it is a different site.');
  assert.equal(plainFor({ id: 'D-F07', detail: 'Keylogger behaviour' }), 'This program can record what you type.', 'a downloaded file reads like an uploaded one');
  assert.equal(plainFor({ id: 'Y01', detail: 'This is not harbourcu.org.' }), 'This is not harbourcu.org.', 'already plain, kept');
  assert.equal(plainFor({ id: 'NOPE', detail: 'x' }), null);
});

// The real details, from the real checks: the patterns above have to match what the checks really say.
const urlConcerns = (url) => checksOf(url).filter((c) => c.status === 'fail' || c.status === 'warn');

test('real findings read in plain words, with what was found filled in and nothing unfilled', () => {
  const found = [
    ...urlConcerns('https://paypa1-secure-login.com/account/verify'),
    ...urlConcerns('http://192.0.2.7/login'),
    ...urlConcerns('https://bit.ly/abc123'),
    ...urlConcerns('https://apple-soporte.example.tk/setup.exe'),
    ...analyzeEmail({ from: 'PayPal <service@paypa1-mail.com>', subject: 'URGENT: verify your account', body: 'Dear customer, confirm your login and pay with gift cards.', attachments: ['invoice.pdf.exe'] }, {}).checks.filter((c) => c.status === 'fail' || c.status === 'warn')
  ];
  assert.ok(found.length >= 8, `${found.length} concerns`);
  for (const c of found) {
    const text = plainFor(c);
    assert.ok(text, `${c.id} has no sentence: ${c.detail}`);
    assert.doesNotMatch(text, /\$\d|undefined/, `${c.id}: ${text}`);
  }
  assert.ok(found.some((c) => /paypal\.com/.test(plainFor(c))), 'the real site is named');
});

test('a file\'s findings have sentences too, and the locked archive is said plainly', () => {
  const { checks } = scanFile(Buffer.from('Rar!\x1a\x07\x00 some bytes'), 'photos.rar');
  const locked = checks.find((c) => c.id === 'F11');
  assert.equal(locked.status, 'warn');
  assert.match(plainFor(locked), /could not list what is inside/);
});

/* ---------------------------------------------------- one clue, said once */

test('three checks that read the same words become one clue, strongest first, with no rule id', () => {
  const concerns = urlConcerns('https://paypa1-secure-login.com/account/verify');
  const clues = cluesOf(concerns);
  assert.ok(clues.length <= 4 && clues.length >= 2, JSON.stringify(clues));
  assert.equal(new Set(clues.map((c) => c.clue)).size, clues.length, 'each clue once');
  assert.equal(clues.filter((c) => c.clue === 'bait').length, 1, 'the bait words count once');
  assert.ok(clues.every((c) => !('id' in c) && !/\b[A-Z]\d{2}\b/.test(c.text)));
  assert.equal(clues[0].clue, 'listed', 'the strongest finding leads: this address is on Sentinel\'s own list');
  assert.ok(clues.some((c) => c.clue === 'lookalike'));
});

test('a concern gets its sentence on the check, and a passed or skipped one is left as it was', () => {
  const [fail, pass] = withPlain([{ id: 'U09', status: 'warn', detail: 'Unencrypted HTTP', points: 8 }, { id: 'U09', status: 'pass', detail: 'HTTPS', points: 0 }]);
  assert.match(fail.plain, /not encrypted/);
  assert.equal(pass.plain, undefined);
});

/* ---------------------------------------- what could not be looked at */

const FACTS = { registration: { available: true }, dns: { resolves: true }, http: { ok: true, status: 200 } };

test('research that finished leaves no gap; each part that did not is named', () => {
  const what = (facts) => researchGaps(facts).map((g) => g.what);
  assert.deepEqual(what(null), [], 'a fast scan had nothing to finish');
  assert.deepEqual(what(FACTS), []);
  assert.deepEqual(what({ ...FACTS, registration: { available: false, reason: 'not answered in time' } }), ['registration']);
  assert.deepEqual(what({ ...FACTS, dns: { unavailable: true } }), ['dns']);
  assert.deepEqual(what({ ...FACTS, http: { ok: false, status: 403 } }), ['page'], 'a site that blocks Sentinel');
  assert.deepEqual(what({ ...FACTS, http: { ok: false } }), ['page'], 'a site that does not answer');
  assert.deepEqual(what({ ...FACTS, http: { ok: true, status: 200, truncated: true } }), ['page']);
  assert.deepEqual(what({ ...FACTS, lite: true, http: { ok: false } }), [], 'registry-only research never opens the page');
});

test('a list that has not loaded or did not answer is a gap', () => {
  assert.deepEqual(listGaps({ feeds: { ready: 15, total: 15 }, unreached: null }), []);
  const [lists] = listGaps({ feeds: { ready: 12, total: 15 } });
  assert.match(lists.text, /^3 of 15 threat lists/);
  assert.equal(listGaps({ feeds: null, unreached: 'Google Safe Browsing' })[0].what, 'live-list');
  assert.equal(coverage([{ what: 'dns' }, { what: 'dns' }]).missing.length, 1, 'one gap said once');
  assert.equal(coverage([]).complete, true);
});

/* ------------------------------------------------------- no false green */

const win = { SentinelSteps: require('../web/assets/js/steps.js'), location: { pathname: '/app/scan' },
  SentinelMasks: { svg: () => '<svg></svg>', kindIcon: () => '<svg></svg>', NAMES: { scam: 'Scam', virus: 'Virus', malware: 'Malware' } } };
win.window = win;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'js', 'ui.js'), 'utf8'), win);

const safe = (t) => ({ level: 'safe', badge: null, label: `No ${t} signs`, score: 0, evidence: null });
const skip = (id, group) => ({ id, group, threat: 'scam', title: `Title of ${id}`, status: 'skip', points: 0, detail: 'Research is included with Pro, Max and Ultimate scans' });
const pass = (id, group) => ({ id, group, threat: 'scam', title: `Title of ${id}`, status: 'pass', points: 0, detail: 'Fine' });
const result = (over = {}) => {
  const items = over.items || [pass('U01', 'Address'), skip('R01', 'Registration'), skip('R02', 'Registration'), skip('P01', 'Page content')];
  return { ok: true, kind: 'url', host: 'example-bakery.com', url: 'https://example-bakery.com/', researched: false, researchSkipReason: 'Research is included with Pro, Max and Ultimate scans',
    threats: { scam: safe('scam'), virus: safe('virus'), malware: safe('malware') }, clues: [], reasons: [],
    coverage: { complete: true, missing: [] },
    checklist: { total: items.length, failed: 0, warned: 0, passed: items.filter((c) => c.status === 'pass').length, skipped: items.filter((c) => c.status === 'skip').length, items }, ...over };
};
const LISTS = { what: 'lists', text: '3 of 15 threat lists, because they have not loaded yet', retry: true };
const PAGE = { what: 'page', text: 'the page itself, because the site would not show it to Sentinel', retry: true };
const words = (html) => html.replace(/<[^>]+>/g, ' ');

test('a scan that ran in full may be green, and says what it rests on', () => {
  const html = win.UI.verdict(result());
  assert.match(html, /result--clear/);
  assert.match(html, /No threats found/);
  assert.match(words(html), /did not open the site/, 'a fast scan does not claim the site was looked at');
});

test('no green when part of a scan did not run: not the verdict, not the tiles, not a word of it', () => {
  for (const coverageOf of [{ complete: false, missing: [LISTS] }, { complete: false, missing: [PAGE, LISTS] }, { complete: false, missing: [] }, undefined]) {
    const v = result({ coverage: coverageOf });
    const html = win.UI.verdict(v);
    assert.equal(win.UI.headline(v).title, 'Partly checked', JSON.stringify(coverageOf));
    assert.equal(win.UI.headline(v).tone, 'partial');
    assert.doesNotMatch(html, /result--clear/);
    assert.doesNotMatch(html, /var\(--green\)/, 'nothing green');
    assert.doesNotMatch(html, /No threats found|>Clear</);
    assert.match(html, /Nothing found so far/);
    assert.match(words(html), /not a sign of danger/, 'a gap is not a finding');
    assert.match(win.UI.reportText(v), /^Sentinel scan: Partly checked/, 'nor does the copied report say otherwise');
  }
  const twoGaps = win.UI.verdict(result({ coverage: { complete: false, missing: [PAGE, LISTS] } }));
  assert.match(twoGaps, /Not checked: the page itself.*; 3 of 15 threat lists/);
  assert.equal((twoGaps.match(/data-partly/g) || []).length, 1, 'said once');
});

test('a warning stays a warning when partly checked, and says so without calling it harmless', () => {
  const v = result({ coverage: { complete: false, missing: [PAGE] },
    threats: { scam: { level: 'confirmed', badge: 'red', label: 'Confirmed scam', score: 100, evidence: 'OpenPhish: phishing', kind: null }, virus: safe('virus'), malware: safe('malware') },
    clues: [{ clue: 'listed', threat: 'scam', status: 'fail', text: 'Threat lists name this address as a scam.' }] });
  const html = win.UI.verdict(v);
  assert.equal(win.UI.headline(v).title, 'This is a confirmed scam');
  assert.match(html, /result--red/);
  assert.match(words(html), /Partly checked\. Not checked: the page itself/);
  assert.doesNotMatch(words(html), /not a sign of danger/);
  assert.doesNotMatch(html, />Clear</, 'the other threats are not called clear either');
});

test('nothing conclusive is not green and not called no threats', () => {
  const v = result({ threats: { scam: { ...safe('scam'), level: 'caution', label: 'Nothing conclusive', score: 20 }, virus: safe('virus'), malware: safe('malware') },
    clues: [{ clue: 'odd-name', threat: 'scam', status: 'warn', text: 'The site name is unusually long.' }] });
  const html = win.UI.verdict(v);
  assert.equal(win.UI.headline(v).title, 'Nothing conclusive');
  assert.doesNotMatch(html, /result--clear|No threats found/);
  assert.match(words(html), /Small things Sentinel noticed/);
});

test('small warnings under a clear verdict are not hidden behind "nothing raised a concern"', () => {
  const v = result({ clues: [{ clue: 'unsafe', threat: 'scam', status: 'warn', text: 'This page is not encrypted, so anything you type could be read by others.' }] });
  const html = words(win.UI.verdict(v));
  assert.match(html, /Only small things stood out/);
  assert.match(html, /not encrypted/);
});

test('checks that did not run are one quiet line, never grey rows', () => {
  const html = win.UI.verdict(result());
  assert.doesNotMatch(html, /check--skip|data-status="skip"|not run<|skipped|data-status-filter="skip"/);
  assert.doesNotMatch(html, /Registration|Page content/, 'a group of nothing but skips is not drawn');
  assert.match(words(html), /3 checks did not run\. Research is included with Pro, Max and Ultimate scans\./);
  assert.equal((html.match(/data-not-run/g) || []).length, 1);
  assert.doesNotMatch(win.UI.verdict(result({ items: [pass('U01', 'Address')] })), /data-not-run/, 'nothing skipped, no line');
  const one = result({ items: [skip('R01', 'Registration')], researched: true });
  assert.match(words(win.UI.verdict(one)), /1 check did not run\. It did not apply/);
});

test('a list that has not loaded is not blamed for what the plan left out, and is not counted as checked', () => {
  const v = result({ coverage: { complete: false, missing: [LISTS] }, knowledge: { sources: new Array(16).fill('x'), feeds: { ready: 13, total: 15 }, known: false, trusted: false } });
  const html = words(win.UI.verdict(v));
  assert.match(html, /3 checks did not run\. Research is included/);
  assert.doesNotMatch(html, /depend on what could not/);
  assert.match(html, /14 of 16 checked/);
  const researched = result({ researched: true, coverage: { complete: false, missing: [PAGE] } });
  assert.match(words(win.UI.verdict(researched)), /Some may depend on what could not be checked/);
});

test('"checked against every threat source" is not ticked while a list is missing', () => {
  const k05 = ALL_CHECKS.find((c) => c.id === 'K05');
  const sources = ['a', 'b'];
  assert.equal(k05.run({ knowledge: { sources, feeds: { ready: 2, total: 2 } } }).status, 'pass');
  assert.equal(k05.run({ knowledge: { sources, feeds: { ready: 1, total: 2 } } }).status, 'skip');
});

test('hierarchy: verdict, then the reason that matters most, then details on demand; no rule id on the page', () => {
  const items = [{ id: 'U24', group: 'Impersonation', threat: 'scam', title: 'Not a misspelling', status: 'fail', points: 70, detail: 'Near-identical spelling of paypal.com', plain: 'The name is spelled almost like paypal.com, but it is a different site.' }];
  const v = result({ items, checklist: { total: 1, failed: 1, warned: 0, passed: 0, skipped: 0, items },
    threats: { scam: { level: 'likely', badge: 'orange', label: 'Likely scam', score: 70, evidence: null, kind: null }, virus: safe('virus'), malware: safe('malware') },
    clues: [{ clue: 'lookalike', threat: 'scam', status: 'fail', text: items[0].plain }, { clue: 'bait', threat: 'scam', status: 'fail', text: 'The address uses words scammers like, such as secure, login.' }] });
  const html = win.UI.verdict(v);
  const at = (needle) => { const i = html.indexOf(needle); assert.ok(i > -1, needle); return i; };
  assert.ok(at('<h2>') < at('result__lead') && at('result__lead') < at('data-more') && at('data-more') < at('threat-list') && at('threat-list') < at('result__checklist'));
  assert.ok(html.indexOf('spelled almost like paypal.com') < at('data-more'), 'the lead reason is outside the details');
  assert.ok(at('Other clues') < at('data-more'));
  assert.equal(html.split('spelled almost like paypal.com').length, 3, 'once as the lead, once in the details');
  assert.doesNotMatch(words(html), /\bU24\b/);
  assert.match(html, /<details class="result__more"[^>]*>\s*<summary>/, 'a native control, so the keyboard reaches it');
  assert.doesNotMatch(html, /<details class="result__more"[^>]*\bopen\b/, 'closed until asked for');
});
