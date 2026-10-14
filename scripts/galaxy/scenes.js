'use strict';
/**
 * The scam scenes on the home page's galaxy (web/assets/js/galaxy.js): small made-up screens, drawn here as SVG and
 * rendered to WebP with ArtCraft's VectorCraft command line.
 *
 *   node scripts/galaxy/scenes.js            write scripts/galaxy/scenes/*.svg and print the page's list markup
 *   node scripts/galaxy/scenes.js --render   also render web/assets/img/galaxy/*.webp (needs VectorCraft, Windows)
 *
 * Every scene is invented: no real logos, no real people, no live links (a brand name in plain text, as the
 * practice inbox has, is fine). The QR codes are random squares that read as nothing.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const W = 480;
const H = 270;
const SANS = 'Segoe UI, Arial, sans-serif';
const MONO = 'Consolas, monospace';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------------------------------------------------------------- pieces */

const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-family="${o.mono ? MONO : SANS}" font-size="${o.size || 13}"${o.bold ? ' font-weight="700"' : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''} fill="${o.fill || '#1d2230'}"${o.op ? ` opacity="${o.op}"` : ''}>${esc(s)}</text>`;
const lines = (x, y, list, o = {}) => list.map((s, i) => text(x, y + i * (o.lh || (o.size || 13) * 1.35), s, o)).join('');
const rect = (x, y, w, h, fill, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${o.r ? ` rx="${o.r}"` : ''} fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1}"` : ''}${o.op ? ` opacity="${o.op}"` : ''}/>`;
const bars = (x, y, widths, fill, h = 6, gap = 12) => widths.map((w, i) => rect(x, y + i * gap, w, h, fill, { r: 3 })).join('');
const grad = (id, a, b, angle = 'v') => `<linearGradient id="${id}" x1="0" y1="0" x2="${angle === 'h' ? 1 : 0}" y2="${angle === 'h' ? 0 : 1}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs}</defs>${body}</svg>\n`;

// A backdrop for every scene: a soft two-tone wash.
const backdrop = (a, b) => [grad('bg', a, b), rect(0, 0, W, H, 'url(#bg)')];

// A browser window filling most of the card, with its address.
function browser(url, body, o = {}) {
  const [d, bg] = backdrop(o.bg1 || '#2b3242', o.bg2 || '#151922');
  const x = 26, y = 20, w = W - 52, h = H - 40;
  return svg(d, bg + rect(x, y, w, h, o.page || '#ffffff', { r: 9 }) +
    `<path d="M${x} ${y + 9}a9 9 0 0 1 9-9h${w - 18}a9 9 0 0 1 9 9v21H${x}z" fill="${o.bar || '#e6e8ee'}"/>` +
    [0, 1, 2].map((i) => `<circle cx="${x + 14 + i * 12}" cy="${y + 15}" r="3.6" fill="${['#e46a5e', '#e8b84a', '#5fbf6a'][i]}"/>`).join('') +
    rect(x + 56, y + 6, w - 70, 18, '#ffffff', { r: 9, stroke: '#cfd3dc' }) +
    text(x + 68, y + 19, url, { size: 11, mono: true, fill: o.urlFill || '#3b4252' }) +
    `<g transform="translate(${x} ${y + 30})">${body}</g>`);
}

// A phone, upright, on a coloured wash, with a short line of context beside it.
function phone(body, o = {}) {
  const [d, bg] = backdrop(o.bg1 || '#33415c', o.bg2 || '#1a2133');
  const px = o.left ? 46 : 170, py = 14, pw = 140, ph = 242;
  return svg(d, bg + (o.side || '') + rect(px, py, pw, ph, '#0d0f14', { r: 20 }) + rect(px + 6, py + 6, pw - 12, ph - 12, o.screen || '#f3f4f7', { r: 15 }) +
    rect(px + 52, py + 11, 36, 6, '#0d0f14', { r: 3 }) + `<g transform="translate(${px + 6} ${py + 24})">${body}</g>`);
}

// A text message thread on the phone: who sent it, and the message (lines), with a link line in blue.
function sms(from, msg, link, o = {}) {
  return phone(rect(0, 0, 128, 26, '#e8eaf0') + text(64, 17, from, { size: 10, bold: true, anchor: 'middle', fill: '#30364a' }) +
    `<path d="M8 40h104a8 8 0 0 1 8 8v${msg.length * 13 + (link ? 14 : 0) + 6}a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z" fill="#dfe2ea"/>` +
    lines(16, 56, msg, { size: 9.5, lh: 13, fill: '#1d2230' }) + (link ? text(16, 56 + msg.length * 13, link, { size: 9.5, fill: '#2458d6' }) : '') +
    text(64, 192, o.time || 'Today 9:41', { size: 8, anchor: 'middle', fill: '#8a90a0' }), o);
}

// A chat window (a game or community chat), dark, with bubbles: [who, [lines], colour].
function chat(title, msgs, o = {}) {
  const [d, bg] = backdrop(o.bg1 || '#3a3357', o.bg2 || '#1a1729');
  let y = 66;
  const body = msgs.map(([who, ls, c]) => {
    const out = `<circle cx="58" cy="${y + 4}" r="11" fill="${c}"/>` + text(78, y, who, { size: 11, bold: true, fill: c }) +
      lines(78, y + 16, ls, { size: 12, lh: 15, fill: '#e7e8f0' });
    y += 30 + ls.length * 15;
    return out;
  }).join('');
  return svg(d, bg + rect(26, 20, W - 52, H - 40, o.panel || '#24232f', { r: 10 }) + rect(26, 20, W - 52, 30, o.head || '#2e2c3c', { r: 10 }) +
    rect(26, 40, W - 52, 10, o.head || '#2e2c3c') + text(46, 40, title, { size: 12, bold: true, fill: '#cfd0e0' }) + body +
    rect(46, H - 52, W - 92, 20, '#34323f', { r: 10 }) + text(58, H - 38, 'Message', { size: 10, fill: '#7d7c90' }));
}

// An email: from, subject, a few body lines, and an attachment or button.
function email(from, subject, body, extra, o = {}) {
  const [d, bg] = backdrop(o.bg1 || '#d9dde6', o.bg2 || '#aab2c3');
  return svg(d, bg + rect(30, 18, W - 60, H - 36, '#ffffff', { r: 8 }) + rect(30, 18, 110, H - 36, '#f1f2f6', { r: 8 }) + rect(132, 18, 8, H - 36, '#f1f2f6') +
    bars(44, 44, [70, 56, 64, 48, 60], '#d8dbe4', 7, 22) + rect(40, 36, 90, 18, o.accent || '#2458d6', { r: 4, op: 0.16 }) +
    text(154, 46, from, { size: 11, fill: '#5a6070' }) + text(154, 68, subject, { size: 14, bold: true, fill: '#151a26' }) +
    lines(154, 92, body, { size: 11, lh: 16, fill: '#3a4050' }) + (extra || ''));
}

// A button, centred on x.
const button = (cx, y, w, label, fill = '#2458d6', ink = '#ffffff') => rect(cx - w / 2, y, w, 26, fill, { r: 5 }) + text(cx, y + 17, label, { size: 12, bold: true, anchor: 'middle', fill: ink });

// A file chip: an icon and a name.
const filechip = (x, y, name, c = '#c0392b') => rect(x, y, 196, 34, '#f4f5f8', { r: 6, stroke: '#d4d7e0' }) + rect(x + 8, y + 6, 18, 22, c, { r: 2 }) +
  text(x + 34, y + 21, name, { size: 11, mono: true, fill: '#202530' });

// Random squares in a QR's shape, seeded, that read as nothing.
function fakeqr(x, y, size, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = 21, m = size / n;
  let out = rect(x - m, y - m, size + 2 * m, size + 2 * m, '#ffffff');
  const finder = (fx, fy) => rect(x + fx * m, y + fy * m, 7 * m, 7 * m, '#111') + rect(x + (fx + 1) * m, y + (fy + 1) * m, 5 * m, 5 * m, '#fff') + rect(x + (fx + 2) * m, y + (fy + 2) * m, 3 * m, 3 * m, '#111');
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if ((r < 8 && c < 8) || (r < 8 && c > 12) || (r > 12 && c < 8)) continue;
    if (rnd() < 0.5) out += rect((x + c * m).toFixed(2), (y + r * m).toFixed(2), m.toFixed(2), m.toFixed(2), '#111');
  }
  return out + finder(0, 0) + finder(14, 0) + finder(0, 14);
}

/* ---------------------------------------------------------------- the scenes */

// id, the mask it earns (kind, tint), the verdict tag, a one-line caption, and the art.
const SCENES = [
  { id: 'signin', kind: 'scam', tint: 'red', tag: 'Look-alike domain', title: 'A fake sign-in page',
    caption: 'A sign-in page on a look-alike address, made to catch a password.',
    svg: () => browser('rnicrosoft-account-verify.com/login', rect(0, 0, 428, 200, '#f6f7fb') + rect(134, 20, 160, 160, '#fff', { r: 6, stroke: '#dde0e8' }) +
      text(214, 50, 'Sign in', { size: 17, bold: true, anchor: 'middle' }) + text(214, 68, 'to continue to your account', { size: 9.5, anchor: 'middle', fill: '#6a7080' }) +
      rect(150, 80, 128, 22, '#fff', { r: 3, stroke: '#c5c9d4' }) + text(158, 95, 'Email or phone', { size: 9.5, fill: '#9aa0ae' }) +
      rect(150, 108, 128, 22, '#fff', { r: 3, stroke: '#c5c9d4' }) + text(158, 123, 'Password', { size: 9.5, fill: '#9aa0ae' }) + button(214, 140, 128, 'Sign in')) },
  { id: 'toll', kind: 'scam', tint: 'orange', tag: 'Unpaid toll bait', title: 'An unpaid toll text',
    caption: 'A text about a small unpaid toll, with a link that is not the toll road\u2019s.',
    svg: () => sms('+1 (205) 555-0143', ['Toll Services: You have', 'an unpaid toll of $4.15.', 'Pay today to avoid a', '$50 late fee:'], 'tolls-pay-now.top/us', { bg1: '#3b4b6b', bg2: '#1b2338',
      side: text(340, 112, 'UNPAID', { size: 24, bold: true, fill: '#ffcf5a', op: 0.85 }) + text(340, 140, '$4.15', { size: 30, bold: true, fill: '#ffffff', op: 0.9 }) }) },
  { id: 'parcel', kind: 'scam', tint: 'orange', tag: 'Parcel fee lure', title: 'A parcel fee text',
    caption: 'A parcel is held for a tiny fee, so a card number can be taken.',
    svg: () => sms('Parcel Desk', ['Your parcel could not be', 'delivered. Pay the $1.99', 'redelivery fee within', '24 hours:'], 'parcel-redeliver.info/p', { bg1: '#5b4a33', bg2: '#2a2117',
      side: `<g transform="translate(330 86)"><path d="M0 30 50 8l50 22v58L50 110 0 88z" fill="#c99a5b"/><path d="M0 30l50 22 50-22M50 52v58" fill="none" stroke="#8a6334" stroke-width="2"/><path d="M22 20l50 22" stroke="#e8d3ad" stroke-width="7"/></g>` }) },
  { id: 'virusalert', kind: 'scam', tint: 'red', tag: 'Fake virus alert', title: 'A full-screen fake virus alert',
    caption: 'A web page dressed as a security warning, with a number to call.',
    svg: () => svg(grad('bg', '#c4231c', '#6e0d0a'), rect(0, 0, W, H, 'url(#bg)') + rect(70, 40, 340, 190, '#ffffff', { r: 4 }) + rect(70, 40, 340, 30, '#1f5fbf', { r: 4 }) + rect(70, 60, 340, 10, '#1f5fbf') +
      text(84, 60, 'Security Center', { size: 12, bold: true, fill: '#fff' }) + `<path d="M98 86 112 112H84z" fill="#e8b020"/>` + text(98, 108, '!', { size: 14, bold: true, anchor: 'middle', fill: '#111' }) +
      lines(124, 96, ['Your computer is infected', 'with 5 viruses.'], { size: 15, bold: true, fill: '#b01c16' }) +
      lines(124, 140, ['Do not restart. Call support now:'], { size: 11, fill: '#333' }) + text(124, 166, '1-888-555-0199', { size: 20, bold: true, fill: '#111' }) +
      button(240, 186, 150, 'Scan now', '#1f5fbf') + text(240, 26, 'WARNING  WARNING  WARNING', { size: 13, bold: true, anchor: 'middle', fill: '#ffd2cc' })) },
  { id: 'doubler', kind: 'scam', tint: 'red', tag: 'Crypto doubler', title: 'A crypto giveaway that doubles your coins',
    caption: 'Send some coins and get twice as many back. Nobody ever does.',
    svg: () => svg(grad('bg', '#18122e', '#3b1d5e'), rect(0, 0, W, H, 'url(#bg)') + rect(26, 20, 300, 200, '#0b0916', { r: 8 }) + `<circle cx="176" cy="104" r="46" fill="#f2a900"/><text x="176" y="122" font-family="${SANS}" font-size="52" font-weight="700" text-anchor="middle" fill="#fff">B</text>` +
      rect(34, 28, 44, 16, '#e0332b', { r: 3 }) + text(56, 40, 'LIVE', { size: 10, bold: true, anchor: 'middle', fill: '#fff' }) +
      text(176, 180, 'Send 1, get 2 back', { size: 17, bold: true, anchor: 'middle', fill: '#ffe08a' }) + text(176, 204, 'Official giveaway, ends in 10:00', { size: 10, anchor: 'middle', fill: '#b8b0d8' }) +
      rect(338, 20, 116, 230, '#120f22', { r: 8 }) + lines(348, 44, ['sent 0.5 BTC', 'got 1.0 BTC!', 'sent 2 ETH', 'thank you!!', 'sent 0.1 BTC', 'it works'], { size: 10, lh: 30, fill: '#9d96c4' })) },
  { id: 'giftcards', kind: 'scam', tint: 'orange', tag: 'Asks for gift cards', title: 'A chat asking for gift cards',
    caption: 'A boss, a friend or a support agent who wants the codes off gift cards.',
    svg: () => chat('Direct message', [['Alex (Manager)', ['Are you free? I need a quick favour.'], '#7fb6ff'], ['Alex (Manager)', ['Buy 4 gift cards of $100 each and', 'send me photos of the codes.'], '#7fb6ff'], ['Alex (Manager)', ['Keep it between us for now.'], '#7fb6ff']], { bg1: '#22394a', bg2: '#0f1a24' }) },
  { id: 'qrmeter', kind: 'scam', tint: 'yellow', tag: 'QR sticker over the real one', title: 'A QR sticker on a parking meter',
    caption: 'A sticker on a parking meter that sends payments to a stranger\u2019s page.',
    svg: () => svg(grad('bg', '#8fb3c9', '#4e6f84'), rect(0, 0, W, H, 'url(#bg)') + rect(0, 214, W, 56, '#3d4a52') + rect(206, 150, 28, 70, '#5b646b') +
      rect(160, 26, 120, 140, '#2f6f8f', { r: 12 }) + rect(172, 38, 96, 30, '#a8d8c8', { r: 3 }) + text(220, 58, 'PAY HERE', { size: 12, bold: true, anchor: 'middle', fill: '#14384a' }) +
      `<g transform="rotate(-4 220 118)">${fakeqr(192, 84, 56, 991)}</g>` + text(220, 160, 'SCAN TO PAY', { size: 9, bold: true, anchor: 'middle', fill: '#e8f2f6' }) +
      text(330, 70, 'P', { size: 54, bold: true, fill: '#ffffff', op: 0.85 })) },
  { id: 'robux', kind: 'scam', tint: 'orange', tag: 'Free Robux bait', title: 'A free Robux generator',
    caption: 'Free game money for a password. There is no such generator.',
    svg: () => browser('free-robux-gen.click/claim', rect(0, 0, 428, 200, '#101a2b') + text(214, 46, 'FREE ROBUX', { size: 28, bold: true, anchor: 'middle', fill: '#5df08a' }) +
      text(214, 68, 'Generator 2026, works for every account', { size: 10, anchor: 'middle', fill: '#9fb4d0' }) +
      [400, 1700, 4500].map((n, i) => rect(70 + i * 100, 84, 88, 52, '#1b2a44', { r: 6, stroke: i === 2 ? '#5df08a' : '#2c3f60' }) + text(114 + i * 100, 116, String(n), { size: 16, bold: true, anchor: 'middle', fill: '#fff' })).join('') +
      rect(110, 148, 208, 20, '#fff', { r: 3 }) + text(118, 162, 'Username and password', { size: 9.5, fill: '#888' }) + button(214, 172, 120, 'Generate', '#22b35a'), { page: '#101a2b' }) },
  { id: 'nitro', kind: 'scam', tint: 'orange', tag: 'Nitro gift bait', title: 'A free Discord Nitro gift',
    caption: 'A gift link from a friend\u2019s account, sent to everyone it knows.',
    svg: () => chat('# general', [['kiwi_2009', ['yo free nitro for everyone, claim fast'], '#f5a3c7'], ['kiwi_2009', ['discorcl-gift.com/nitro/claim'], '#f5a3c7']], { bg1: '#3a3d8f', bg2: '#191b45',
      head: '#2b2d3f', panel: '#313338' }).replace('</svg>', rect(78, 150, 260, 52, '#2b2d31', { r: 6, stroke: '#4a4d58' }) + rect(88, 160, 32, 32, '#7a5cff', { r: 8 }) + text(130, 173, 'A gift for you!', { size: 11, bold: true, fill: '#dbdee1' }) + text(130, 189, 'Nitro, 1 month', { size: 9.5, fill: '#9a9eaa' }) + button(296, 163, 64, 'Claim', '#248046') + '</svg>') },
  { id: 'shop', kind: 'scam', tint: 'yellow', tag: 'New shop, too-good prices', title: 'A fake shop checkout',
    caption: 'A shop that opened last week, with every price cut by 90 percent.',
    svg: () => browser('outlet-sneakers-sale.shop/checkout', rect(0, 0, 428, 200, '#fbf7f1') + rect(18, 16, 120, 120, '#e9e1d4', { r: 6 }) +
      `<path d="M38 98c20-2 36-14 46-30l18 6c6 2 14 10 22 12v14H38z" fill="#d2603a"/><path d="M38 104h86v8H38z" fill="#fff"/>` +
      text(154, 34, 'Running shoes, all sizes', { size: 13, bold: true }) + text(154, 56, '$189.00', { size: 12, fill: '#9a9a9a' }) + `<path d="M154 52h52" stroke="#9a9a9a"/>` +
      text(216, 57, '$18.90', { size: 18, bold: true, fill: '#d2283a' }) + rect(154, 66, 60, 16, '#d2283a', { r: 3 }) + text(184, 78, '-90%', { size: 10, bold: true, anchor: 'middle', fill: '#fff' }) +
      text(154, 104, 'Pay by bank transfer for an', { size: 10, fill: '#555' }) + text(154, 118, 'extra 10% off', { size: 10, fill: '#555' }) + button(214, 150, 180, 'Complete order', '#1b1b1b')) },
  { id: 'invoice', kind: 'scam', tint: 'orange', tag: 'Fake renewal invoice', title: 'A fake invoice for a renewal',
    caption: 'An invoice for something never bought, with a phone number to cancel it.',
    svg: () => email('Billing Department <billing@secure-renewals.net>', 'Invoice #44791: payment received', ['Your yearly protection plan renewed', 'today. $399.99 has been charged.', 'Not you? Call within 24 hours to cancel:'], text(154, 162, '+1 (808) 555-0172', { size: 18, bold: true, fill: '#151a26' }) +
      rect(154, 176, 150, 34, '#f4f5f8', { r: 4, stroke: '#d4d7e0' }) + text(164, 197, 'TOTAL  $399.99', { size: 12, bold: true, mono: true, fill: '#b01c16' })) },
  { id: 'remote', kind: 'scam', tint: 'red', tag: 'Asks for remote access', title: 'A call that asks to control your computer',
    caption: 'A caller says the computer is broken and asks to install a remote control app.',
    svg: () => phone(rect(0, 0, 128, 206, '#16301f') + `<circle cx="64" cy="48" r="22" fill="#2f5a3d"/>` + text(64, 56, '?', { size: 22, bold: true, anchor: 'middle', fill: '#cfe8d6' }) +
      text(64, 94, 'Windows Support', { size: 11, bold: true, anchor: 'middle', fill: '#fff' }) + text(64, 110, '04:12', { size: 10, anchor: 'middle', fill: '#a6c9b0' }) +
      `<circle cx="34" cy="170" r="14" fill="#e0332b"/><circle cx="94" cy="170" r="14" fill="#3a5a46"/>`, { screen: '#16301f', bg1: '#2f4a3a', bg2: '#141f19',
      side: rect(326, 70, 132, 70, '#ffffff', { r: 12 }) + `<path d="M340 140l-6 18 22-18z" fill="#fff"/>` + lines(338, 94, ['Please install the', 'app so I can fix', 'your computer.'], { size: 11, lh: 15, fill: '#1d2230' }) }) },
  { id: 'wrongnumber', kind: 'scam', tint: 'yellow', tag: 'Wrong-number opener', title: 'A wrong-number text',
    caption: 'A friendly message to the wrong number, the start of a long con.',
    svg: () => sms('+44 7700 900461', ['Hi Emma, are we still on', 'for golf on Sunday?', '', 'Oh sorry, wrong number!', 'But nice to meet you :)'], null, { bg1: '#4a5a3a', bg2: '#202816',
      side: text(330, 128, 'Hi?', { size: 40, bold: true, fill: '#e9f0d8', op: 0.85 }) }) },
  { id: 'fakeupdate', kind: 'malware', tint: 'red', tag: 'Fake browser update', title: 'A fake browser update',
    caption: 'A page says the browser is out of date and offers a program to download.',
    svg: () => browser('news-today-daily.site/article', rect(0, 0, 428, 200, '#eef1f6') + bars(24, 20, [380, 340, 360, 300, 370, 320, 350], '#d6dbe4', 7, 16) +
      rect(70, 30, 288, 150, '#ffffff', { r: 8, stroke: '#c8ceda' }) + `<circle cx="214" cy="66" r="20" fill="#4285f4"/><circle cx="214" cy="66" r="8" fill="#fff"/>` +
      text(214, 110, 'Your browser is out of date', { size: 14, bold: true, anchor: 'middle' }) + text(214, 128, 'Update now to keep viewing this page.', { size: 10, anchor: 'middle', fill: '#555' }) + button(214, 140, 130, 'Update', '#1a73e8')) },
  { id: 'doubleext', kind: 'virus', tint: 'red', tag: 'Program dressed as a PDF', title: 'A program named like a PDF',
    caption: 'A file called Statement.pdf.exe: a program wearing a document\u2019s name.',
    svg: () => email('Accounts <accounts@statements-portal.com>', 'Your statement is ready', ['Please open the attached statement', 'and confirm the payment details.'], filechip(154, 140, 'Statement.pdf.exe') + filechip(154, 182, 'Statement.pdf', '#5a6070'), { bg1: '#e6d6d6', bg2: '#b89b9b', accent: '#c0392b' }) },
  { id: 'clickfix', kind: 'malware', tint: 'red', tag: 'Paste-and-run trap', title: 'A check that asks you to paste a command',
    caption: 'A fake robot check that asks you to press Windows+R and paste a command.',
    svg: () => browser('cdn-verify-human.live/check', rect(0, 0, 428, 200, '#f5f6f8') + rect(84, 18, 260, 164, '#fff', { r: 6, stroke: '#d5d9e0' }) +
      rect(100, 34, 18, 18, '#fff', { r: 3, stroke: '#7a8090', sw: 1.5 }) + `<path d="M104 43l4 4 7-8" stroke="#2a9d4a" stroke-width="2.5" fill="none"/>` + text(128, 48, 'Verify you are human', { size: 12, bold: true }) +
      lines(100, 76, ['1. Press  Windows + R', '2. Press  Ctrl + V', '3. Press  Enter'], { size: 12, lh: 22, mono: true, fill: '#222' }) +
      rect(100, 144, 228, 24, '#202530', { r: 3 }) + text(108, 160, 'powershell -w h -c iwr ...', { size: 10, mono: true, fill: '#9fe0a8' })) },
  { id: 'seedphrase', kind: 'scam', tint: 'red', tag: 'Asks for recovery phrase', title: 'A page that asks for a wallet\u2019s recovery phrase',
    caption: 'A wallet \u201csync\u201d page that wants the twelve secret words.',
    svg: () => browser('wallet-sync-validate.app', rect(0, 0, 428, 200, '#141821') + text(214, 30, 'Validate your wallet', { size: 15, bold: true, anchor: 'middle', fill: '#fff' }) +
      text(214, 48, 'Enter your 12-word recovery phrase to sync', { size: 10, anchor: 'middle', fill: '#9aa3b8' }) +
      Array.from({ length: 12 }, (_, i) => rect(40 + (i % 4) * 90, 62 + Math.floor(i / 4) * 32, 80, 24, '#1f2533', { r: 4, stroke: '#323b4f' }) + text(48 + (i % 4) * 90, 78 + Math.floor(i / 4) * 32, `${i + 1}.`, { size: 9.5, fill: '#6e7890' })).join('') +
      button(214, 164, 140, 'Validate', '#3b82f6'), { page: '#141821' }) },
  { id: 'prize', kind: 'scam', tint: 'orange', tag: 'Prize that costs money', title: 'A prize you pay to claim',
    caption: 'A phone won in a survey, if a small shipping fee is paid by card.',
    svg: () => svg(grad('bg', '#ffb83a', '#e2532d'), rect(0, 0, W, H, 'url(#bg)') + Array.from({ length: 22 }, (_, i) => rect(10 + ((i * 7919) % 97) / 97 * 450, 8 + ((i * 104729) % 89) / 89 * 250, 8, 14, ['#fff', '#3b82f6', '#22b35a'][i % 3], { r: 2, op: 0.8 })).join('') +
      rect(140, 30, 200, 210, '#fff', { r: 12 }) + text(240, 64, 'Congratulations!', { size: 18, bold: true, anchor: 'middle', fill: '#d2283a' }) +
      rect(208, 78, 64, 96, '#1d2230', { r: 10 }) + rect(213, 84, 54, 84, '#5b8cff', { r: 6 }) + text(240, 196, 'Pay $1.95 shipping', { size: 12, bold: true, anchor: 'middle' }) + button(240, 204, 140, 'Claim now', '#22a650')) },
  { id: 'bankalert', kind: 'scam', tint: 'orange', tag: 'Urgent bank alert', title: 'A text about a blocked bank card',
    caption: 'A text that says a card is blocked, with a link to \u201cverify\u201d it.',
    svg: () => sms('BANK-ALERT', ['A payment of $984.00 was', 'attempted on your card.', 'If this was not you,', 'verify now:'], 'secure-bank-verify.co/id', { bg1: '#22406a', bg2: '#0d1a2e',
      side: rect(318, 92, 136, 86, '#2a5fa8', { r: 10 }) + rect(318, 110, 136, 16, '#14284a') + rect(330, 140, 30, 22, '#e8c46a', { r: 3 }) + text(386, 168, '**** 4417', { size: 11, mono: true, fill: '#dfe8f6' }) }) },
  { id: 'job', kind: 'scam', tint: 'yellow', tag: 'Too-easy job offer', title: 'A job paying for likes',
    caption: 'A job that pays for liking videos, until it asks for a deposit.',
    svg: () => chat('Recruiter', [['Mia | HR team', ['Hello! Part-time job, $300 to $800', 'a day. Just like videos on your phone.'], '#ffc46b'], ['Mia | HR team', ['First task pays $5. To unlock the', 'next level, add $100 to your account.'], '#ffc46b']], { bg1: '#2c3a54', bg2: '#121a28' }) },
  { id: 'investment', kind: 'scam', tint: 'orange', tag: 'Guaranteed returns', title: 'An investment app with sure profits',
    caption: 'A trading app a new friend recommends, with returns no market gives.',
    svg: () => phone(rect(0, 0, 128, 206, '#0e1a14') + text(12, 24, 'Balance', { size: 9, fill: '#7fa894' }) + text(12, 46, '$48,210.55', { size: 16, bold: true, fill: '#fff' }) +
      text(12, 62, '+40.2% this week', { size: 9.5, bold: true, fill: '#38e08a' }) + `<path d="M10 140 30 128 46 132 64 108 82 112 100 84 118 66" fill="none" stroke="#38e08a" stroke-width="2.5"/>` +
      button(64, 162, 108, 'Deposit more', '#22b35a'), { screen: '#0e1a14', bg1: '#1d3b30', bg2: '#0a1511', left: true,
      side: lines(222, 104, ['Guaranteed', '40% a week'], { size: 26, bold: true, lh: 34, fill: '#d8f5e4', op: 0.9 }) }) },
  { id: 'notify', kind: 'malware', tint: 'yellow', tag: 'Notification trap', title: 'A page that wants to send notifications',
    caption: 'A page that says to click Allow to prove you are not a robot.',
    svg: () => browser('robot-check-2299.xyz', rect(0, 0, 428, 200, '#2a2d36') + text(214, 120, 'Click Allow if you are not a robot', { size: 16, bold: true, anchor: 'middle', fill: '#fff' }) +
      rect(10, 4, 220, 82, '#ffffff', { r: 6, stroke: '#c8ccd6' }) + text(22, 26, 'robot-check-2299.xyz wants to', { size: 10.5 }) + text(22, 46, 'Show notifications', { size: 11, bold: true }) +
      button(110, 56, 60, 'Allow', '#1a73e8') + rect(150, 56, 64, 26, '#fff', { r: 5, stroke: '#c8ccd6' }) + text(182, 73, 'Block', { size: 12, anchor: 'middle', fill: '#1a73e8' }), { page: '#2a2d36' }) },
  { id: 'taxrefund', kind: 'scam', tint: 'orange', tag: 'Fake government service', title: 'A tax refund email',
    caption: 'A refund from the tax office, which only needs your bank login to pay.',
    svg: () => email('Tax Refunds <refund@tax-office-claims.org>', 'You are eligible for a refund of $842.19', ['After the yearly review of your tax', 'payments, a refund is due to you.', 'Claim it before Friday.'], button(226, 172, 144, 'Claim refund', '#1e6b3a'), { bg1: '#d6e2d6', bg2: '#94ad97', accent: '#1e6b3a' }) },
  { id: 'crack', kind: 'virus', tint: 'orange', tag: 'Archive hiding a program', title: 'A cracked game download',
    caption: 'A paid game for free, in a zip with a password and a program inside.',
    svg: () => browser('games-free-full.ru/download', rect(0, 0, 428, 200, '#151515') + rect(18, 16, 140, 168, '#2c4a2a', { r: 6 }) + `<path d="M40 150l28-60 22 30 14-18 34 48z" fill="#5c8f3a"/><rect x="48" y="40" width="44" height="44" fill="#7a5532"/>` +
      text(174, 40, 'Block Builder: Full Game', { size: 14, bold: true, fill: '#fff' }) + text(174, 58, 'Cracked, all items unlocked', { size: 10, fill: '#b0b0b0' }) +
      text(174, 92, 'Archive password: 1234', { size: 10.5, mono: true, fill: '#e8c04a' }) + button(244, 116, 140, 'Free download', '#d13b2e') + text(174, 170, 'block_builder_full.zip  (12 MB)', { size: 9.5, mono: true, fill: '#888' }), { page: '#151515' }) },
  { id: 'macro', kind: 'virus', tint: 'orange', tag: 'Asks to enable macros', title: 'A document asking to enable content',
    caption: 'A blurry document that says to click Enable Content to read it.',
    svg: () => svg(grad('bg', '#2b579a', '#16305a'), rect(0, 0, W, H, 'url(#bg)') + rect(40, 24, 400, 222, '#ffffff', { r: 4 }) + rect(40, 24, 400, 26, '#f3d27a') +
      text(52, 41, 'SECURITY WARNING  Macros have been disabled.', { size: 10, bold: true, fill: '#3a2a00' }) + rect(362, 29, 70, 16, '#fff', { r: 2, stroke: '#a88a2a' }) + text(397, 41, 'Enable Content', { size: 8.5, anchor: 'middle', fill: '#3a2a00' }) +
      bars(70, 72, [300, 260, 320, 240, 280, 300, 200, 260, 290], '#d8dce4', 8, 17) + rect(120, 110, 240, 66, '#ffffff', { r: 4, stroke: '#2b579a', sw: 2 }) +
      lines(240, 136, ['This document is protected.', 'Click Enable Content to view it.'], { size: 11, bold: true, anchor: 'middle', lh: 18, fill: '#2b579a' })) },
  { id: 'appeal', kind: 'scam', tint: 'orange', tag: 'Fake account appeal', title: 'A warning that an account will be deleted',
    caption: 'A message that a social account broke the rules, with a form to appeal.',
    svg: () => email('Support Team <no-reply@community-appeals.help>', 'Your account will be deleted in 24 hours', ['We received reports that your account', 'breaks our copyright rules. If you think', 'this is a mistake, appeal below.'], button(222, 172, 136, 'Appeal now', '#c13584'), { bg1: '#f0d6e6', bg2: '#c08aac', accent: '#c13584' }) },
  { id: 'himum', kind: 'scam', tint: 'orange', tag: 'New-number family plea', title: 'A text from a child on a new number',
    caption: 'A child on a new number who urgently needs money for a bill.',
    svg: () => sms('+1 (415) 555-0128', ['Hi Mum, I dropped my phone.', 'This is my new number.', 'Can you pay a bill for me?', 'I will pay you back tomorrow.'], null, { bg1: '#6a4a6a', bg2: '#2a1b2a',
      side: `<path d="M340 96c-14-20-48-10-40 18 6 20 40 40 40 40s34-20 40-40c8-28-26-38-40-18z" fill="#f0a7c8" opacity=".9"/>` }) },
  { id: 'mailbox', kind: 'scam', tint: 'orange', tag: 'Password expiry bait', title: 'An email that says a password expires today',
    caption: 'A mailbox notice that a password expires, with a button to keep it.',
    svg: () => email('IT Helpdesk <it-desk@mail-admin-portal.com>', 'Your password expires today', ['Your mailbox password will expire in', '2 hours. Keep your current password', 'to avoid losing your emails.'], button(234, 172, 160, 'Keep same password', '#0f6cbd'), { bg1: '#d6e2f0', bg2: '#8ea8c8' }) },
  { id: 'popup', kind: 'scam', tint: 'red', tag: 'Fake sign-in pop-up', title: 'A fake game sign-in window',
    caption: 'A pop-up that looks like a game store\u2019s sign-in, drawn inside the page.',
    svg: () => browser('vote-for-team-esports.gg', rect(0, 0, 428, 200, '#1b2838') + text(30, 40, 'Vote for our team!', { size: 16, bold: true, fill: '#fff' }) + text(30, 60, 'Sign in with your game account to vote.', { size: 10, fill: '#8fa4b8' }) +
      rect(176, 22, 228, 166, '#171a21', { r: 4, stroke: '#3d4450' }) + rect(176, 22, 228, 22, '#2a2f3a') + text(186, 37, 'Sign in  -  Game Store', { size: 10, fill: '#c7d5e0' }) +
      rect(192, 58, 196, 24, '#32353c', { r: 2 }) + rect(192, 92, 196, 24, '#32353c', { r: 2 }) + text(200, 74, 'Account name', { size: 9.5, fill: '#7a8696' }) + text(200, 108, 'Password', { size: 9.5, fill: '#7a8696' }) +
      button(290, 132, 196, 'Sign in', '#1a9fff'), { page: '#1b2838' }) },
  { id: 'overpay', kind: 'scam', tint: 'red', tag: 'Refund overpayment trick', title: 'A refund that was \u201ctoo much\u201d',
    caption: 'A caller \u201crefunds\u201d too much and asks for the difference back in gift cards.',
    svg: () => browser('my-bank-online.com/accounts', rect(0, 0, 428, 200, '#f5f7fa') + text(24, 30, 'Checking account', { size: 13, bold: true }) +
      text(24, 70, '$5,240.00', { size: 30, bold: true, fill: '#1e7a3a' }) + rect(24, 86, 380, 1, '#d8dce4') +
      lines(24, 110, ['Refund received', 'Coffee shop', 'Grocery'], { size: 11, lh: 20, fill: '#333' }) + lines(404, 110, ['+$5,000.00', '-$4.50', '-$62.10'], { size: 11, mono: true, lh: 20, anchor: 'end', fill: '#333' }) +
      rect(250, 20, 160, 44, '#fff4d6', { r: 6, stroke: '#e8c46a' }) + lines(260, 38, ['"We sent too much. Please', 'send $4,500 back."'], { size: 9.5, lh: 14, fill: '#6a4a00' })) },
  { id: 'player', kind: 'malware', tint: 'orange', tag: 'Install a player to watch', title: 'A stream that needs a player installed',
    caption: 'A free film stream that needs a \u201cplayer\u201d installed first.',
    svg: () => browser('watch-free-movies-hd.to/stream', rect(0, 0, 428, 200, '#000') + rect(0, 0, 428, 170, '#14161c') + `<circle cx="214" cy="80" r="30" fill="none" stroke="#fff" stroke-width="3"/><path d="M204 64v32l26-16z" fill="#fff"/>` +
      rect(104, 120, 220, 40, '#fff', { r: 4 }) + text(214, 136, 'Install HD Player to watch', { size: 11, bold: true, anchor: 'middle' }) + text(214, 152, 'hd-player-setup.exe', { size: 9.5, mono: true, anchor: 'middle', fill: '#c0392b' }) +
      rect(0, 170, 428, 30, '#0a0b0e') + rect(12, 183, 300, 4, '#444', { r: 2 }) + rect(12, 183, 40, 4, '#e50914', { r: 2 }), { page: '#000' }) },
  { id: 'inherit', kind: 'scam', tint: 'yellow', tag: 'Inheritance letter', title: 'A letter about an inheritance',
    caption: 'A lawyer abroad with millions for you, after a few fees.',
    svg: () => email('Estate Office <estates.chambers@mailbox.example>', 'Unclaimed estate of $4,500,000', ['I write about the estate of a late client', 'who shares your family name. You are', 'named as next of kin. Reply in confidence.'], text(154, 182, 'Strictly confidential', { size: 12, bold: true, fill: '#8a6a00' }), { bg1: '#efe6c8', bg2: '#bfae7a', accent: '#8a6a00' }) },
  { id: 'extension', kind: 'malware', tint: 'yellow', tag: 'Add-on with too many rights', title: 'A browser add-on that wants to read every site',
    caption: 'A coupon add-on that asks to read and change everything on every site.',
    svg: () => browser('addons-store.example/coupon-saver', rect(0, 0, 428, 200, '#eef0f4') + rect(60, 20, 308, 160, '#fff', { r: 8, stroke: '#cdd2dc' }) +
      rect(78, 38, 34, 34, '#ff8a3d', { r: 8 }) + text(95, 61, '%', { size: 18, bold: true, anchor: 'middle', fill: '#fff' }) + text(124, 52, 'Add "Coupon Saver"?', { size: 13, bold: true }) +
      text(124, 68, 'It can:', { size: 10, fill: '#555' }) + lines(84, 98, ['Read and change all your data on all websites', 'Read your browsing history', 'Manage your downloads'], { size: 10, lh: 18, fill: '#333' }) +
      button(318, 146, 80, 'Add', '#1a73e8')) },
  { id: 'threat', kind: 'scam', tint: 'orange', tag: 'Threat with an old password', title: 'An email that threatens with an old password',
    caption: 'A stranger quotes an old leaked password and demands payment in crypto.',
    svg: () => email('Unknown <x7r2@protonmail.example>', 'I know your password: sunflower88', ['I have access to your device. Send', '$1,200 in Bitcoin within 48 hours,', 'or I share what I found.'], rect(154, 166, 260, 26, '#f4f5f8', { r: 4 }) + text(162, 183, 'bc1q8x2...f7k3p9', { size: 11, mono: true, fill: '#333' }), { bg1: '#2a2a2a', bg2: '#0e0e0e', accent: '#b01c16' }) },
  { id: 'payment', kind: 'scam', tint: 'orange', tag: 'Fake payment link', title: 'A buyer\u2019s fake payment link',
    caption: 'A buyer on a marketplace sends a link to \u201creceive\u201d the money.',
    svg: () => chat('Marketplace chat', [['Buyer', ['I paid for the sofa already. Click the', 'link to receive the money to your card.'], '#7fd1ff'], ['Buyer', ['market-safe-pay.delivery/receive'], '#7fd1ff']], { bg1: '#1e4a5a', bg2: '#0b1f27' }).replace('</svg>', rect(78, 154, 200, 44, '#20343c', { r: 6, stroke: '#3a5862' }) + text(90, 172, 'Payment received: $350', { size: 11, bold: true, fill: '#7fe0a8' }) + text(90, 188, 'Enter card to withdraw', { size: 10, fill: '#a8c0c8' }) + '</svg>') },
  { id: 'code', kind: 'scam', tint: 'red', tag: 'Asks for your code', title: 'A message asking for a sign-in code',
    caption: 'Someone says they sent you a code by mistake and asks you to read it back.',
    svg: () => phone(rect(0, 0, 128, 26, '#e8eaf0') + text(64, 17, 'Messages', { size: 10, bold: true, anchor: 'middle', fill: '#30364a' }) +
      rect(8, 36, 112, 46, '#dfe2ea', { r: 8 }) + lines(16, 52, ['Your code is 482 913.', 'Never share it.'], { size: 9.5, lh: 13 }) +
      rect(8, 92, 112, 58, '#4f8cff', { r: 8 }) + lines(16, 108, ['Sorry, I sent my code', 'to you by mistake. Can', 'you send it to me?'], { size: 9.5, lh: 13, fill: '#fff' }), { bg1: '#3b2a5a', bg2: '#181026',
      side: text(330, 140, '482 913', { size: 30, bold: true, mono: true, fill: '#ffffff', op: 0.85 }) }) }
];

// The mask art already on the site: the three masks in their three colours.
const MASKS = ['scam', 'virus', 'malware'].flatMap((kind) => ['yellow', 'orange', 'red'].map((tint) => ({
  id: `mask-${kind}-${tint}`, kind, tint, mask: true, img: `masks/${kind}-${tint}.webp`,
  title: `The ${kind} mask in ${tint}`,
  tag: { yellow: 'Look closer', orange: 'Probably dangerous', red: 'Sentinel has proof' }[tint],
  caption: `The ${kind} mask. ${{ yellow: 'Yellow means look closer.', orange: 'Orange means it is probably dangerous.', red: 'Red means Sentinel has proof.' }[tint]}`
})));

/* -------------------------------------------------------------------- run */

function main() {
  const dir = path.join(__dirname, 'scenes');
  const out = path.join(__dirname, '..', '..', 'web', 'assets', 'img', 'galaxy');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  for (const s of SCENES) fs.writeFileSync(path.join(dir, `${s.id}.svg`), s.svg());
  if (process.argv.includes('--render')) {
    const cli = process.env.VECTORCRAFT_CLI || 'D:\\apps\\ArtCraft\\vectorcraft\\vectorcraft-0.11.0-windows-x64-portable\\vectorcraft-cli.exe';
    for (const s of SCENES) execFileSync(cli, ['convert', path.join(dir, `${s.id}.svg`), path.join(out, `${s.id}.webp`), '--scale', '2'], { stdio: 'inherit' });
  }
  // The page's list (web/index.html), scenes and masks interleaved so the colours mix on the arms.
  const all = [];
  SCENES.forEach((s, i) => { all.push({ ...s, img: `galaxy/${s.id}.webp` }); if (i % 4 === 3 && MASKS[(i - 3) / 4]) all.push(MASKS[(i - 3) / 4]); });
  const label = { scam: 'Scam', virus: 'Virus', malware: 'Malware' };
  const li = all.map((s) => `        <li><button type="button" data-img="${s.img}" data-kind="${s.kind}" data-tint="${s.tint}" data-tag="${esc(s.tag)}" data-caption="${esc(s.caption)}">${esc(s.title)}. ${label[s.kind]} mask, ${s.tint}: ${esc(s.tag)}.</button></li>`);
  process.stdout.write(li.join('\n') + '\n');
}

if (require.main === module) main();
module.exports = { SCENES, MASKS };
