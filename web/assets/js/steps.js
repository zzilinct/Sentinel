/**
 * What to do after a scam, written once, so every place Sentinel gives the advice says the same thing: "What to do
 * now" under a result (ui.js), exposure alerts (app.js), the recovery guide (recover.js), the Windows app's
 * tech-support scam shield (pages/guard.html, from desktop/shared) and the companion's password alarm (a copy in
 * extension/src/content). desktop/scripts/sync-shared.js and scripts/build-extension.js make the copies, and
 * tests/steps.test.js checks they are the same. Each place picks steps by id.
 *
 * No phone numbers of our own: where a call is right, it is to the number on the person's card or the company's own
 * site. An installed remote-control program starts again with Windows, so restarting never ends a connection.
 */
(function (root) {
  'use strict';

  const text = {
    'no-call': 'Do not call any number a warning page showed you. Real companies never put a phone number in a warning like this.',
    'no-connect': 'Do not let anyone connect to your computer, and do not give anyone a code that appears on your screen.',
    offline: 'Disconnect this computer from the internet: turn off Wi-Fi or unplug the cable.',
    'remote-off': 'Uninstall the program they had you open (AnyDesk, TeamViewer, Quick Assist or similar) in Settings, then Apps. Keep the computer off the internet until it is gone: it starts again with Windows.',
    'let-in': 'Already let someone in? Turn off Wi-Fi or unplug the cable, uninstall the program they used in Settings, then Apps, run a full scan in Windows Security, and change your passwords from another device.',
    'ran-it': 'Already did? Turn off Wi-Fi or unplug the cable, run a full scan in Windows Security, and change your passwords from another device.',
    scan: 'Run a full scan: open Windows Security, then Virus & threat protection, Scan options, Full scan.',
    'other-device': 'From another phone or computer, change the passwords for your email and your bank first, then the rest.',
    password: 'Change the password on the real site (type its address yourself), and anywhere else you use the same password.',
    twostep: 'Turn on two-step sign-in, and never read a code out to anyone: a real company never asks for one.',
    'bank-call': 'Logged in to your bank or paid anything while they were connected? Call your bank, using the number on your card.'
  };

  const api = { text };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SentinelSteps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
