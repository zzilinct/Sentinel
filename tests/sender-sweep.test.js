'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { senderProof } = require('../server/lib/scan/sender');
const { analyzeEmail } = require('../server/lib/scan/email');

// Legitimate header sets written by hand for this test, in the shape Gmail and Outlook write them, for made-up
// senders. No real mail. Each is honest: none may be called "Not sent by", and E31 must not fail or warn.
const H = (...lines) => lines.join('\n');
const HONEST = [
  ['a newsletter through Mailchimp, no DMARC, no own signature', 'news@tinybakery.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@mcsv.net header.s=k2 header.b=Q1w2E3r4;',
    '       dkim=pass header.i=@mailchimpapp.net header.s=k3 header.b=T5y6U7i8;',
    '       spf=pass (google.com: domain of bounce-mc.us21_1234567.890-hello=reader.example@mail123.suw11.mcsv.net designates 198.2.180.1 as permitted sender) smtp.mailfrom="bounce-mc.us21_1234567.890-hello=reader.example@mail123.suw11.mcsv.net"',
    'Return-Path: <bounce-mc.us21_1234567.890-hello=reader.example@mail123.suw11.mcsv.net>',
    'List-Unsubscribe: <https://tinybakery.us21.list-manage.com/unsubscribe?u=abc&id=def>')],
  ['a newsletter through Mailchimp with its own signature and DMARC', 'news@riverbooks.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@riverbooks.example header.s=k2 header.b=A1b2C3d4;',
    '       dkim=pass header.i=@mcsv.net header.s=k2 header.b=E5f6G7h8;',
    '       spf=pass (google.com: domain of bounce-mc.us5_99.11-x=reader.example@mail77.atl11.rsgsv.net designates 198.2.139.1 as permitted sender) smtp.mailfrom="bounce-mc.us5_99.11-x=reader.example@mail77.atl11.rsgsv.net";',
    '       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=riverbooks.example')],
  ['a shop through SendGrid with its own domain set up', 'orders@lampshop.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@lampshop.example header.s=s1 header.b=ZzYyXx11;',
    '       spf=pass (google.com: domain of bounces+1234567-ab12-reader=reader.example@em4321.lampshop.example designates 149.72.1.1 as permitted sender) smtp.mailfrom="bounces+1234567-ab12-reader=reader.example@em4321.lampshop.example";',
    '       dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=lampshop.example')],
  ['a club through SendGrid without its own domain set up', 'hello@chessclub.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@sendgrid.net header.s=smtpapi header.b=Pq9Rs8Tu;',
    '       spf=pass (google.com: domain of bounces+7654321-cd34-reader=reader.example@sendgrid.net designates 167.89.1.1 as permitted sender) smtp.mailfrom="bounces+7654321-cd34-reader=reader.example@sendgrid.net"',
    'Return-Path: <bounces+7654321-cd34-reader=reader.example@sendgrid.net>')],
  ['receipts through Amazon SES with a signature for the shop', 'receipts@teashop.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@teashop.example header.s=abcdefgh header.b=Lm3No4Pq;',
    '       dkim=pass header.i=@amazonses.com header.s=ug7nbtf header.b=Rs5Tu6Vw;',
    '       spf=pass (google.com: domain of 0100018abc-def0-1234@us-west-2.amazonses.com designates 54.240.27.1 as permitted sender) smtp.mailfrom=0100018abc-def0-1234@us-west-2.amazonses.com;',
    '       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=teashop.example')],
  ['a school app through Amazon SES only', 'noreply@schoolnotes.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@amazonses.com header.s=6gbrjpgw header.b=Xy7Za8Bc;',
    '       spf=pass (google.com: domain of 0100018def-1111-2222@amazonses.com designates 54.240.8.1 as permitted sender) smtp.mailfrom=0100018def-1111-2222@amazonses.com')],
  ['a message a friend forwarded by hand', 'sam.lee.example@gmail.com', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@gmail.com header.s=20230601 header.b=Gh1Ij2Kl;',
    '       spf=pass (google.com: domain of sam.lee.example@gmail.com designates 209.85.220.41 as permitted sender) smtp.mailfrom=sam.lee.example@gmail.com;',
    '       dmarc=pass (p=NONE sp=QUARANTINE dis=NONE) header.from=gmail.com')],
  ['bank mail auto-forwarded from a university address', 'alerts@northbank.example', H(
    'ARC-Authentication-Results: i=1; mx.uni.example; dkim=pass header.d=northbank.example; spf=pass smtp.mailfrom=northbank.example; dmarc=pass header.from=northbank.example',
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@northbank.example header.s=sel1 header.b=Mn3Op4Qr;',
    '       arc=pass (i=1 spf=pass spfdomain=northbank.example dkim=pass dkdomain=northbank.example dmarc=pass fromdomain=northbank.example);',
    '       spf=pass (google.com: domain of srs0=ab12=xy=northbank.example=alerts@uni.example designates 192.0.2.44 as permitted sender) smtp.mailfrom="SRS0=ab12=XY=northbank.example=alerts@uni.example";',
    '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=northbank.example')],
  ['bank mail forwarded into Outlook', 'alerts@northbank.example', H(
    'Authentication-Results: spf=pass (sender IP is 192.0.2.44) smtp.mailfrom=uni.example; dkim=pass (signature was verified) header.d=northbank.example;dmarc=pass action=none header.from=northbank.example;compauth=pass reason=100',
    'Received-SPF: Pass (protection.outlook.com: domain of uni.example designates 192.0.2.44 as permitted sender) receiver=protection.outlook.com; client-ip=192.0.2.44; helo=mx.uni.example;')],
  ['a Google Group that rewrites the From line', 'hiking-club@googlegroups.com', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@googlegroups.com header.s=20230601 header.b=Uv5Wx6Yz;',
    '       arc=pass (i=2);',
    '       spf=pass (google.com: domain of hiking-club+bncBDX12345@googlegroups.com designates 209.85.220.69 as permitted sender) smtp.mailfrom=hiking-club+bncBDX12345@googlegroups.com;',
    '       dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=googlegroups.com',
    'List-Id: <hiking-club.googlegroups.com>')],
  ['a mailing list that keeps the From line, for a domain with p=none', 'ann@smallclub.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=neutral (body hash did not verify) header.i=@smallclub.example header.s=mail header.b=Ab1Cd2Ef;',
    '       dkim=pass header.i=@lists.birders.example header.s=list header.b=Gh3Ij4Kl;',
    '       spf=pass (google.com: domain of talk-bounces@lists.birders.example designates 203.0.113.80 as permitted sender) smtp.mailfrom=talk-bounces@lists.birders.example;',
    '       dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=smallclub.example',
    'List-Id: Birders talk <talk.lists.birders.example>',
    'Return-Path: <talk-bounces@lists.birders.example>')],
  ['a mailing list that writes "via" in the From line', 'talk@lists.birders.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@lists.birders.example header.s=list header.b=Mn5Op6Qr;',
    '       spf=pass smtp.mailfrom=talk-bounces@lists.birders.example;',
    '       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=lists.birders.example',
    'List-Id: Birders talk <talk.lists.birders.example>')],
  ['a bank with DMARC', 'service@northbank.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@northbank.example header.s=s2048 header.b=St7Uv8Wx;',
    '       spf=pass (google.com: domain of service@northbank.example designates 192.0.2.20 as permitted sender) smtp.mailfrom=service@northbank.example;',
    '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=northbank.example',
    'DKIM-Signature: v=1; a=rsa-sha256; d=northbank.example; s=s2048; h=from:to:subject; b=St7Uv8Wx',
    'Return-Path: <service@northbank.example>')],
  ['a bank newsletter through a marketing service on its own subdomain', 'news@email.northbank.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@email.northbank.example header.s=200608 header.b=Yz9Ab0Cd;',
    '       spf=pass (google.com: domain of bounce-12_HTML-345@bounce.email.northbank.example designates 192.0.2.99 as permitted sender) smtp.mailfrom=bounce-12_HTML-345@bounce.email.northbank.example;',
    '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=email.northbank.example')],
  ['a small business on Google Workspace without its own signature or DMARC', 'office@plumbing.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@plumbing-example.20230601.gappssmtp.com header.s=20230601 header.b=Ef1Gh2Ij;',
    '       spf=pass (google.com: domain of office@plumbing.example designates 209.85.220.41 as permitted sender) smtp.mailfrom=office@plumbing.example')],
  ['a small business on Google Workspace without SPF either', 'office@florist.example', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@florist-example.20230601.gappssmtp.com header.s=20230601 header.b=Kl3Mn4Op;',
    '       spf=neutral (google.com: 209.85.220.41 is neither permitted nor denied by best guess record for domain of office@florist.example) smtp.mailfrom=office@florist.example')],
  ['a small business on Microsoft 365 without DMARC, in Outlook', 'hello@cornercafe.example', H(
    'Authentication-Results: spf=pass (sender IP is 40.107.1.1) smtp.mailfrom=cornercafe.example; dkim=pass (signature was verified) header.d=cornercafe.onmicrosoft.com;dmarc=none action=none header.from=cornercafe.example;compauth=pass reason=102')],
  ['a small business on Microsoft 365 with no SPF set up', 'hello@bikerepair.example', H(
    'Authentication-Results: spf=none (sender IP is 40.107.2.2) smtp.mailfrom=bikerepair.example; dkim=pass (signature was verified) header.d=bikerepair.onmicrosoft.com;dmarc=none action=none header.from=bikerepair.example;compauth=pass reason=109')],
  ['a small business on a web host with no checks set up', 'info@guesthouse.example', H(
    'Authentication-Results: mx.google.com;',
    '       spf=neutral (google.com: 203.0.113.4 is neither permitted nor denied by best guess record for domain of info@guesthouse.example) smtp.mailfrom=info@guesthouse.example')],
  ['Outlook desktop with only Received-SPF', 'alerts@northbank.example', H(
    'Received-SPF: Pass (protection.outlook.com: domain of northbank.example designates 192.0.2.5 as permitted sender) receiver=protection.outlook.com; client-ip=192.0.2.5; helo=mail.northbank.example;')],
  ['a newsletter writer on a newsletter platform', 'writer@substack.com', H(
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@substack.com header.s=s1 header.b=Qr5St6Uv;',
    '       spf=pass smtp.mailfrom=bounce@mg.substack.com;',
    '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=substack.com')]
];

const flagged = (from, headers) => {
  const p = senderProof(headers, from.split('@').pop());
  return p && p.status === 'not' ? p.text : null;
};

for (const [name, from, headers] of HONEST) {
  test(`an honest sender is not called a forgery: ${name}`, () => {
    assert.equal(flagged(from, headers), null);
    const c = analyzeEmail({ from: `Sender <${from}>`, subject: 'Hello', body: 'Hello there.', headers }).checks.find((x) => x.id === 'E31');
    assert.ok(c.status === 'pass' || c.status === 'skip', `${c.status}: ${c.detail}`);
  });
}

test('the sweep is at least 15 header sets', () => assert.ok(HONEST.length >= 15, String(HONEST.length)));

test('a mail service or a mailing list is named, calmly', () => {
  assert.equal(senderProof(HONEST[0][2], 'tinybakery.example').text, 'Sent for tinybakery.example through the mail service mcsv.net');
  assert.equal(senderProof(HONEST[10][2], 'smallclub.example').text, 'Sent for smallclub.example through the mailing list lists.birders.example');
});

test('forgeries through the same services and lists are still caught', () => {
  const viaSendGrid = H('Authentication-Results: mx.google.com; dkim=pass header.i=@sendgrid.net; spf=pass smtp.mailfrom=bounces+1@sendgrid.net;',
    '       dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=northbank.example');
  assert.equal(senderProof(viaSendGrid, 'northbank.example').checksFailed, true, 'a domain that set up DMARC and failed it');
  const plantedList = H('Authentication-Results: mx.google.com; dkim=pass header.i=@mailer-xyz.example; spf=pass smtp.mailfrom=b@mailer-xyz.example;',
    '       dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=northbank.example', 'List-Id: <news.mailer-xyz.example>');
  assert.equal(senderProof(plantedList, 'northbank.example').status, 'not', 'a List-Id does not excuse p=reject');
  const laxNoList = H('Authentication-Results: mx.google.com; spf=pass smtp.mailfrom=b@mailer-xyz.example;',
    '       dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=smallclub.example');
  assert.equal(senderProof(laxNoList, 'smallclub.example').checksFailed, true, 'p=none without a list it came through');
  const halfService = 'Authentication-Results: mx.google.com; dkim=pass header.i=@sendgrid.net; spf=pass smtp.mailfrom=b@mailer-xyz.example';
  assert.equal(senderProof(halfService, 'tinybakery.example').status, 'not', 'a service signature beside a stranger\'s is not enough');
});
