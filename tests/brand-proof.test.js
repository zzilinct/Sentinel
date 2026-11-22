'use strict';
/**
 * The brand-domain proof (scripts/brand-proof.js), without the network: which domains a change adds, and what counts
 * as a link or an organisation. The lookups themselves run on GitHub's machines only (brand-proof.yml).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { addedDomains, linksTo, sameOrg, covers, rdapOrg, registrarLink } = require('../scripts/brand-proof');

test('only domains a brand gains are checked, each against the ones it already had', () => {
  const before = [{ token: 'stripe', domains: ['stripe.com'] }];
  const after = [{ token: 'stripe', domains: ['stripe.com', 'stripe.dev'] }, { token: 'acme', domains: ['acme.com', 'acme.dev', 'acme'] }];
  assert.deepEqual(addedDomains(before, after), [
    { token: 'stripe', domain: 'stripe.dev', proven: ['stripe.com'] },
    { token: 'acme', domain: 'acme.dev', proven: ['acme.com'] }
  ]);
  assert.deepEqual(addedDomains(after, after), []);
});

test('a link is the domain or a site under it, never a longer name that ends the same way', () => {
  assert.ok(linksTo('<a href="https://stripe.dev/">', 'stripe.dev'));
  assert.ok(linksTo('<a href="https://docs.stripe.dev/x">', 'stripe.dev'));
  assert.ok(!linksTo('<a href="https://notstripe.dev/">', 'stripe.dev'));
  assert.ok(!linksTo('<a href="https://stripe.dev.example.com/">', 'stripe.dev'));
});

test('an organisation matches the main site\'s or names the brand; a privacy service never does', () => {
  assert.ok(sameOrg('Meta Platforms, Inc.', 'Meta Platforms, Inc', 'facebook'));
  assert.ok(sameOrg('Stripe, Inc.', '', 'stripe'));
  assert.ok(!sameOrg('', '', 'stripe'));
  assert.ok(!sameOrg('REDACTED FOR PRIVACY', 'REDACTED FOR PRIVACY', 'stripe'));
  assert.ok(!sameOrg('Domains By Proxy, LLC', 'Domains By Proxy, LLC', 'stripe'));
});

test('a certificate covers a name exactly or by a one-level wildcard, never a deeper or longer name', () => {
  assert.ok(covers(['google.org'], 'google.org'));
  assert.ok(covers(['*.google.com'], 'www.google.com'));
  assert.ok(!covers(['*.google.com'], 'google.com'));
  assert.ok(!covers(['*.google.com'], 'a.b.google.com'));
  assert.ok(!covers(['*.google.com'], 'notgoogle.com'));
});

test('RDAP: the registrant\'s organisation, and the registrar record a thin registry points to', () => {
  const vcard = (org) => ['vcard', [['version', {}, 'text', '4.0'], ['org', {}, 'text', org]]];
  const thin = { entities: [{ roles: ['registrar'], vcardArray: vcard('MarkMonitor Inc.') }],
    links: [{ rel: 'self', href: 'https://rdap.verisign.com/net/v1/domain/VERIZON.NET' },
      { rel: 'related', type: 'application/rdap+json', href: 'https://rdap.markmonitor.com/rdap/domain/VERIZON.NET' }] };
  assert.equal(rdapOrg(thin), '', 'a registrar is not the registrant');
  assert.equal(rdapOrg(null), '', 'no answer is no registrant');
  assert.equal(registrarLink(null), undefined);
  assert.equal(registrarLink(thin).href, 'https://rdap.markmonitor.com/rdap/domain/VERIZON.NET');
  assert.equal(rdapOrg({ entities: [{ roles: ['registrant'], vcardArray: vcard('Verizon Trademark Services LLC') }] }), 'Verizon Trademark Services LLC');
  assert.equal(rdapOrg({ entities: [{ roles: ['registrant'], vcardArray: vcard('REDACTED FOR PRIVACY') }] }), '');
});

test('every change to the brand list runs the proof on GitHub', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'brand-proof.yml'), 'utf8');
  assert.match(wf, /paths: \['server\/lib\/scan\/brands\.js'/);
  assert.match(wf, /node scripts\/brand-proof\.js --base/);
});
