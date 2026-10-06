'use strict';
/**
 * What a QR code does, from the text it holds. The picture is read on the person's own device (web/assets/js/qr.js);
 * only that text arrives here, and it is judged, never kept.
 *
 * Most codes are links, and a link goes through the ordinary link scan. Some are not links at all and do something
 * the moment a phone app reads them, which no link scan would catch:
 *   - sign-in codes (Discord, WhatsApp, Telegram, Steam, Signal): scanning one with your phone signs whoever made it
 *     into your account. "Scan this to verify" in a chat or an email is how accounts are taken;
 *   - WalletConnect codes, which connect a crypto wallet to a site that can then ask to move what is in it;
 *   - crypto payment codes, which cannot be undone;
 *   - two-step sign-in secrets (otpauth), which are only ever yours to scan, never to share.
 * Wi-Fi, email, phone and text-message codes are explained in words. Nothing here opens or fetches anything.
 */
const { analyze } = require('./url');

const MAX = 4096;

// Sign-in codes: a phone app that is already signed in approves whoever is showing the code.
const SIGN_IN = [
  { app: 'Discord', site: 'discord.com', test: (t, u) => u && /^(www\.|ptb\.|canary\.)?discord(app)?\.com$/.test(u.host) && /^\/ra\/[\w-]+/.test(u.path) },
  { app: 'Steam', site: 'steampowered.com', test: (t, u) => u && u.host === 's.team' && /^\/q\/\d+\/\d+/.test(u.path) },
  { app: 'Telegram', site: 'web.telegram.org', test: (t) => /^tg:\/\/login\?token=/i.test(t) },
  { app: 'Signal', site: 'Signal Desktop', test: (t) => /^(sgnl:\/\/linkdevice\?|tsdevice:\/?\?)/i.test(t) },
  // WhatsApp's "link a device" code: a reference and keys, separated by commas, starting with a digit and "@".
  { app: 'WhatsApp', site: 'web.whatsapp.com', test: (t) => /^\d@[\w+/=-]{8,},[\w+/=-]{8,},/.test(t) }
];

const COINS = { bitcoin: 'bitcoin', ethereum: 'ether', litecoin: 'litecoin', bitcoincash: 'bitcoin cash', dogecoin: 'dogecoin', monero: 'monero', solana: 'solana', tron: 'tron', ripple: 'XRP', xrp: 'XRP', usdt: 'USDT' };

const clip = (s, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** The text as a web address, when it is one ("https://…", "www.…", or a bare "name.ending/path"). */
function asLink(t) {
  if (/\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return analyze(t);
  if (/^www\./i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}(\/\S*)?$/i.test(t)) return analyze(`https://${t}`);
  return null;
}

/**
 * @param {string} text  what the code holds
 * @returns {{kind: string, title: string, detail: string, tone: ('red'|'orange'|'yellow'|null), steps: string[],
 *            url?: string, host?: string, app?: string}}
 */
function classify(text) {
  const t = String(text == null ? '' : text).trim().slice(0, MAX);
  if (!t) return { kind: 'empty', title: 'An empty QR code', detail: 'The code holds no text.', tone: null, steps: [] };
  const link = asLink(t);

  const signIn = SIGN_IN.find((s) => s.test(t, link));
  if (signIn) {
    return {
      kind: 'signin', app: signIn.app, tone: 'red',
      title: `A ${signIn.app} sign-in code`,
      detail: `Scanning this with the ${signIn.app} app on a phone signs whoever made the code into that ${signIn.app} account. It is only safe when your own computer is showing it to you on ${signIn.site}.`,
      steps: [
        `If someone sent you this code, or asked you to scan it to "verify", claim a prize or join something, do not scan it: that is how ${signIn.app} accounts are taken.`,
        `Already scanned it? In ${signIn.app}, open the list of devices that are signed in, sign out the ones you do not know, and change your password.`
      ]
    };
  }

  if (/^wc:[0-9a-f-]{8,}@\d/i.test(t)) {
    return {
      kind: 'wallet', tone: 'orange',
      title: 'A crypto wallet connection',
      detail: 'This is a WalletConnect code. Scanning it connects your crypto wallet to a website, and that site can then ask your wallet to sign or send. Fake airdrops and "claim your tokens" pages use these to empty wallets.',
      steps: [
        'Only scan a code like this on a site you opened yourself, at an address you know.',
        'Read every request your wallet shows before approving it. Never approve one you did not expect.'
      ]
    };
  }

  const coin = /^([a-z]+):([^?]+)(\?.*)?$/i.exec(t);
  if (coin && COINS[coin[1].toLowerCase()]) {
    const params = new URLSearchParams(coin[3] ? coin[3].slice(1) : '');
    const amount = params.get('amount') || params.get('value') || '';
    const name = COINS[coin[1].toLowerCase()];
    return {
      kind: 'payment', tone: 'yellow',
      title: 'A cryptocurrency payment',
      detail: `It asks a wallet app to send ${amount ? `${clip(amount, 30)} ` : ''}${name} to ${clip(coin[2], 80)}. A crypto payment cannot be undone or refunded.`,
      steps: [
        'Only pay if you know whose address this is and why you owe them.',
        'A bank, a government office, a delivery company or tech support never asks to be paid in cryptocurrency.'
      ]
    };
  }

  if (/^otpauth:\/\//i.test(t)) {
    let issuer = '';
    let account = '';
    try {
      const u = new URL(t);
      const label = decode(u.pathname.replace(/^\/+/, ''));
      issuer = u.searchParams.get('issuer') || (label.includes(':') ? label.split(':')[0] : '');
      account = label.includes(':') ? label.split(':').slice(1).join(':') : label;
    } catch { /* an unreadable label: described without it */ }
    const who = issuer ? clip(issuer.trim(), 60) : 'a site';
    return {
      kind: 'otp', tone: 'yellow',
      title: 'A two-step sign-in secret',
      detail: `This adds sign-in codes for ${who}${account ? ` (${clip(account.trim(), 60)})` : ''} to an authenticator app.`,
      steps: [
        `Only scan it while you are turning on two-step sign-in on ${who === 'a site' ? 'that site' : who}'s own website yourself.`,
        'Never send a picture of a code like this to anyone: whoever has it can make your sign-in codes.'
      ]
    };
  }

  if (/^WIFI:/i.test(t)) {
    const ssid = /(?:^WIFI:|;)S:((?:\\.|[^;])*)/i.exec(t);
    const name = ssid ? ssid[1].replace(/\\(.)/g, '$1') : '';
    return {
      kind: 'wifi', tone: null,
      title: 'A Wi-Fi network',
      detail: `It joins the Wi-Fi network ${name ? `"${clip(name, 60)}"` : 'it names'}. It does not open a website.`,
      steps: []
    };
  }

  if (/^mailto:/i.test(t)) {
    const to = clip(decode(t.slice(7).split('?')[0]), 120);
    return { kind: 'email', tone: null, title: 'An email to write', detail: `It starts an email to ${to || 'an address'}.`, steps: [] };
  }
  if (/^(tel|sms|smsto):/i.test(t)) {
    const number = clip(decode(t.replace(/^(tel|sms|smsto):/i, '').split(/[?:]/)[0]), 40);
    const sms = /^sms/i.test(t);
    return {
      kind: sms ? 'sms' : 'phone', tone: null,
      title: sms ? 'A text message to send' : 'A phone number to call',
      detail: sms ? `It starts a text message to ${number}.` : `It calls ${number}.`,
      steps: ['If the code came on a letter, a sticker or an email about a payment or a problem with your account, look the number up on the company’s own website instead.']
    };
  }

  if (link) {
    return { kind: 'url', tone: null, title: 'A link', detail: `It leads to ${link.host}. Sentinel checks it like any link.`, url: link.url, host: link.host, steps: [] };
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !/^(https?|ftp|file):/i.test(t)) {
    return { kind: 'app', tone: null, title: 'A link for an app', detail: `It opens an app on the phone that reads it (${clip(t.split(':')[0], 30)}), not a website.`, steps: [] };
  }

  return { kind: 'text', tone: null, title: 'Text', detail: `It holds text, not a link: "${clip(t, 160)}"`, steps: [] };
}

module.exports = { classify };
