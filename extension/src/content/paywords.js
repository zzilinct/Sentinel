/**
 * Pay pause by wording: a page whose address says nothing (a wallet's send dialog, an exchange's withdraw modal, a
 * store's gift card page under a generic path) is known by its title and, in the companion, by its visible headings,
 * buttons and form labels. Read on the device only: what leaves is the kind ('gift' or 'crypto'), never the words.
 *
 * One file for all: the server keeps the original, the desktop app gets a copy in desktop/shared (its live scanning
 * reader matches window titles with TITLE, see watch.js) and the companion one in extension/src/content
 * (scripts/build-extension.js); tests/paywords.test.js checks the copies are the same.
 *
 *   fromTitle(title)   'gift', 'crypto' or null
 *   fromWords(words)   the same for the page's short visible labels (headings, buttons, labels, placeholders); links,
 *                      footers and navigation are left out by the reader, so a "Gift cards" footer link says nothing
 *   kind({ title, words })
 */
(function (root) {
  'use strict';

  const COIN = '(crypto(currency|currencies)?|bitcoin|btc|ethereum|eth|usdt|usdc|tether|solana|litecoin|ltc|xrp|dogecoin|doge)';
  // Plain .NET-compatible sources: the Windows app's reader matches window titles with these (case-insensitive there).
  const TITLE = {
    gift: String.raw`\b(e-?)?gift ?cards?\b`,
    // A page about gift cards, not one selling them.
    notGift: String.raw`\b(scams?|fraud|never|balance|redeem|terms|lost|stolen|how to|what|why|tips|ideas|best|guide|news|faq|help)\b`,
    // "Send Bitcoin", "Withdraw your USDT", "USDT withdrawal", "Bitcoin ATMs near you", "Wallet address". Not a
    // headline where a coin and "send" are words apart ("Ethereum whales send $1B to exchanges").
    crypto: String.raw`\b(send|withdraw|transfer)\s+(your\s+)?${COIN}\b|\b${COIN}\s+(send|withdraw(al)?)\b|\b(bitcoin|crypto|btc)\s+atms?\b|\b(wallet|withdrawal|destination)\s+address\b`
  };
  const re = (s) => new RegExp(s, 'i');
  const T = { gift: re(TITLE.gift), notGift: re(TITLE.notGift), crypto: re(TITLE.crypto) };

  // One label is enough for these.
  const GIFT_SURE = [
    /\b(buy|purchase|send|order|shop( for)?|give|get)\s+(an?\s+|your\s+)?(e-?)?gift ?cards?\b/i,
    /\b(e-?)?gift ?card\s+(amount|value|denomination|design|recipient|quantity|delivery)\b/i
  ];
  const GIFT_NOT = /\b(scams?|fraud|never|balance|redeem)\b/i;
  // A gift card heading needs an amount to choose beside it.
  const AMOUNT = /^((choose|select|enter|pick)\s+)?(an?\s+|the\s+|gift\s+)?(amount|value)$|^(other|custom) amount$|^[$£€]\s?\d{1,4}(\.\d\d)?$/i;
  const CRYPTO_SURE = [T.crypto, /\bwithdraw(al)?\s+(to\s+)?(an?\s+)?(external\s+)?wallet\b/i];
  // Or all three: a send button, a field to send to, and a coin named somewhere.
  const ACT = /^(send|send now|withdraw(al)?|withdraw now|transfer|confirm (send|withdrawal))$/i;
  const FIELD = /^(to|address|recipient|recipient('?s)? address|network|select network|memo|amount)$/i;
  const NOUN = new RegExp(String.raw`\b(${COIN}|wallet|blockchain)\b`, 'i');

  function fromTitle(title) {
    const t = String(title || '').slice(0, 300);
    if (!t) return null;
    if (T.crypto.test(t)) return 'crypto';
    if (T.gift.test(t) && !T.notGift.test(t)) return 'gift';
    return null;
  }

  function fromWords(words) {
    const list = (Array.isArray(words) ? words : []).slice(0, 400).map((w) => String(w || '').replace(/\s+/g, ' ').trim()).filter((w) => w && w.length <= 80);
    if (list.some((w) => CRYPTO_SURE.some((r) => r.test(w)))) return 'crypto';
    if (list.some((w) => ACT.test(w)) && list.some((w) => FIELD.test(w)) && list.some((w) => NOUN.test(w))) return 'crypto';
    const gifts = list.filter((w) => !GIFT_NOT.test(w));
    if (gifts.some((w) => GIFT_SURE.some((r) => r.test(w)))) return 'gift';
    if (gifts.some((w) => T.gift.test(w)) && list.some((w) => AMOUNT.test(w))) return 'gift';
    return null;
  }

  const kind = ({ title, words } = {}) => fromTitle(title) || fromWords(words);

  const api = { fromTitle, fromWords, kind, TITLE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SentinelPayWords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
