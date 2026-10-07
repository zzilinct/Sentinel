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
 */
// Loaded when the check starts, so the link rules can be tested without Electron. Electron's clipboard answers with a
// promise (it did not always): every read and write is awaited.
const clipboard = () => require('electron').clipboard;
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
  every = browser ? SHIELD_EVERY_MS : EVERY_MS;
  // The shield alone reads nothing while no browser is open: a command only comes from a page.
  if (!links && !shieldOn) return;
  let text = '';
  reads++;
  try { text = String(await clipboard().readText()); } catch { return; }
  if (text === last) return;
  last = text;
  if (held && Date.now() > held.until) held = null;
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
 * Started (or restarted) whenever either switch changes. options: api, log, links() and commands() (the two switches),
 * browserOpen(), browserInFront() (the browser in front, null for another program, undefined when not known),
 * page() (the page in front: { host, badge }), onDanger (a dangerous link), onCommand (a command).
 */
function start(options) {
  opts = options;
  stop();
  // Whatever is on the clipboard when this starts was copied before: it is not checked.
  last = null;
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
  if (timer) clearTimeout(timer);
  timer = null;
}

/** How often the clipboard is looked at now, and how many times it was read: for the end-to-end check. */
const status = () => ({ every, reads, running: Boolean(timer) });

module.exports = { start, stop, putBack, heldCommand, status, _test: { linkIn, stoppedLine, tick } };
