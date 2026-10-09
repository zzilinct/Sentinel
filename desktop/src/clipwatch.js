'use strict';
/**
 * "Check links I copy": many scams never reach a browser first. They arrive in a text message (shown on the
 * computer through Phone Link), a Discord or WhatsApp chat, a PDF. When the person copies a link anywhere, Sentinel
 * checks it the quick way and speaks up only if it is dangerous.
 *
 * What it reads: the clipboard's text, every 1.5 seconds, while this is switched on (it is off until the person
 * turns it on). Only a single web link is ever acted on; any other text is left alone, never sent, never kept. The
 * log records that a copied link was checked and how it came out, never the link itself.
 *
 * "Stop pasted commands" (the ClickFix shield) shares the same look at the clipboard, while a browser is open: a
 * command copied while a browser was in front that a fake "I am not a robot" page would want pasted into Windows
 * (see server/lib/scan/clickfix.js) is swapped for a harmless line, and the person can put it back in one click.
 * The same command copied in another program is only told about. The clipboard is read every half second while a
 * browser is in front, every 1.5 seconds otherwise. The command is judged here, on the computer: it is never sent,
 * logged or kept, except in memory for two minutes, for "Put it back".
 *
 * "Wallet guard" shares it too: clipboard hijackers wait for a copied crypto address (or an IBAN) and put their own
 * in its place. When a copied address turns into a different one of the same kind within a few seconds, and no key
 * or mouse button was touched since (so the person did not copy again), Sentinel puts theirs back and tells them.
 * Addresses are compared in memory only: never sent, logged or kept beyond the last one copied.
 */
// Loaded when the check starts, so the link rules can be tested without Electron. Electron's clipboard answers with a
// promise (it did not always): every read and write is awaited.
const clipboard = () => require('electron').clipboard;
const crypto = require('crypto');
const clickfix = require('../shared/clickfix');

const EVERY_MS = 1500;
// The shield looks more often while a browser is in front: from "copied" to "pasted into the Run box" is a few seconds.
const SHIELD_EVERY_MS = 500;
// Windows + R takes the front from the browser: a copy noticed this soon after the browser left still came from it.
const LEFT_MS = 2000;
const MAX_LENGTH = 2000;
const PUT_BACK_MS = 2 * 60 * 1000;

let timer = null;
let last = '';
let opts = null;
let held = null;              // { text, line, host, reason, at, until }: the command taken off the clipboard
let browserAt = 0;            // when a browser was last seen in front
let every = EVERY_MS;
let reads = 0;
const allowed = new Set();    // commands the person put back: not stopped again while Sentinel runs
let wallet = null;            // { kind, text, at, restores }: the address last copied, in memory only

// A swap comes within seconds of the copy. Read on the timer, the clipboard is read every half second for this long
// after an address. Heard as it changes, the same window applies: a clipper that waits a couple of seconds is caught
// too, and the person's own second copy is told apart by their key or mouse use in between, not by the time.
const WALLET_MS = 10 * 1000;
const LISTEN_MS = WALLET_MS;
// Keys and mouse used this long after the address was seen mean the person copied again (the copy's own key-up is earlier).
const TOUCH_MS = 300;
// A hijacker swaps again each time the clipboard changes: Sentinel puts the address back this many times, then stops.
const MAX_RESTORES = 3;
// Clipboards shared on purpose: a remote desktop session's.
const SHARED_CLIPBOARD = new Set(['rdpclip']);

/** What goes on the clipboard instead. Pasted into the Run box it is only words Windows cannot find. */
const stoppedLine = (host) => `Sentinel stopped a command copied from ${host || 'a web page'}. It could have taken over this computer.`;

/** A single web address and nothing else ("https://x.y/z", or "x.y/z" as people often copy them), or null. */
function linkIn(text) {
  const t = String(text || '').trim();
  if (!t || t.length > MAX_LENGTH || /\s/.test(t)) return null;
  // A bare "name.ending" counts only when the ending is not a file type: a copied file name ("report.pdf") is not a link.
  const bare = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.([a-z]{2,24})(\/\S*)?$/i.exec(t);
  const fileLike = bare && !bare[3] && /^(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|png|jpe?g|gif|bmp|webp|svg|mp[34]|mov|avi|wav|zip|rar|7z|exe|msi|dll|bat|cmd|ps1|js|json|md|log|ini|cfg|iso|lnk)$/i.test(bare[2]);
  const candidate = /^https?:\/\//i.test(t) ? t : (bare && !fileLike ? `https://${t}` : null);
  if (!candidate) return null;
  try {
    const u = new URL(candidate);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const hex = n ? n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0') : '';
  return Buffer.concat([Buffer.alloc(/^1*/.exec(s)[0].length), Buffer.from(hex, 'hex')]);
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
/** Base58Check (Bitcoin, Litecoin, Tron): the payload when the checksum holds, else null. */
function base58check(s) {
  const b = base58(s);
  if (!b || b.length < 5) return null;
  const body = b.subarray(0, -4);
  return sha256(sha256(body)).subarray(0, 4).equals(b.subarray(-4)) ? body : null;
}
/** An IBAN's check digits hold (ISO 13616, mod 97). */
function ibanOk(t) {
  let rem = 0;
  for (const c of t.slice(4) + t.slice(0, 4)) for (const d of String(parseInt(c, 36))) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

/**
 * The kind of wallet address the clipboard holds, alone: 'btc', 'ltc', 'evm' (Ethereum and the chains that share its
 * addresses), 'trx', 'sol', 'xmr' or 'iban'. null for anything else.
 */
function walletIn(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 120) return null;
  if (/^0x[0-9a-f]{40}$/i.test(t)) return 'evm';
  // ponytail: bech32 is matched by shape, not checksum; base58 ones are checksummed, so a Solana key is never taken for Bitcoin.
  if (/^bc1[02-9ac-hj-np-z]{11,71}$/i.test(t)) return 'btc';
  if (/^ltc1[02-9ac-hj-np-z]{11,71}$/i.test(t)) return 'ltc';
  if (/^[48][1-9A-HJ-NP-Za-km-z]{94}([1-9A-HJ-NP-Za-km-z]{11})?$/.test(t)) return 'xmr';
  if (/^[1-9A-HJ-NP-Za-km-z]{25,44}$/.test(t)) {
    const body = base58check(t);
    if (body && body.length === 21) return { 0x00: 'btc', 0x05: 'btc', 0x30: 'ltc', 0x32: 'ltc', 0x41: 'trx' }[body[0]] || null;
    if (t.length >= 32 && base58(t).length === 32) return 'sol';
    return null;
  }
  const iban = t.replace(/ /g, '').toUpperCase();
  if (/^[A-Z]{2}\d{2}( ?[A-Z0-9]{1,4})+$/i.test(t) && /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) && ibanOk(iban)) return 'iban';
  return null;
}

/**
 * A swap: `now` (an address of some kind at time `at`, with a key or the mouse last used at `inputAt`, written by
 * `owner`) replaced `before`, of the same kind, within `windowMs`, with nothing touched since `before` was seen.
 */
function isSwap(before, now, windowMs) {
  return Boolean(before && now.kind && before.kind === now.kind && before.text !== now.text && now.at - before.at <= windowMs &&
    now.inputAt <= before.at + TOUCH_MS && before.restores < MAX_RESTORES && !SHARED_CLIPBOARD.has(now.owner));
}

/**
 * The clipboard now holds `now` ({ kind, text, at, inputAt, owner }). When it swapped out the address just copied,
 * that address goes back. True when it did (or tried). `at` and `inputAt` are on one clock, whichever the caller has.
 */
async function judge(now, windowMs) {
  const before = wallet;
  // The same address again (or Sentinel's own write putting it back): still the one to guard, from now.
  if (before && now.text === before.text) { wallet = { ...before, at: now.at }; return false; }
  wallet = now.kind ? { kind: now.kind, text: now.text, at: now.at, restores: 0 } : null;
  if (!isSwap(before, now, windowMs)) return false;
  // Set before writing: the echo of Sentinel's own write must not look like a swap.
  wallet = { ...before, at: now.at, restores: before.restores + 1 };
  last = before.text;
  let putBack = true;
  try { await clipboard().writeText(before.text); } catch { putBack = false; }
  const program = now.owner && now.owner !== 'electron' && now.owner !== 'sentinel' ? now.owner : null;
  if (opts.log) opts.log(`wallet address swap caught (${now.kind})${program ? `, written by ${program}` : ''}${putBack ? '' : ', could not put it back'}`);
  if (opts.onWallet && before.restores === 0) opts.onWallet({ kind: now.kind, program, putBack });
  return true;
}

/** A clipboard change heard the moment it happened (browsers.js): { tick, idle, owner, text }, text only for an address. */
function heard(e) {
  if (!opts || !opts.wallets || !opts.wallets()) return;
  const text = String(e.text || '');
  judge({ kind: walletIn(text), text, at: e.tick, inputAt: e.tick - e.idle, owner: e.owner }, LISTEN_MS).catch(() => {});
}

/**
 * The fallback, while changes are not heard as they happen: the clipboard, read on the timer, holds `text`. Who wrote
 * it and when a key was last used are asked only when it could be a swap; not known, nothing is touched.
 */
async function guardWallet(text) {
  const kind = walletIn(text);
  if (kind) every = SHIELD_EVERY_MS;
  const at = Date.now();
  const now = { kind, text, at, inputAt: Infinity, owner: null };
  const before = wallet;
  if (kind && before && before.kind === kind && before.text !== text && at - before.at <= WALLET_MS) {
    const who = opts.clipOwner ? await opts.clipOwner().catch(() => null) : null;
    if (who && Number.isFinite(who.idle)) { now.inputAt = Date.now() - who.idle; now.owner = who.owner; }
  }
  return judge(now, WALLET_MS);
}

/**
 * Was the text just read copied in a browser? Yes while one is in front, or left the front a moment ago. When which
 * window is in front is not known (the helper that says is not running), any open browser counts, as before.
 */
function fromBrowser() {
  const front = opts.browserInFront ? opts.browserInFront() : undefined;
  if (front === undefined) return opts.browserOpen();
  if (front) browserAt = Date.now();
  return Date.now() - browserAt < LEFT_MS;
}

/** A command a page wanted pasted into Windows: stopped (taken off the clipboard) or told about. True when it was one. */
async function shield(text, browser) {
  if (!opts.commands() || allowed.has(text)) return false;
  const found = clickfix.classify(text);
  if (!found) return false;
  // Only a copy made in a browser is stopped, and only then is the page in front named. One from a terminal, an
  // editor or a password manager is the person's own: they are told, and the clipboard is left alone.
  const page = (browser && opts.page && opts.page()) || {};
  const action = browser ? clickfix.decide(found, page.badge) : 'tell';
  if (action === 'stop') {
    const line = stoppedLine(page.host);
    try { await clipboard().writeText(line); } catch { return true; }
    last = line;
    held = { text, line, host: page.host || null, reason: found.reason, at: Date.now(), until: Date.now() + PUT_BACK_MS };
  }
  if (opts.log) opts.log(`copied command ${action === 'stop' ? 'stopped' : 'flagged'}${browser ? '' : ' (copied in a program)'}: ${found.reason}`);
  if (opts.onCommand) opts.onCommand({ action, reason: found.reason, host: page.host || null, from: browser ? 'browser' : 'program' });
  return true;
}

/**
 * "Put it back": the command returns to the clipboard, and is left alone from now on. Answers { ok, why }: why is
 * 'gone' (more than two minutes, or nothing was stopped), 'newer' (something else was copied since, which is not
 * overwritten) or 'failed' (Windows did not let Sentinel write the clipboard). In the last two the command is still
 * left alone if the person copies it again.
 */
async function putBack() {
  if (!held || Date.now() > held.until) { held = null; return { ok: false, why: 'gone' }; }
  const h = held;
  held = null;
  allowed.add(h.text);
  let now = null;
  try { now = String(await clipboard().readText()); } catch { /* not readable: written anyway */ }
  if (now !== null && now !== h.line) return { ok: false, why: 'newer' };
  try { await clipboard().writeText(h.text); } catch { return { ok: false, why: 'failed' }; }
  last = h.text;
  return { ok: true };
}

/** The command held for "Put it back", without its text: { host, reason, at, until }, or null. */
function heldCommand() {
  if (held && Date.now() > held.until) held = null;
  return held ? { host: held.host, reason: held.reason, at: held.at, until: held.until } : null;
}

async function tick() {
  const links = opts.links();
  const shieldOn = opts.commands() && opts.browserOpen();
  const browser = shieldOn && fromBrowser();
  // While clipboard changes are heard as they happen, the timer has nothing to do for wallet guard.
  const wallets = Boolean(opts.wallets && opts.wallets()) && !(opts.listening && opts.listening());
  every = browser || (wallets && wallet && Date.now() - wallet.at < WALLET_MS) ? SHIELD_EVERY_MS : EVERY_MS;
  // The shield alone reads nothing while no browser is open: a command only comes from a page.
  if (!links && !shieldOn && !wallets) return;
  let text = '';
  reads++;
  try { text = String(await clipboard().readText()); } catch { return; }
  if (text === last) return;
  last = text;
  if (held && Date.now() > held.until) held = null;
  if (wallets && await guardWallet(text)) return;
  if (shieldOn && await shield(text, browser)) return;
  if (!links) return;
  const url = linkIn(text);
  if (!url) return;
  try {
    const { byUrl } = await opts.api('/api/v1/live/batch', { urls: [url], private: false, mode: 'fast' });
    const v = byUrl && byUrl[url];
    const badge = v && v.overall ? v.overall.badge : null;
    if (opts.log) opts.log(`copied link checked: ${badge || 'clear'}`);
    if (v && (badge === 'red' || badge === 'orange')) opts.onDanger({ url, host: v.host, badge, label: v.overall.label, reason: (v.reasons && v.reasons[0] && v.reasons[0].text) || '' });
  } catch (err) {
    if (opts.log && err && err.status !== 401) opts.log(`copied link could not be checked: ${err.status || ''} ${err.code || err.message}`);
  }
}

/**
 * Started (or restarted) whenever a switch changes. options: api, log, links(), commands() and wallets() (the three
 * switches), clipOwner() (who wrote the clipboard, and ms since the last key or mouse use: { owner, idle }), listen(handler)
 * and listening() (clipboard changes heard as they happen, from the running-browsers helper), browserOpen(), browserInFront() (the browser in front, null for another program, undefined when not known),
 * page() (the page in front: { host, badge }), onDanger (a dangerous link), onCommand (a command), onWallet (a swap).
 */
function start(options) {
  opts = options;
  stop();
  // Whatever is on the clipboard when this starts was copied before: it is not checked.
  last = null;
  wallet = null;
  if (opts.listen) opts.listen(opts.wallets && opts.wallets() ? heard : null);
  Promise.resolve().then(() => clipboard().readText()).then((t) => { if (last === null) last = String(t); }, () => { if (last === null) last = ''; });
  const loop = async () => {
    if (last !== null) await tick().catch(() => {});
    if (opts !== options || !timer) return;
    timer = setTimeout(loop, every);
    timer.unref();
  };
  timer = setTimeout(loop, every);
  timer.unref();
}

function stop() {
  if (opts && opts.listen) opts.listen(null);
  if (timer) clearTimeout(timer);
  timer = null;
}

/** How often the clipboard is looked at now, and how many times it was read: for the end-to-end check. */
const status = () => ({ every, reads, running: Boolean(timer), hearing: Boolean(opts && opts.listening && opts.listening()) });

module.exports = { start, stop, putBack, heldCommand, status, _test: { linkIn, stoppedLine, tick, walletIn, heard } };
