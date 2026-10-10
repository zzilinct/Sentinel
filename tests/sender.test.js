'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readHeaders, senderProof } = require('../server/lib/scan/sender');
const { analyzeEmail } = require('../server/lib/scan/email');

// Header fixtures written by hand for these tests, in the shape Gmail and Outlook write them. No real mail.

const REAL_PAYPAL = [
  'Authentication-Results: mx.google.com;',
  '       dkim=pass header.i=@paypal.com header.s=pp-dkim1 header.b=AbCdEf12;',
  '       spf=pass (google.com: domain of service@paypal.com designates 192.0.2.10 as permitted sender) smtp.mailfrom=service@paypal.com;',
  '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=paypal.com',
  'Received-SPF: pass (google.com: domain of service@paypal.com designates 192.0.2.10 as permitted sender) client-ip=192.0.2.10;',
  'DKIM-Signature: v=1; a=rsa-sha256; d=paypal.com; s=pp-dkim1; h=from:subject; b=AbCdEf12',
  'Return-Path: <service@paypal.com>'
].join('\n');

const SPOOFED_PAYPAL = [
  'Authentication-Results: mx.google.com;',
  '       spf=pass (google.com: domain of bounce@mailer-xyz.ru designates 198.51.100.7 as permitted sender) smtp.mailfrom=bounce@mailer-xyz.ru;',
  '       dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=paypal.com',
  'Return-Path: <bounce@mailer-xyz.ru>'
].join('\n');

// A scammer can put their own Authentication-Results lower down; only the top one, the receiving service's, counts.
const PLANTED = [
  'Authentication-Results: spf=pass (sender IP is 198.51.100.7) smtp.mailfrom=mailer-xyz.ru; dkim=none (message not signed) header.d=none; dmarc=fail action=quarantine header.from=paypal.com;',
  'Authentication-Results: fake.example; dmarc=pass header.from=paypal.com',
  'Return-Path: bounce@mailer-xyz.ru'
].join('\n');

const SHOP_VIA_SERVICE = [
  'Authentication-Results: mx.google.com;',
  '       dkim=pass header.i=@mcsv.example header.s=k1;',
  '       spf=pass smtp.mailfrom=bounce-mc.us1_123@mail.mcsv.example'
].join('\n');

const NO_CHECKS = [
  'Authentication-Results: mx.google.com; spf=none smtp.mailfrom=hello@tinyshop.example; dkim=none; dmarc=none header.from=tinyshop.example'
].join('\n');

test('folded header lines are joined, names lower-cased', () => {
  const h = readHeaders('Received-SPF: pass\n  (comment)\nSubject: Hi\nnot a header line\n  stray fold');
  assert.deepEqual(h, [['received-spf', 'pass (comment)'], ['subject', 'Hi']]);
});

test('a message DMARC passed for its From domain is really sent by it', () => {
  const p = senderProof(REAL_PAYPAL, 'paypal.com');
  assert.equal(p.status, 'really');
  assert.equal(p.text, 'Really sent by paypal.com');
});

test('aligned DKIM alone is proof, also for a subdomain of the same site', () => {
  assert.equal(senderProof('Authentication-Results: mx; dkim=pass header.d=email.paypal.com', 'paypal.com').status, 'really');
  assert.equal(senderProof('Authentication-Results: mx; spf=pass smtp.mailfrom=bounce@mail.paypal.com', 'paypal.com').status, 'really');
});

test('a failed DMARC says where it came from instead', () => {
  const p = senderProof(SPOOFED_PAYPAL, 'paypal.com');
  assert.equal(p.status, 'not');
  assert.equal(p.cameFrom, 'mailer-xyz.ru');
  assert.equal(p.checksFailed, true);
  assert.equal(p.text, 'Not sent by paypal.com: it came from mailer-xyz.ru');
});

test('only the topmost Authentication-Results counts', () => {
  const p = senderProof(PLANTED, 'paypal.com');
  assert.equal(p.status, 'not');
  assert.equal(p.cameFrom, 'mailer-xyz.ru');
});

test('Received-SPF fills in when there is no Authentication-Results', () => {
  const pass = senderProof('Received-SPF: pass (outlook.com: domain of alerts@chase.com designates 192.0.2.1) receiver=x; envelope-from="alerts@chase.com"', 'chase.com');
  assert.equal(pass.status, 'really');
  const soft = senderProof('Received-SPF: softfail (domain of transitioning chase.com does not designate 203.0.113.9) envelope-from=alerts@chase.com\nReturn-Path: <x@cheap-host.example>', 'chase.com');
  assert.equal(soft.status, 'not');
  assert.equal(soft.text, 'Not sent by chase.com: it came from cheap-host.example');
});

test('passed for another domain only: sent on its behalf, by someone else', () => {
  const p = senderProof(SHOP_VIA_SERVICE, 'tinyshop.example');
  assert.equal(p.status, 'not');
  assert.equal(p.checksFailed, false);
  assert.equal(p.cameFrom, 'mcsv.example');
});

test('no checks at all prove nothing either way', () => {
  assert.equal(senderProof(NO_CHECKS, 'tinyshop.example').status, 'unknown');
});

test('headers with no sender checks, or no From domain, give no answer', () => {
  assert.equal(senderProof('', 'paypal.com'), null);
  assert.equal(senderProof('DKIM-Signature: d=paypal.com\nReturn-Path: <a@paypal.com>', 'paypal.com'), null);
  assert.equal(senderProof(REAL_PAYPAL, ''), null);
});

/* In the email checklist */

const check = (mail) => analyzeEmail(mail).checks.find((c) => c.id === 'E31');
const PAYPAL_MAIL = { from: 'PayPal <service@paypal.com>', subject: 'Verify your account', body: 'Please verify your account details.' };

test('a spoofed brand fails, is marked on the From domain, and loses the softening of its own domain', () => {
  const r = analyzeEmail({ ...PAYPAL_MAIL, headers: SPOOFED_PAYPAL });
  const c = r.checks.find((x) => x.id === 'E31');
  assert.equal(c.status, 'fail');
  assert.equal(c.detail, 'Not sent by paypal.com: it came from mailer-xyz.ru');
  assert.deepEqual(c.marks, [{ field: 'from', start: 16, end: 26 }]);
  assert.deepEqual(r.sender.proof, { status: 'not', text: 'Not sent by paypal.com: it came from mailer-xyz.ru' });
  // "Verify your account" from the real paypal.com is how PayPal writes; from a forger it counts.
  assert.equal(r.checks.find((x) => x.id === 'E06').status, 'fail');
});

test('the real one passes and keeps its softening', () => {
  const r = analyzeEmail({ ...PAYPAL_MAIL, headers: REAL_PAYPAL });
  assert.equal(check({ ...PAYPAL_MAIL, headers: REAL_PAYPAL }).status, 'pass');
  assert.equal(r.sender.proof.text, 'Really sent by paypal.com');
  assert.equal(r.checks.find((x) => x.id === 'E06').status, 'pass');
});

test('a small shop sending through a mail service is only noted', () => {
  assert.equal(check({ from: 'Tiny Shop <hello@tinyshop.example>', subject: 'New in', body: 'Hi', headers: SHOP_VIA_SERVICE }).status, 'warn');
});

test('without headers the check is skipped and says why', () => {
  const c = check(PAYPAL_MAIL);
  assert.equal(c.status, 'skip');
  assert.equal(c.detail, 'No headers pasted');
  assert.equal(analyzeEmail(PAYPAL_MAIL).sender.proof, undefined);
});
