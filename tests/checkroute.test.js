'use strict';

// The Check page decides from what was pasted which scan runs and which weekly allowance it uses (web/assets/js/route.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../web/assets/js/route.js');

const FREE = { research: false, virusMalwareOnLinks: false, emailManual: false };
const PRO = { research: true, virusMalwareOnLinks: true, emailManual: false };
const MAX = { research: true, virusMalwareOnLinks: true, emailManual: true };
const at = (r) => [r.kind, r.path, r.meter];

const PARCEL = 'USPS: your parcel is held at our depot. Pay the $1.99 redelivery fee within 24h: https://usps-redeliver.top/track';
const EMAIL = 'From: PayPal Security <alerts@paypa1-secure.com>\nSubject: Your account is limited\nDate: Mon, 3 Nov 2026 09:12:00 +0000\n\nDear customer, confirm your details at https://paypa1-secure-login.com/verify';

test('a parcel text is a message: the text check, one fast scan', () => {
  assert.deepEqual(at(R.pick({ text: PARCEL }, { features: FREE })), ['message', '/scan/text', 'linkScans']);
});

test('a bare link is a link: fast by default, delicate only when asked for and in the plan', () => {
  assert.deepEqual(at(R.pick({ text: 'paypa1-secure-login.com/account' }, { features: FREE })), ['link', '/scan/link', 'linkScans']);
  assert.deepEqual(at(R.pick({ text: 'https://github.com' }, { features: FREE, deeper: true })), ['link', '/scan/link', 'linkScans'], 'Free has no research to spend');
  const deep = R.pick({ text: 'https://github.com' }, { features: PRO, deeper: true });
  assert.deepEqual([...at(deep), deep.mode], ['link', '/scan/link', 'deepScans', 'delicate']);
});

test('a link to an .exe goes to the virus scan on Free, and stays a link scan where links are checked for viruses', () => {
  assert.deepEqual(at(R.pick({ text: 'https://cdn.example.net/setup/Installer.exe' }, { features: FREE })), ['download', '/scan/threat', 'fileScans']);
  assert.deepEqual(at(R.pick({ text: 'https://cdn.example.net/setup/Installer.exe' }, { features: PRO })), ['download', '/scan/link', 'linkScans']);
  assert.equal(R.pick({ text: 'https://example.com/exe' }, { features: FREE }).kind, 'link', 'a path that only says exe is not a download');
});

test('a phone number on its own is not sent anywhere: there is nothing to look it up in', () => {
  for (const n of ['+1 415 555 0199', '(020) 7946 0958', '07700900123']) assert.deepEqual(at(R.pick({ text: n }, { features: MAX })), ['number', null, null], n);
  assert.equal(R.guess({ text: '12345' }), 'message', 'too short for a number');
});

test('a dropped file is a virus scan; a picture is read on the device; an .eml is read as an email', () => {
  assert.deepEqual(at(R.pick({ file: { name: 'invoice.pdf.exe', type: 'application/x-msdownload' } }, { features: FREE })), ['file', '/scan/file', 'fileScans']);
  assert.deepEqual(at(R.pick({ file: { name: 'shot.png', type: 'image/png' } }, { features: FREE })), ['picture', null, null]);
  assert.equal(R.guess({ file: { name: 'mail.eml', type: '' } }), 'eml');
});

test('an email is the email check on Max, and a message check anywhere else, never a locked wall', () => {
  assert.deepEqual(at(R.pick({ text: EMAIL }, { features: MAX })), ['email', '/scan/email', 'deepScans']);
  const free = R.pick({ text: EMAIL }, { features: FREE });
  assert.deepEqual([...at(free), free.limited], ['email', '/scan/text', 'linkScans', true]);
  assert.equal(R.guess({ text: 'Subject: hi there' }), 'message', 'one header line is not an email');
});

test('one press changes the guess, but only to a kind that fits what is in the box', () => {
  assert.deepEqual(R.choices({ text: PARCEL }), ['link', 'download', 'message', 'email']);
  const asLink = R.pick({ text: PARCEL }, { features: FREE, choice: 'link' });
  assert.deepEqual([...at(asLink), asLink.url], ['link', '/scan/link', 'linkScans', 'https://usps-redeliver.top/track']);
  assert.deepEqual(R.choices({ text: 'Hi Mum, new number' }), ['message', 'email']);
  assert.equal(R.pick({ text: 'Hi Mum, new number' }, { features: FREE, choice: 'link' }).kind, 'message', 'no link to check');
  assert.deepEqual(R.choices({ file: { name: 'a.exe' } }), []);
});

test('the app has one Check page: the five scan pages, their sidebar entries and their mode switches are gone', () => {
  const ROOT = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(ROOT, 'web', 'assets', 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'app.html'), 'utf8');
  assert.ok(app.includes('= window.SentinelRoute;') && app.includes('Route.pick({ text: box.value, file }'), 'the Check page asks route.js, not its own guess');
  for (const gone of ['function scanView', 'function threatsView', 'function emailView', 'function textView', 'data-scan-mode', 'data-emode', 'data-tmode']) assert.ok(!app.includes(gone), `${gone} is still in app.js`);
  const side = html.slice(html.indexOf('<nav class="side__nav"'), html.indexOf('</nav>'));
  assert.equal((side.match(/href="\/app\/check"/g) || []).length, 1, 'one Check entry in the sidebar');
  for (const gone of ['/app/scan"', '/app/threats"', '/app/email"', '/app/text"']) assert.ok(!side.includes(gone), `${gone} is still in the sidebar`);
  assert.deepEqual([...side.matchAll(/class="side__label"[^>]*>([^<]+)</g)].map((m) => m[1]), ['Check', 'Protect', 'Review', 'Account']);
  assert.ok(html.includes('/assets/js/route.js'), 'app.html loads route.js');
});
