'use strict';
/**
 * Long, signed, random-looking links on well-known sites are not a danger in themselves (the owner clicked a Discord
 * GIF and was told "Likely malware"). The address is not the danger there; what is served still can be, so listed
 * addresses, program downloads and phishing are still caught. Nothing here is opened or looked up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../server/seed').run({ quiet: true });
const { db } = require('../server/lib/db');
const { urlKey, analyze, isWellKnown } = require('../server/lib/scan/url');
const engine = require('../server/lib/scan/engine');
const offline = require('../server/lib/scan/offline');

const HEX = '3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a';
const DISCORD_GIF = `https://cdn.discordapp.com/attachments/1093845729384756123/1187234567890123456/image.gif?ex=6789abcd&is=67885a4d&hm=${HEX}&`;

// Real-shaped links people are sent every day, from many sites. Each is long, signed, encoded or randomly named.
const HONEST = [
  DISCORD_GIF,
  `https://media.discordapp.net/attachments/1093845729384756123/1187234567890123456/clip.mp4?ex=6789abcd&is=67885a4d&hm=${HEX}&=&width=400&height=300`,
  'https://lh3.googleusercontent.com/pw/AP1GczN3kQ8vX7mR2tY9wL4zB6hD1fJ5sK0aE3cU8gP2nO7iW4qT6yR9xV1bM5-QzK8jL3hF6dS0aG2cX7vB4nM1-w1200-h900-s-no-gm?authuser=0',
  'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOpQrStUvWxYz0123456&export=download&authuser=0&confirm=t&uuid=3f9a8b7c-6d5e-4f3a-2b1c-0d9e8f7a6b5c&at=APZUnTWx7kQpZ3VfR2mT9nLwYbH4sD6e%3A1730000000000',
  `https://storage.googleapis.com/team-reports/2026/q3/summary.pdf?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=svc%40proj.iam.gserviceaccount.com%2F20261105%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20261105T120000Z&X-Goog-Expires=900&X-Goog-SignedHeaders=host&X-Goog-Signature=${HEX}`,
  `https://team-uploads.s3.us-east-1.amazonaws.com/2026/11/photo.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261105%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261105T120000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=${HEX}`,
  'https://www.dropbox.com/scl/fi/a1b2c3d4e5f6g7h8i9j0k/Holiday-Photos.zip?rlkey=abcdefghijklmnopqrstuvwxy&st=a1b2c3d4&dl=0',
  'https://files.slack.com/files-pri/T01ABCDEF-F01GHIJKL/screenshot_2026-11-05_at_10.42.17.png?pub_secret=3f9a8b7c6d',
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZjQ5YTg4YjctNmQ1ZS00ZjNhLTJiMWMtMGQ5ZThmN2E2YjVj%40thread.v2/0?context=%7b%22Tid%22%3a%223f9a8b7c-6d5e-4f3a-2b1c-0d9e8f7a6b5c%22%2c%22Oid%22%3a%224d3e2f1a-0b9c-8d7e-6f5a-4b3c2d1e0f9a%22%7d',
  'https://us02web.zoom.us/j/81234567890?pwd=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkw.1&uname=Guest',
  'https://preview.redd.it/a1b2c3d4e5f6g7h8i9j0.jpeg?width=1080&crop=smart&auto=webp&s=3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a',
  'https://pbs.twimg.com/media/GAbCdEfGhIjKlMn?format=jpg&name=4096x4096',
  'https://scontent-lax3-1.cdninstagram.com/v/t51.29350-15/412345678_1234567890123456_1234567890123456789_n.jpg?stp=dst-jpg_e35&efg=eyJ2ZW5jb2RlX3RhZyI6ImltYWdlX3VybGdlbi4xMDgweDEzNTAuc2RyLmYyOTM1MC5kZWZhdWx0X2ltYWdlIn0&_nc_ht=scontent-lax3-1.cdninstagram.com&_nc_cat=1&_nc_ohc=AbCdEfGhIjKQ7kNvgE&oh=00_AYAbCdEfGhIjKlMnOpQrStUvWxYz&oe=67A1B2C3',
  'https://scontent.fsyd3-1.fna.fbcdn.net/v/t39.30808-6/412345678_1234567890123456_1234567890123456789_n.jpg?_nc_cat=105&ccb=1-7&_nc_sid=127cfc&_nc_ohc=AbCdEfGhIjK&_nc_ht=scontent.fsyd3-1.fna&oh=00_AYAbCdEfGhIjKlMnOpQrStUvWxYz&oe=67A1B2C3',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLAbCdEfGhIjKlMnOpQrStUvWxYz012345&index=7&pp=iAQBgAQB8AUB&t=42s&si=AbCdEfGhIjKlMnOp',
  'https://rr3---sn-a5mekn6s.googlevideo.com/videoplayback?expire=1730000000&ei=AbCdEfGhIjKlMnOp&ip=203.0.113.5&id=o-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789&itag=22&source=youtube&requiressl=yes&mime=video%2Fmp4&dur=212.091&lmt=1700000000000000&sig=AJfQdSswRQIgAbCdEfGhIjKlMnOpQrStUvWxYz0123456789AiEA',
  `https://objects.githubusercontent.com/github-production-release-asset-2e65be/123456789/3f9a8b7c-6d5e-4f3a-2b1c-0d9e8f7a6b5c?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAVCODYLSA53PQK4ZA%2F20261105%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261105T120000Z&X-Amz-Expires=300&X-Amz-Signature=${HEX}&X-Amz-SignedHeaders=host&actor_id=0&key_id=0&repo_id=123456789&response-content-disposition=attachment%3B%20filename%3Dnotes.txt&response-content-type=application%2Foctet-stream`,
  'https://github.com/microsoft/vscode/blob/3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts#L1234-L1260',
  'https://www.amazon.com/Some-Long-Product-Name-Here-Black/dp/B0ABCDEFGH/ref=sr_1_3?crid=3F9A8B7C6D5E&dib=eyJ2IjoiMSJ9.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789&dib_tag=se&keywords=usb+c+cable&qid=1730000000&sprefix=usb+c%2Caps%2C150&sr=8-3',
  'https://outlook.office.com/mail/deeplink/compose?to=someone%40example.com&subject=Hello%20there&body=A%20long%20message%20body%20with%20lots%20of%20encoded%20characters%20in%20it%20%26%20more',
  'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813!16zL20vMDJqODE?entry=ttu',
  'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=3f9a8b7c6d5e4f3a&context=spotify%3Aplaylist%3A37i9dQZF1DXcBWIGoYBM5M',
  'https://web.whatsapp.com/send?phone=15551234567&text=Hello%20there%2C%20this%20is%20a%20long%20prefilled%20message%20with%20encoding%21%21%21%20and%20more%20words%20here',
  'https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/?utm_source=share&utm_medium=member_desktop&rcm=ACoAAAbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  'https://www.reddit.com/r/pcmasterrace/comments/1abcdef/my_new_build_after_two_years_of_saving_up/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button',
  'https://store.steampowered.com/app/1091500/Cyberpunk_2077/?snr=1_7_7_151_150_1&curator_clanid=12345678',
  'https://www.roblox.com/games/920587237/Adopt-Me?privateServerLinkCode=12345678901234567890123456789012'
];
const SHAPE = new Set(['U12', 'U13', 'U39', 'U42']);
const scan = (url) => engine.scanUrl(url, { threats: ['scam', 'virus', 'malware'], mode: 'fast' });
const listed = (url, threat = 'malware') => db.prepare('INSERT OR REPLACE INTO feed_urls (url_key, host, source, threat, category, added_at) VALUES (?, ?, ?, ?, ?, ?)')
  .run(urlKey(url), analyze(url).host, 'urlhaus', threat, 'malware_download', Date.now());

test('long links on well-known sites raise no warning, offline or in the app', async () => {
  for (const url of HONEST) {
    const v = offline.scanAddress(url);
    assert.equal(v.overall.badge, null, `${url}: ${v.overall.label}`);
    const app = await scan(url);
    assert.equal(app.overall.badge, null, `${url}: ${app.overall.label} (${(app.reasons || []).map((r) => r.text).join('; ')})`);
  }
});

test('on a well-known site the shape of the link counts for nothing', () => {
  for (const url of HONEST) {
    const p = analyze(url);
    if (!isWellKnown(p)) continue;
    const shaped = offline._test.checksOf(url).filter((c) => SHAPE.has(c.id) && c.points);
    assert.deepEqual(shaped.map((c) => `${c.id} ${c.detail}`), [], url);
  }
  // A long link elsewhere is still a (faint) sign, never enough for a warning on its own.
  const long = `https://example-small-shop.com/p/${'a1b2c3d4'.repeat(30)}`;
  assert.equal(offline._test.checksOf(long).find((c) => c.id === 'U12').status, 'warn');
  assert.equal(offline.scanAddress(long).overall.badge, null);
});

test('the Discord GIF: other listed files on the same CDN are not held against it', async () => {
  // As in the owner's own threat lists: URLhaus lists files people uploaded to cdn.discordapp.com.
  listed('https://cdn.discordapp.com/attachments/111/222/payload.exe');
  listed('https://cdn.discordapp.com/attachments/333/444/stealer.zip');
  const v = await scan(DISCORD_GIF);
  assert.equal(v.overall.badge, null, `${v.overall.label}: ${(v.reasons || []).map((r) => r.text).join('; ')}`);
  assert.equal(v.threats.malware.level, 'safe');
  assert.ok(!(v.reasons || []).some((r) => /character link|listed by/.test(r.text)), 'neither its length nor other files are given as a reason');
});

test('not just Discord: GitHub files and a popular site\'s CDN are not judged by their neighbours', async () => {
  // As in the owner's lists: thousands of URLhaus entries on raw.githubusercontent.com, over a thousand on GoDaddy's
  // image host. GitHub's file hosts are path hosting (the uploader controls the path); wsimg.com is on wellknown.txt.
  for (let i = 0; i < 5; i++) listed(`https://raw.githubusercontent.com/bad${i}/x/main/a.ps1`);
  for (let i = 0; i < 5; i++) listed(`https://img1.wsimg.com/blobby/go/bad${i}/download.exe`);
  for (const url of ['https://raw.githubusercontent.com/nodejs/node/main/README.md', 'https://img1.wsimg.com/isteam/ip/3f9a8b7c-6d5e-4f3a-2b1c-0d9e8f7a6b5c/logo.png/:/rs=w:1200,h:600']) {
    const v = await scan(url);
    assert.equal(v.overall.badge, null, `${url}: ${v.overall.label} (${(v.reasons || []).map((r) => r.text).join('; ')})`);
  }
  // A script from GitHub is still a download to check.
  assert.ok((await scan('https://raw.githubusercontent.com/someone/tools/main/install.ps1')).threats.virus.badge);
});

test('what is served on a well-known site is still checked', async () => {
  // The exact listed address stays confirmed, the same CDN or not.
  const exact = await scan('https://cdn.discordapp.com/attachments/111/222/payload.exe');
  assert.equal(exact.threats.malware.level, 'confirmed');
  assert.equal(exact.overall.badge, 'red');
  // A program from a Discord attachment is still a download to check.
  const exe = await scan('https://cdn.discordapp.com/attachments/1093845729384756123/1187234567890123456/setup.exe');
  assert.equal(exe.checklist.items.find((c) => c.id === 'U14').status, 'fail');
  // A storage bucket is somebody's own, not Amazon's: still user content, never "well known".
  assert.equal(isWellKnown(analyze('https://evil-login.s3.amazonaws.com/index.html')), false);
  assert.equal(isWellKnown(analyze('https://paypal-verify.github.io/')), false);
  assert.equal(isWellKnown(analyze('https://x.duckdns.org/')), false);
});

test('on an unknown site, other listed pages still count', async () => {
  for (const i of [1, 2, 3]) listed(`https://small-hacked-blog.example/wp-content/uploads/drop${i}.exe`);
  const v = await scan('https://small-hacked-blog.example/wp-content/uploads/2026/11/invoice.html');
  assert.equal(v.threats.malware.level, 'likely', v.threats.malware.label);
});

test('phishing and malware addresses are still caught, long or not', () => {
  const caught = [
    'https://paypa1-secure-login.com/account',
    'https://paypal.com.account-verify-session.xyz/signin?session=' + HEX,
    'http://192.168.10.20/login/verify.php',
    'https://xn--pypal-4ve.com/signin',
    'https://login-microsoftonline-secure.top/common/oauth2/authorize?client_id=' + HEX + '&redirect_uri=https%3A%2F%2Flogin-microsoftonline-secure.top%2F',
    'https://chrome-update-required.top/download/ChromeSetup.exe',
    'http://198.51.100.7/bins/setup.exe'
  ];
  for (const url of caught) {
    const v = offline.scanAddress(url);
    assert.ok(v.overall.badge, `${url} should be flagged: ${v.overall.label}`);
  }
  // Brand words planted in front of a well-known name do not borrow its standing.
  assert.equal(isWellKnown(analyze('https://discordapp.com.free-nitro-gift.ru/claim')), false);
});
