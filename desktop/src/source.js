'use strict';
/**
 * Where a download really came from: the fake installer check.
 *
 * Windows writes each download's source into the file's Zone.Identifier stream (HostUrl, the address the file came
 * from, and ReferrerUrl, the page that started it). A program named for a well-known product (ZoomInstaller.exe) that
 * came from anywhere but that product's own site is the classic fake: an ad or a look-alike site at the top of a
 * "zoom download" search. The stream is read here, on this computer, and never sent anywhere; only the source's
 * address goes to Sentinel's own scanner on this computer (the fast check, which opens nothing).
 */
const fs = require('fs');
const { BRANDS } = require('../shared/brands');

const brand = (token) => BRANDS.find((b) => b.token === token).domains;

// Each product's own domains (from the brand list where it has one), what its file names look like, and who signs
// its installers: a genuine installer someone else hosts (a company's own software portal) still carries that.
const PRODUCTS = [
  { name: 'Zoom', home: 'zoom.us', tokens: ['zoom'], domains: brand('zoom'), signer: /zoom/i },
  { name: 'OBS Studio', home: 'obsproject.com', tokens: ['obs', 'obsstudio'], domains: ['obsproject.com'], github: 'obsproject', signer: /\bobs\b|open broadcaster/i },
  { name: 'Discord', home: 'discord.com', tokens: ['discord'], domains: brand('discord'), signer: /discord/i },
  { name: 'Steam', home: 'steampowered.com', tokens: ['steam'], domains: brand('steam'), signer: /valve/i },
  { name: 'Google Chrome', home: 'google.com/chrome', tokens: ['chrome', 'googlechrome'], domains: ['google.com', 'gvt1.com'], signer: /google/i },
  { name: 'AnyDesk', home: 'anydesk.com', tokens: ['anydesk'], domains: ['anydesk.com'], signer: /anydesk/i },
  { name: 'TeamViewer', home: 'teamviewer.com', tokens: ['teamviewer'], domains: ['teamviewer.com'], signer: /teamviewer/i },
  { name: 'WhatsApp', home: 'whatsapp.com', tokens: ['whatsapp'], domains: brand('whatsapp'), signer: /whatsapp|meta platforms/i },
  { name: 'Roblox', home: 'roblox.com', tokens: ['roblox'], domains: brand('roblox'), signer: /roblox/i },
  { name: 'Minecraft', home: 'minecraft.net', tokens: ['minecraft'], domains: ['minecraft.net', 'mojang.com', 'xbox.com'], signer: /mojang|microsoft corporation/i },
  { name: 'Telegram', home: 'telegram.org', tokens: ['telegram'], domains: [...brand('telegram'), 'tdesktop.com'], signer: /telegram/i },
  { name: 'Spotify', home: 'spotify.com', tokens: ['spotify'], domains: brand('spotify'), signer: /spotify/i },
  { name: 'Firefox', home: 'mozilla.org', tokens: ['firefox', 'mozillafirefox'], domains: ['mozilla.org', 'mozilla.net'], signer: /mozilla/i },
  { name: 'Brave', home: 'brave.com', tokens: ['brave', 'bravebrowser'], domains: ['brave.com'], github: 'brave', signer: /brave software/i },
  { name: 'Epic Games', home: 'epicgames.com', tokens: ['epic', 'epicgames'], domains: brand('epicgames'), signer: /epic games/i },
  { name: 'ChatGPT', home: 'chatgpt.com', tokens: ['chatgpt'], domains: brand('chatgpt'), signer: /openai/i }
];

// Where any of them is genuinely offered: the Microsoft Store's installers, and Ninite.
const MIRRORS = ['microsoft.com', 'ninite.com'];
// Hosts anyone can upload to, inside domains that are otherwise a product's own: never proof of the real thing.
const UPLOADS = ['cdn.discordapp.com', 'media.discordapp.net', 'drive.google.com', 'docs.google.com', 'drive.usercontent.google.com', 'sites.google.com'];

// The rest of an installer's name: "ZoomInstallerFull", "OBS-Studio-30.2.3-Windows-Installer", "Discord_Setup (1)".
// A name with any other word in it (obs-backgroundremoval, ZoomIt) is something else and is not judged.
const FILLER = 'setup|installer|install|full|latest|new|official|free|download|downloader|client|desktop|app|player|launcher|studio|windows|win|x64|x86|amd64|arm64|win64|win32|bit|version|ver|v|update|pro|premium|crack|cracked|standalone|enterprise|offline|online|web|portable|release|stable|google|for|pc|browser|games|ninite|\\d';
const named = new Map(PRODUCTS.map((p) => [p, new RegExp(`^(?:${FILLER})*(?:${p.tokens.join('|')})(?:${FILLER})*$`)]));

const INSTALLER = /\.(exe|msi|msix|msixbundle|appx|appxbundle)$/i;

/** The product a file name claims to be, or null. */
function claimed(fileName) {
  const stem = String(fileName).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!stem || stem.length > 80) return null;
  return PRODUCTS.find((p) => named.get(p).test(stem)) || null;
}

/** HostUrl, ReferrerUrl and ZoneId from a Zone.Identifier stream's text. */
function parseZone(text) {
  const out = {};
  for (const line of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*(ZoneId|HostUrl|ReferrerUrl)\s*=\s*(.*?)\s*$/i.exec(line);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return { zoneId: out.zoneid !== undefined ? Number(out.zoneid) : null, hostUrl: out.hosturl || null, referrerUrl: out.referrerurl || null };
}

/** The stream itself, read on this computer (an NTFS stream: "file:Zone.Identifier"). Null when there is none. */
function readZone(file) {
  if (process.platform !== 'win32') return null;
  try { return parseZone(fs.readFileSync(`${file}:Zone.Identifier`, 'utf8')); } catch { return null; }
}

/** A web address as a URL (a "blob:https://..." download included), or null for about:internet and the like. */
function web(u) {
  try {
    const url = new URL(String(u || '').replace(/^blob:/i, ''));
    return /^https?:$/.test(url.protocol) && url.hostname ? url : null;
  } catch { return null; }
}

const within = (host, domains) => domains.some((d) => host === d || host.endsWith(`.${d}`));
function official(product, url) {
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (UPLOADS.includes(host)) return false;
  if (within(host, product.domains) || within(host, MIRRORS)) return true;
  // The product's own GitHub releases: the page (github.com/obsproject/...) is the proof; the file itself comes
  // from GitHub's shared storage.
  return Boolean(product.github) && host === 'github.com' && url.pathname.toLowerCase().startsWith(`/${product.github}/`);
}

/**
 * Judge a download by its source. `zipHasProgram`: the file is a zip with a program inside (an installer too).
 * Returns null when there is nothing to say (not an installer, no named product, no known source), or
 * { product, host, genuine, reason }: genuine when it came from the product's own site or a known mirror.
 */
function judge(fileName, zone, { zipHasProgram = false } = {}) {
  if (!INSTALLER.test(fileName) && !(zipHasProgram && /\.zip$/i.test(fileName))) return null;
  const product = claimed(fileName);
  const from = zone && web(zone.hostUrl);
  if (!product || !from) return null;
  const host = from.hostname.toLowerCase();
  const genuine = official(product, from) || official(product, web(zone.referrerUrl));
  return {
    product: product.name,
    home: product.home,
    host,
    genuine,
    signer: product.signer,
    reason: genuine ? null : `This says it is ${product.name}, but it came from ${host}, not ${product.home}. Get ${product.name} from ${product.home}.`
  };
}

/** Programs and archives: the files whose source is worth judging. */
const RISKY = /\.(exe|msi|msix|msixbundle|appx|appxbundle|zip|rar|7z|iso|img|scr|bat|cmd|ps1|vbs|js|jar|lnk|hta)$/i;

module.exports = { judge, claimed, parseZone, readZone, web, RISKY, PRODUCTS };
