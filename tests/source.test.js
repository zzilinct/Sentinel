'use strict';
/**
 * Where a download really came from: Zone.Identifier streams shaped as Chrome, Edge and Firefox write them, for
 * genuine installers from each product's own site (never flagged) and for the fakes (flagged, naming the real site).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

require('../desktop/scripts/sync-shared.js');
const source = require('../desktop/src/source.js');
const downloads = require('../desktop/src/downloads.js');

const zone = (host, referrer) => `[ZoneTransfer]\r\nZoneId=3\r\n${referrer ? `ReferrerUrl=${referrer}\r\n` : ''}HostUrl=${host}\r\n`;
const judge = (name, text, o) => source.judge(name, source.parseZone(text), o);

const GENUINE = [
  ['ZoomInstallerFull.exe', zone('https://cdn.zoom.us/prod/6.2.5.48557/ZoomInstallerFull.exe', 'https://zoom.us/download')],
  ['ZoomInstaller.exe', zone('https://zoom.us/client/latest/ZoomInstaller.exe')],
  ['DiscordSetup.exe', zone('https://stable.dl2.discordapp.net/distro/app/stable/win/x64/1.0.9165/DiscordSetup.exe', 'https://discord.com/')],
  ['SteamSetup.exe', zone('https://cdn.fastly.steamstatic.com/client/installer/SteamSetup.exe', 'https://store.steampowered.com/about/')],
  ['ChromeSetup.exe', zone('https://dl.google.com/tag/s/appguid%3D%7B8A69D345%7D/update2/installers/ChromeSetup.exe', 'https://www.google.com/chrome/')],
  ['OBS-Studio-30.2.3-Windows-Installer.exe', zone('https://cdn-fastly.obsproject.com/downloads/OBS-Studio-30.2.3-Windows-Installer.exe', 'https://obsproject.com/')],
  // GitHub releases: the file comes from GitHub's storage; the page that started it is the project's own.
  ['OBS-Studio-30.2.3-Windows-Installer (1).exe', zone('https://objects.githubusercontent.com/github-production-release-asset-2e65be/50012345/abc?X-Amz-Algorithm=AWS4', 'https://github.com/obsproject/obs-studio/releases')],
  ['AnyDesk.exe', zone('https://download.anydesk.com/AnyDesk.exe', 'https://anydesk.com/en/downloads/windows')],
  ['RobloxPlayerInstaller.exe', zone('https://setup-aws.rbxcdn.com/version-1a2b3c4d5e6f7a8b-RobloxPlayerInstaller.exe', 'https://www.roblox.com/download/client')],
  ['MinecraftInstaller.msi', zone('https://launcher.mojang.com/download/MinecraftInstaller.msi', 'https://www.minecraft.net/en-us/download')],
  ['WhatsApp Installer.exe', zone('https://get.microsoft.com/installer/download/9NKSQGP7F2NH?cid=website_cta_psi', 'https://www.whatsapp.com/download')],
  ['Firefox Installer.exe', zone('https://download-installer.cdn.mozilla.net/pub/firefox/releases/131.0/win32/en-US/Firefox%20Installer.exe', 'https://www.mozilla.org/en-US/firefox/new/')],
  ['SpotifySetup.exe', zone('https://download.scdn.co/SpotifySetup.exe', 'https://www.spotify.com/us/download/windows/')],
  ['TeamViewer_Setup_x64.exe', zone('https://download.teamviewer.com/download/TeamViewer_Setup_x64.exe')],
  ['ChatGPT Installer.exe', zone('https://get.microsoft.com/installer/download/9NT1R1C2HH7J')],
  ['Ninite Zoom Installer.exe', zone('https://ninite.com/zoom/ninite.exe', 'https://ninite.com/')]
];

test('a genuine installer from its own site, a known mirror or its own GitHub is never flagged', () => {
  for (const [name, text] of GENUINE) {
    const r = judge(name, text);
    assert.ok(r, `${name} is recognised as a product`);
    assert.equal(r.genuine, true, `${name} from ${r.host}`);
    assert.equal(r.reason, null);
  }
});

test('a product\'s installer from anywhere else is flagged, and the warning names the real site', () => {
  const r = judge('ZoomInstaller.exe', zone('https://zoom-download-free.site/files/ZoomInstaller.exe', 'https://zoom-download-free.site/'));
  assert.equal(r.genuine, false);
  assert.equal(r.reason, 'This says it is Zoom, but it came from zoom-download-free.site, not zoom.us. Get Zoom from zoom.us.');
  const fakes = [
    ['DiscordSetup.exe', zone('https://cdn.discordapp.com/attachments/1234/5678/DiscordSetup.exe'), 'cdn.discordapp.com'],
    // Shared in a chat: the page that started it is discord.com or web.whatsapp.com, which proves nothing.
    ['DiscordSetup.exe', zone('https://cdn.discordapp.com/attachments/1234/5678/DiscordSetup.exe', 'https://discord.com/channels/@me'), 'cdn.discordapp.com'],
    ['ZoomInstaller.exe', zone('https://files.example-share.net/ZoomInstaller.exe', 'https://web.whatsapp.com/'), 'files.example-share.net'],
    ['ZoomInstaller.exe', zone('https://zoom-download-free.site/ZoomInstaller.exe', 'https://zoom.us/j/123456789'), 'zoom-download-free.site'],
    ['OBS_Studio_Setup_Full.exe', zone('blob:https://obs-studio.download/6f1c2e9a-1b2c-4d5e-8f90-1234567890ab'), 'obs-studio.download'],
    ['AnyDesk.exe', zone('https://anydesk-app.com/AnyDesk.exe', 'https://www.bing.com/')],
    ['ChromeSetup.exe', zone('https://sites.google.com/view/chrome-update/ChromeSetup.exe')],
    ['RobloxPlayerInstaller.msix', zone('https://roblox-free-robux.net/RobloxPlayerInstaller.msix')],
    ['steam_setup_2024.exe', zone('https://steampowered.com.steam-gift.ru/steam_setup_2024.exe')],
    // Somebody's GitHub, not OBS's.
    ['OBS-Studio-Installer.exe', zone('https://objects.githubusercontent.com/x', 'https://github.com/obs-studio-official/obs/releases')]
  ];
  for (const [name, text, host] of fakes) {
    const f = judge(name, text);
    assert.equal(f && f.genuine, false, name);
    if (host) assert.equal(f.host, host);
    assert.match(f.reason, /^This says it is .+, but it came from .+, not .+\. Get .+ from .+\.$/);
    assert.doesNotMatch(f.reason, /\u2014/);
  }
});

test('a zip is judged only when it has a program inside', () => {
  const text = zone('https://drive.usercontent.google.com/download?id=1AbC', 'https://drive.google.com/');
  assert.equal(judge('Zoom_Setup.zip', text), null);
  const r = judge('Zoom_Setup.zip', text, { zipHasProgram: true });
  assert.equal(r.genuine, false);
  assert.equal(r.host, 'drive.usercontent.google.com');
});

test('nothing is said without a product name, an installer or a known source', () => {
  const far = zone('https://example.org/x');
  for (const name of ['ZoomIt.exe', 'obs-backgroundremoval-1.1.13-windows-x64-Installer.exe', 'steamcmd.exe', 'obsidian-installer.exe', 'chromedriver.exe', 'setup.exe', 'Zoom.pdf', 'discord-notes.txt']) {
    assert.equal(judge(name, far), null, name);
  }
  // Edge in a private window, a copy made on this computer, a stream that is not there.
  assert.equal(judge('ZoomInstaller.exe', '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=about:internet\r\n'), null);
  assert.equal(judge('ZoomInstaller.exe', '[ZoneTransfer]\r\nZoneId=3\r\n'), null);
  assert.equal(source.judge('ZoomInstaller.exe', null), null);
});

test('Zone.Identifier text is read as Windows writes it (a byte order mark, any case, LF or CRLF)', () => {
  const z = source.parseZone('\uFEFF[ZoneTransfer]\nzoneid=3\nreferrerurl=https://a.test/\nHOSTURL = https://b.test/f.exe \n');
  assert.deepEqual(z, { zoneId: 3, hostUrl: 'https://b.test/f.exe', referrerUrl: 'https://a.test/' });
});

test('download protection: a fake installer is flagged before it runs; the real one, or one its maker signed, is not', async () => {
  const calls = [];
  const lines = [];
  let siteBadge = null;
  const realRead = source.readZone;
  const configure = (signer) => downloads._test.configure({
    log: (t) => lines.push(t),
    signedBy: async () => signer,
    api: async (p, body) => { calls.push(body); return { byUrl: { [body.urls[0]]: { overall: { badge: siteBadge, label: 'Likely scam' }, reasons: [{ text: 'Pretends to be Zoom' }] } } }; }
  });
  try {
    source.readZone = () => source.parseZone(zone('https://zoom-download-free.site/files/ZoomInstaller.exe?ref=ad', 'https://zoom-download-free.site/'));
    configure(null);
    let f = await downloads._test.checkSource('C:\\dl\\ZoomInstaller.exe', 'ZoomInstaller.exe', null);
    assert.equal(f.badge, 'orange');
    assert.equal(f.label, 'Possible fake installer');
    assert.match(f.reason, /came from zoom-download-free\.site, not zoom\.us/);
    // The source itself goes to the fast, private check on this computer, without its query.
    assert.deepEqual(calls.pop(), { urls: ['https://zoom-download-free.site/files/ZoomInstaller.exe'], private: true, mode: 'fast', purpose: 'download' });

    siteBadge = 'red';
    f = await downloads._test.checkSource('C:\\dl\\ZoomInstaller.exe', 'ZoomInstaller.exe', null);
    assert.equal(f.badge, 'red', 'a site Sentinel flags red makes it red');

    configure('Zoom Communications, Inc.');
    siteBadge = null;
    assert.equal(await downloads._test.checkSource('C:\\dl\\ZoomInstaller.exe', 'ZoomInstaller.exe', null), null, 'signed by its maker');

    calls.length = 0;
    source.readZone = () => source.parseZone(GENUINE[0][1]);
    assert.equal(await downloads._test.checkSource('C:\\dl\\ZoomInstallerFull.exe', 'ZoomInstallerFull.exe', null), null);
    assert.equal(calls.length, 0, 'a download from the product\'s own site is not sent to be checked');

    // Any program from a site Sentinel flags, named for a product or not.
    source.readZone = () => source.parseZone(zone('https://free-tools.test/tool.exe'));
    siteBadge = 'orange';
    f = await downloads._test.checkSource('C:\\dl\\tool.exe', 'tool.exe', null);
    assert.equal(f.label, 'From a dangerous site');
    assert.equal(f.reason, 'This came from free-tools.test, which Sentinel flags: Pretends to be Zoom. Do not open it.');
    // A document is not judged by its source.
    assert.equal(await downloads._test.checkSource('C:\\dl\\notes.pdf', 'notes.pdf', null), null);

    for (const l of lines) assert.doesNotMatch(l, /zoom-download-free|free-tools|https?:/, 'the source address is never logged');
  } finally {
    source.readZone = realRead;
  }
});
