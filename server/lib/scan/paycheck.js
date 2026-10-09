'use strict';
/**
 * Before you pay: a calm word at a shop's checkout when the shop's address is young, or its age is not known. Fake
 * shops take card payments and send nothing; how someone pays decides whether the money can come back.
 *
 * Only facts already at hand are used: the registration date a delicate scan looked up for this page, or one
 * Sentinel already knows (research.knownCreatedAt). Nothing is looked up for this, and the page is never opened.
 * Big brands, verified sites and the person's own sites never get it, nor does a shop registered a year ago or more.
 */
const { analyze, brandInfo } = require('./url');
const { knownCreatedAt } = require('./research');

const DAY = 24 * 60 * 60 * 1000;
const YOUNG_DAYS = 365;
// A checkout by its address: /checkout, Shopify's /checkouts/..., /cart/payment, /pay.
const CHECKOUT = /\/(checkouts?|pay)(\/|$)|\/cart\/payment(\/|$)/i;
const ADVICE = 'Pay with a credit card or PayPal, not a bank transfer, gift card or crypto, so you can get your money back.';

function isCheckout(url) {
  try { return CHECKOUT.test(new URL(url).pathname); } catch { return false; }
}

/** "today", "5 days ago", "3 weeks ago", "4 months ago". */
function ago(days) {
  if (days < 1) return 'today';
  if (days < 14) return days === 1 ? '1 day ago' : `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/**
 * @param {string} url the page in front
 * @param {object} o
 *   verdict   live scanning's verdict on the page (compact)
 *   checkout  the client saw a checkout by the page's title (the title itself never leaves the device)
 *   mine      () => boolean: the page is one of the person's own sites (mysites.js)
 * @returns {null | { young: boolean, days: number|null, text: string }}
 */
function payCheck(url, { verdict = null, checkout = false, mine = () => false, at = Date.now() } = {}) {
  if (!checkout && !isCheckout(url)) return null;
  const p = analyze(String(url));
  if (!p) return null;
  // A flagged page has its own warning, which says more.
  const badge = verdict && verdict.overall && verdict.overall.badge;
  if (badge === 'red' || badge === 'orange') return null;
  if ((verdict && verdict.knowledge && verdict.knowledge.trusted) || brandInfo(p).official || mine()) return null;
  const born = (verdict && verdict.research && verdict.research.registeredAt) || (p.isIp ? null : knownCreatedAt(p.registrable, p.host));
  if (born && at - born >= YOUNG_DAYS * DAY) return null;
  if (!born) return { young: false, days: null, text: `Sentinel does not know how old this shop's address is. ${ADVICE}` };
  const days = Math.max(0, Math.floor((at - born) / DAY));
  return { young: true, days, text: `This shop's address was registered ${ago(days)}. ${ADVICE}` };
}

module.exports = { payCheck, isCheckout, ago };
