'use strict';
/**
 * What a finding means, in one sentence a person who has never heard of a domain can read; and what a scan could not
 * look at. The result page reads these, so the wording lives in one place and the rule ids never reach anybody.
 *
 * Each entry is [clue, sentence, pattern, sentence, ...]. The clue is what the finding is about: checks that read the
 * same evidence share one, and a result says each clue once. The first pattern that matches the check's detail gives
 * the sentence, with $1 and $2 filled from it; the first sentence is for any other detail, so rewording a check can
 * lose a name but never a reason. A null sentence means the check's own detail is already plain.
 *
 * tests/plain.test.js fails when a check can raise a concern and has no sentence here.
 */

const USES = /uses: (.+)$/;
const FILE = /^"([^"]+)"/;
const READ_AS = /read as "([^"]+)"; the real site is (\S+)$/;
const listed = (what) => ['listed', `Threat lists name this address as ${what}.`,
  /^Hosting/, `This site hosts pages that threat lists name as ${what}.`,
  /this is not one of them$/, 'A different page on this site is on a threat list, but this address is not.',
  /this (?:one|address) is not$/, 'Other pages on this site are on a threat list, though this address is not.',
  /^Several known/, 'Threat lists name several bad links on this site.'];
const emailLink = ['links', 'A link in this email goes somewhere Sentinel flagged.', /^(\S+): (.+)$/, 'A link in this email goes to $1, rated: $2.'];

const SENTENCES = {
  /* The address */
  U01: ['disguise', 'The link goes to a bare number instead of a site name, which honest sites almost never do.',
    /login page/i, 'This login page sits on a bare number instead of a site name, and no real service signs people in that way.'],
  U02: ['disguise', 'The name uses letters from another alphabet that can pass for ordinary ones.'],
  U03: ['disguise', 'The first part of this link is a decoy, and the link really goes somewhere else.',
    /real site is (\S+)$/, 'The first part of this link is a decoy, and it really goes to $1.'],
  U04: ['odd-name', 'A long chain of names sits in front of the real site, which can hide where the link goes.'],
  U05: ['odd-name', 'The site name is unusually long.'],
  U06: ['odd-name', 'The site name is broken up with hyphens, as scam addresses often are.'],
  U07: ['odd-name', 'The name mixes digits into words, such as a 0 in place of an o.'],
  U08: ['odd-name', 'The link asks for an unusual kind of connection that ordinary sites do not need.'],
  U09: ['unsafe', 'This page is not encrypted, so anything you type could be read by others.'],
  U10: ['throwaway', 'This address ending is cheap and used by a lot of scam sites.',
    /^\.(\S+) has/, 'The ending .$1 is cheap and used by a lot of scam sites.'],
  U11: ['odd-name', 'The name looks like random letters, as computer-made malware addresses do.'],
  U12: ['odd-name', 'The link is unusually long, which can hide what it really is.'],
  U13: ['odd-name', 'Part of the link is scrambled, so you cannot read what it carries.'],
  U14: ['download', 'This link downloads a program that would run on your computer.'],
  U15: ['download', 'This file pretends to be one type of file but is really another.', FILE, '"$1" pretends to be one type of file but is really another.'],
  U16: ['download', 'This link downloads an Office document that can run hidden commands.'],
  U17: ['download', 'This link downloads a compressed folder, a common way to sneak malware past filters.'],
  U18: ['hidden-path', 'This is a shortened link, so you cannot see where it goes until you open it.'],
  U19: ['hidden-path', 'This link passes you on to a different site.', /^Forwards to (\S+)/, 'This link passes you on to $1.'],
  U20: ['throwaway', 'Anyone can make a page on this free service, so the address says little about who runs it.',
    /named for (\S+) /, 'This page on a free service is named after $1, but does not belong to it.',
    /storage bucket/, 'This page sits in an online storage space where anyone can upload one.',
    /(login|brand or login) wording/, 'This page sits on a free service anyone can use, and it uses brand or sign-in wording.'],
  U38: ['throwaway', 'The page has a throwaway name on a free hosting service.'],
  U39: ['targeted', 'This link carries a code that identifies you, so someone can see who opened it.',
    /email address/, 'This link contains an email address, so it was made for one person.'],
  U21: ['throwaway', 'The address uses a free naming service that its owner can point anywhere at any time.'],
  U42: ['throwaway', 'Random letters sit in front of the site name.'],
  U45: ['throwaway', 'The name is a long number, the mark of sites registered in bulk.'],
  U46: ['throwaway', 'A free page calls itself a help desk, sign-in or wallet page.'],
  U48: ['throwaway', 'The name is a string of letters rather than a real name, on a cheap address ending.'],
  U56: ['throwaway', 'The address is a made-up name, not one a real site owner chose.'],
  U53: ['odd-name', 'This address is a technical service name, not a website.'],

  /* Names that are not theirs */
  U22: ['brand', 'The address uses the name of a well-known brand but does not belong to it.',
    /^Uses "([^"]+)" but is not (\S+)$/, 'The address uses the name "$1", but it is not $2.',
    /different name unless/, 'The name contains a well-known brand, though it may just be a different name.'],
  U23: ['brand', 'A brand name sits in front of an unrelated site, to make it look official.', /^Puts "([^"]+)"/, '"$1" sits in front of an unrelated site, to make it look official.'],
  U24: ['lookalike', 'The name is spelled almost like a well-known site, but it is a different site.',
    /spelled like (\S+), but is an ordinary word/, 'The name is spelled like $1, but it is an ordinary word.',
    /spelling (?:of|to) (\S+)$/, 'The name is spelled almost like $1, but it is a different site.'],
  U33: ['brand', 'The address is written to look like a government site, but it is not one.'],
  U37: ['brand', 'A brand name is paired with security wording, a common pattern in scam addresses.', FILE, '"$1" is paired with security wording, a common pattern in scam addresses.'],
  U40: ['brand', 'The address mentions a brand, but this site does not belong to it.',
    /one letter from (\S+)$/, 'A user-made page is named one letter away from $1.',
    /^Path mentions "([^"]+)" but this is not ([^\s,]+)/, 'The address mentions "$1", but this is not $2.'],
  U49: ['brand', 'A brand name is glued to another word, and this is not the real site.', /^"([^"]+)" glued.*real site is (\S+)$/, '"$1" is glued to another word, but the real site is $2.'],
  U58: ['brand', 'A folder named after a company sits beside a sign-in page, on a site that is not that company.'],
  X01: ['brand', 'The search result claims to be a well-known brand, but the address is not theirs.', /but it is not (\S+)$/, 'The search result claims to be $1, but the address is not theirs.'],
  Y01: ['brand', null],
  U44: ['disguise', 'The name is made to read like a different site.', READ_AS, 'The name is made to read like $1, but the real site is $2.'],
  U47: ['disguise', 'The name is made to read like a different site.', READ_AS, 'The name is made to read like $1, but the real site is $2.'],
  U50: ['disguise', 'The end of the address is dressed up to look like another site.', /look like (\S+); the real site is (\S+)$/, 'The end of the address is dressed up to look like $1, but the real site is $2.'],

  /* Words used as bait */
  U25: ['bait', 'The address is built from words scammers use to look official.', USES, 'The address uses words scammers like, such as $1.'],
  U26: ['bait', 'The address promises prizes or free money.', USES, 'The address promises something for free, with words like $1.'],
  U27: ['bait', 'The address uses crypto wording that wallet scams rely on.', USES, 'The address uses crypto wording that wallet scams rely on, such as $1.'],
  U28: ['bait', 'The address uses the wording of fake clearance stores.'],
  U29: ['bait', 'The address stacks several bait words together.'],
  U30: ['bait', 'The end of the address looks like a fake sign-in page.'],
  U31: ['bait', 'The address is written like a fake tech support alert.'],
  U32: ['bait', 'The address is written like a fake delivery notice.'],
  U43: ['bait', 'The address is built from bait words.', /words: (.+)$/, 'The address is built from bait words: $1.'],
  U54: ['bait', 'A word meant to look trustworthy is misspelled.', /^"([^"]+)" is "([^"]+)" misspelled/, '"$1" is a misspelling of "$2".'],
  U55: ['bait', 'The address poses as an "I am not a robot" check.'],

  /* Ready-made scam pages */
  U41: ['kit', 'This looks like a login page placed in a folder meant for site files, a sign of a hacked site.',
    /^Kit-style/, 'The page name matches files from ready-made scam kits.'],
  U51: ['kit', 'The page name is a file used by ready-made scam kits.'],
  U52: ['kit', 'This page sits in a personal folder on a shared server.', /hijacked/, 'This page sits in someone\'s hosting account, which has very likely been hacked.'],
  C03: ['kit', 'The page matches a known scam template.', /^Partly/, 'Parts of the page match a known scam template.'],
  C04: ['kit', 'The page matches a known malware trap.', /^Partly/, 'Parts of the page match a known malware trap.'],
  C05: ['kit', 'The page is a copy of a confirmed scam page.', /on (\S+)$/, 'The page is a copy of a confirmed bad page on $1.'],

  /* Files on the way in */
  U34: ['download', 'The address looks like a spot where attackers keep harmful programs.'],
  U57: ['download', 'This site is named like a software update, but real updates never come from a site like this.'],
  R13: ['download', 'This page starts a download as soon as you open it.', /^Serves the program "([^"]+)"/, 'This page hands you the program "$1" as soon as you open it.'],
  P15: ['download', 'The page starts downloading a program without asking.'],
  P16: ['download', 'The page links to program files.'],
  P19: ['download', 'The page builds a file inside itself and forces it to download.'],
  'D-limit': ['download', 'Sentinel could only read part of this download.'],

  /* What the lists and people say */
  K01: listed('a scam'),
  K02: listed('malware'),
  K03: listed('a source of viruses'),
  K04: ['reported', 'People using Sentinel have reported this site.'],
  C01: ['listed', 'The name is nearly the same as a known bad site.', /site (\S+)$/, 'The name is nearly the same as a known bad site, $1.'],
  C02: ['listed', 'The name shares parts with a known scam site.', /known scam (\S+?)(?:,|$)/, 'The name shares parts with a known scam site, $1.'],
  R11: ['listed', 'This link passes through an address that threat lists name as dangerous.'],

  /* The site itself */
  R01: ['new-site', 'This site is new.',
    /^Registered \d+ day\(s\)/, 'This site was created less than two weeks ago.',
    /^Registered (\d+) (days|months) ago/, 'This site was created only $1 $2 ago.'],
  R02: ['new-site', 'This young site was only paid for one year, as throwaway sites often are.'],
  R09: ['new-site', 'The site\'s security certificate was created only days ago.'],
  R03: ['gone', 'The company that handles this site\'s name has put it on hold.'],
  R04: ['gone', 'Nobody owns this address, so the link is fake or has already been taken down.'],
  R05: ['gone', 'This address does not lead to any server, so it may have been taken down.'],
  R12: ['gone', 'The site answered with an error.', /internal destination/, 'The link leads to a private address that Sentinel will not open.'],
  R06: ['behaviour', 'This public address points into a private network, which honest sites do not do.'],
  R07: ['thin-site', 'This site cannot receive email, though a real company\'s site would.'],
  P20: ['thin-site', 'This is a bare login form with almost nothing around it.'],
  R08: ['unsafe', 'The site\'s security certificate cannot be trusted.',
    /expired/, 'The site\'s security certificate has expired.',
    /different site/, 'The site\'s security certificate belongs to a different site.',
    /^Self-signed/, 'The site made its own security certificate instead of getting a trusted one.'],
  R10: ['hidden-path', 'This link bounces you through several different sites.', /^Redirects to (\S+)/, 'This link sends you on to $1.'],
  P27: ['hidden-path', 'A script on the page sends you to another site.', /redirects to (\S+)/, 'A script on the page sends you on to $1.'],

  /* What the page does and asks */
  P01: ['brand', 'The page title claims a brand that this site does not belong to.', /presents itself as (\S+) on (\S+)$/, 'The page calls itself $1, but the site is $2.'],
  P21: ['brand', 'The page borrows its logos straight from the real brand\'s site.', /^Loads (\S+) images.*from (\S+)$/, 'The page borrows $1 logos straight from $2.'],
  P02: ['asks', 'The page asks for a password while pretending to be a brand.'],
  P03: ['asks', 'The password form sends what you type to a different site.', /sends to (\S+)/, 'The password form sends what you type to $1.'],
  P04: ['asks', 'The page sends what you type straight to the people behind it.',
    /Telegram/, 'The form sends what you type to a chat bot, as scam kits do.', /^Form emails/, 'The form emails your details to someone.'],
  P05: ['asks', 'The page asks for card details.', /look-alike/, 'The page asks for card details on a look-alike of a brand.'],
  P06: ['asks', 'The page asks for a wallet recovery phrase, which no honest site ever does.'],
  P25: ['asks', 'This shop demands payment by crypto, gift cards or wire transfer, which cannot be reversed.'],
  P07: ['pressure', 'The page uses pressure or threats to rush you.'],
  P08: ['pressure', 'The page promises a prize that sounds too good to be true.'],
  P09: ['pressure', 'The page uses scare wording about your computer.', /toll-free/, 'The page uses scare wording and a phone number, as fake support scams do.'],
  P10: ['pressure', 'A countdown timer pushes you to decide quickly.'],
  P11: ['hiding', 'The page tries to stop visitors looking at how it works.'],
  P13: ['hiding', 'The page\'s code is deliberately scrambled so it is hard to read.'],
  P22: ['hiding', 'This login page asks search engines not to list it.'],
  P12: ['behaviour', 'The page secretly loads another site you cannot see.'],
  P14: ['behaviour', 'The page uses your computer to mine cryptocurrency.'],
  U35: ['behaviour', 'This site is known for using visitors\' computers to mine cryptocurrency.'],
  P17: ['behaviour', 'The page tells you to paste and run a command, which is how it would install malware.',
    /^Fake verification/, 'A fake check on the page asks you to run a command.'],
  P18: ['behaviour', 'The page tries to trick you into allowing its notifications.'],
  P23: ['shop', 'This shop shows no contact, refund or privacy pages.'],
  P24: ['shop', 'This shop advertises discounts too big to be believable.', /^Advertises (\d+)% off/, 'This shop advertises $1% off, which is hard to believe.'],
  P26: ['shop', 'The only way to contact this shop is a chat app.'],

  /* Emails */
  E31: ['sender', null],
  E01: ['sender', 'The sender claims to be a company but wrote from a different address.', /^Claims to be (\S+) but was sent from (\S+)/, 'The sender claims to be $1 but wrote from $2.'],
  E02: ['sender', 'The sender\'s address looks like a well-known company but is not theirs.', /^(\S+) imitates (\S+)/, 'The sender\'s address, $1, imitates $2.'],
  E03: ['sender', 'Replies to this email would go to a different address.', /redirected to (\S+)/, 'Replies to this email would go to $1, not the sender.'],
  E04: ['sender', 'A company is writing from a free personal mailbox.'],
  E18: ['sender', 'The sender\'s address is several words stitched together.'],
  E05: ['pressure', 'The subject line is written to rush you.'],
  E08: ['pressure', 'The email does not use your name.'],
  E09: ['pressure', 'The email threatens your account or legal trouble if you do not act.'],
  E06: ['asks', 'The email asks you to confirm your account details.',
    /refund/, 'It offers a refund but first wants your card or account details, and real refunds go back to how you paid.'],
  E22: ['asks', 'The email asks you to send your ID, bank details or password.'],
  E07: ['money', 'The email asks for payment by gift cards, crypto or wire transfer.'],
  E19: ['money', 'It asks to be paid in gift cards, crypto or a wire transfer, which no real company or agency does.'],
  E20: ['money', 'The email asks for a fee to release a parcel.', /USPS/, 'It claims to be USPS and asks for a delivery fee, which USPS never does by email or text.'],
  E23: ['money', 'An urgent, private favour with gift cards or a wire transfer is how people pose as a boss or colleague.'],
  E24: ['money', 'The email asks for money for travel, or offers an unclaimed fortune.'],
  E25: ['money', 'The email demands an unpaid toll or fine, but not from an official address.'],
  E28: ['money', 'It promises daily pay for simple online tasks, a scam that ends with you paying to unlock your earnings.'],
  E21: ['phone', 'The email asks you to phone a number about a charge or refund, which is how callback scams work.',
    /infected/, 'The email says your computer is infected and asks you to phone a number.'],
  E10: ['links', 'A link shows one address but opens a different one.', /shows (\S+) but opens (\S+)/, 'A link shows $1 but really opens $2.'],
  E11: ['links', 'The email uses shortened links that hide where they go.'],
  E12: ['links', 'The email asks you to scan a QR code, which moves you off this protected computer.'],
  E29: ['links', 'A voicemail you can only hear through a link is often a sign-in page in disguise.'],
  E30: ['links', 'The QR code in this email is not what it seems.',
    /a (\S+) sign-in code/, 'Its QR code would sign the sender into your $1 account.',
    /wallet/, 'Its QR code connects a crypto wallet to a website.',
    /payment/, 'Its QR code asks for a cryptocurrency payment.'],
  'EL-scam': emailLink,
  'EL-malware': emailLink,
  'EL-virus': emailLink,
  E13: ['attachment', 'The email has a program attached.', /^Attached program: (.+)$/, 'The attachment $1 is a program.'],
  E14: ['attachment', 'An attachment hides what kind of file it is.', FILE, 'The attachment "$1" hides what kind of file it is.'],
  E15: ['attachment', 'An attached document can run hidden commands.'],
  E16: ['attachment', 'The email sends a locked file together with its password, a way to hide malware from scanners.'],
  E17: ['attachment', 'An invoice-themed message comes with a risky attachment.'],
  E27: ['attachment', 'The attachment is a web page, which is often a hidden login form.'],

  /* Files */
  F01: ['known-file', 'This exact file is on a list of known harmful files.'],
  F02: ['known-file', 'This is the harmless test file that antivirus tools use to prove they work.'],
  F03: ['disguised-file', 'The file name says one thing, but the file is really a program.', /disagree/, 'The file\'s name and its contents do not match.'],
  F05: ['disguised-file', 'The file hides its real type behind a second ending.', FILE, '"$1" hides its real type behind a second ending.'],
  F13: ['disguised-file', 'This shortcut runs a hidden command.',
    /sent as a download/, 'This is a shortcut file, which is an odd thing to download.',
    /^Disk images/, 'Disk images skip some of the safety warnings Windows normally shows.'],
  F04: ['program', 'This is a program, so only run it if you trust who made it.'],
  F06: ['hiding', 'Most of this program is packed or scrambled, so its real code is hidden.'],
  F07: ['behaviour', 'This program goes after saved passwords or crypto wallets.',
    /injection/, 'This program has what it needs to slip code into other running programs.',
    /^Keylogger/, 'This program can record what you type.'],
  F08: ['behaviour', 'This file downloads code from the internet and runs it.',
    /but does not do both$/, 'This file can fetch things or run commands, though it does not do both.'],
  F09: ['behaviour', 'This document has hidden commands that run as soon as it opens.',
    /only enable them/, 'This document has hidden commands called macros, so only turn them on if you expected it.'],
  F10: ['behaviour', 'This PDF contains code.',
    /launch a program/, 'This PDF tries to start a program.', /on open/, 'This PDF runs code as soon as it opens.', /embedded file/, 'This PDF carries another file inside it.'],
  F11: ['archive', 'This compressed folder holds a program.',
    /^Hides the program "([^"]+)"/, '"$1" is a program hidden behind a document-style name.',
    /^Password-protected/, 'This compressed folder is locked with a password, so Sentinel could not look inside.',
    /cannot be listed/, 'Sentinel could not list what is inside this compressed folder, so open it with care.'],
  F12: ['behaviour', 'This Android app asks for powerful permissions that could take over a phone.',
    /banking-trojan/, 'This Android app asks for the permissions banking malware uses.'],
  F14: ['behaviour', 'This web page file builds and downloads a hidden file.', /password/, 'This web page file, saved on your computer, asks for a password.']
};

/** A check that raised a concern, in one plain sentence. Null when the check has no entry, which a test forbids. */
function plainFor(check) {
  const entry = SENTENCES[check.id] || SENTENCES[String(check.id).replace(/^D-/, '')];
  if (!entry) return null;
  const detail = String(check.detail || '');
  for (let i = 2; i < entry.length; i += 2) {
    const m = entry[i].exec(detail);
    if (m) return entry[i + 1].replace(/\$(\d)/g, (_, n) => m[n]);
  }
  return entry[1] || detail;
}

const isConcern = (c) => c.status === 'fail' || c.status === 'warn';

/** A clue is said once: the strongest check that speaks to it, strongest clue first. Never carries a rule id. */
function cluesOf(checks, max = 4) {
  const seen = new Set();
  const clues = [];
  for (const c of checks.filter(isConcern).sort((a, b) => b.points - a.points)) {
    const entry = SENTENCES[c.id] || SENTENCES[String(c.id).replace(/^D-/, '')];
    const clue = entry ? entry[0] : c.id;
    if (seen.has(clue)) continue;
    seen.add(clue);
    clues.push({ clue, threat: c.threat, status: c.status, text: plainFor(c) || c.detail });
  }
  return clues.slice(0, max);
}

/** The checks a person may open, each concern with its sentence. */
const withPlain = (checks) => checks.map((c) => (isConcern(c) ? { ...c, plain: plainFor(c) || c.detail } : c));

/* ------------------------------------------------- what could not be looked at */

/**
 * What a site's research could not reach, each as words that finish "Not checked: ...". A site that refused to show
 * its page is a gap, not a finding: the checks that needed the page did not run, and the rest of the answer stands.
 */
function researchGaps(facts) {
  const gaps = [];
  if (!facts) return gaps;
  if (facts.registration.reason === 'not answered in time') gaps.push({ what: 'registration', text: 'when this site was created, because the record did not come back in time', retry: true });
  if (facts.dns.unavailable) gaps.push({ what: 'dns', text: 'where this site lives, because the lookup did not answer in time', retry: true });
  const http = facts.http;
  if (!facts.lite && (!http.ok || http.status < 200 || http.status >= 300 || http.truncated)) {
    gaps.push({ what: 'page', retry: true,
      text: http.truncated ? 'the whole page, because only part of it could be read'
        : http.status ? 'the page itself, because the site would not show it to Sentinel' : 'the page itself, because the site did not answer' });
  }
  return gaps;
}

/** The threat lists a scan could not lean on: ones not yet loaded, and a live list that did not answer. */
function listGaps(know) {
  const gaps = [];
  const f = know.feeds;
  if (f && f.ready < f.total) {
    const left = f.total - f.ready;
    gaps.push({ what: 'lists', text: `${left} of ${f.total} threat lists, because ${left === 1 ? 'it has' : 'they have'} not loaded yet`, retry: true });
  }
  if (know.unreached) gaps.push({ what: 'live-list', text: `${know.unreached}, because it did not answer`, retry: true });
  return gaps;
}

const noResearchHere = () => ({ what: 'research', text: 'the site itself, because this copy of Sentinel does not open sites', retry: false });
const unreadableFile = () => ({ what: 'contents', text: 'what is inside this compressed folder, because it could not be opened', retry: false });

/** Every kind of scan says what it covered in the same shape. */
function coverage(gaps, extra = {}) {
  const missing = [...new Map(gaps.map((g) => [g.what, g])).values()];
  return { ...extra, complete: !missing.length, missing };
}

module.exports = { SENTENCES, plainFor, cluesOf, withPlain, researchGaps, listGaps, noResearchHere, unreadableFile, coverage };
