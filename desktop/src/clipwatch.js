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
 * "Stop pasted commands" (the ClickFix shield) shares the same look at the clipboard: while a browser is open, a
 * command copied from it that a fake "I am not a robot" page would want pasted into Windows (see
 * server/lib/scan/clickfix.js) is swapped for a harmless line, and the person can put it back in one click. The
 * command is judged here, on the computer: it is never sent, logged or kept, except in memory for that one click.
 */
// Loaded when the check starts, so the link rules can be tested without Electron. Electron's clipboard answers with a
// promise (it did not always): every read and write is awaited.
const clipboard = () => require('electron').clipboard;
const clickfix = require('../shared/clickfix');

const EVERY_MS = 1500;
// The shield looks more often: from "copied" to "pasted into the Run box" is a few seconds.
const SHIELD_EVERY_MS = 500;
const MAX_LENGTH = 2000;
const PUT_BACK_MS = 2 * 60 * 1000;

let timer = null;
let last = '';
let opts = null;
let held = null;              // { text, until }: the command taken off the clipboard, for "put it back"
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

/** A command a page wanted pasted into Windows: stopped (taken off the clipboard) or told about. True when it was one. */
async function shield(text) {
  if (!opts.commands() || allowed.has(text)) return false;
  const found = clickfix.classify(text);
  if (!found) return false;
  const page = (opts.page && opts.page()) || {};
  const action = clickfix.decide(found, page.badge);
  if (action === 'stop') {
    try { await clipboard().writeText(stoppedLine(page.host)); } catch { return true; }
    last = stoppedLine(page.host);
    held = { text, until: Date.now() + PUT_BACK_MS };
  }
  if (opts.log) opts.log(`copied command ${action === 'stop' ? 'stopped' : 'flagged'}: ${found.reason}`);
  if (opts.onCommand) opts.onCommand({ action, reason: found.reason, host: page.host || null });
  return true;
}

/** "Put it back": the command returns to the clipboard, and is left alone from now on. */
async function putBack() {
  if (!held || Date.now() > held.until) { held = null; return false; }
  allowed.add(held.text);
  try { await clipboard().writeText(held.text); } catch { return false; }
  last = held.text;
  held = null;
  return true;
}

async function tick() {
  const links = opts.links();
  // The shield alone reads nothing while no browser is open: a command only comes from a page.
  if (!links && !opts.browserOpen()) return;
  let text = '';
  try { text = String(await clipboard().readText()); } catch { return; }
  if (text === last) return;
  last = text;
  if (held && Date.now() > held.until) held = null;
  if (opts.browserOpen() && await shield(text)) return;
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
 * browserOpen(), page() (the page in front: { host, badge }), onDanger (a dangerous link), onCommand (a command).
 */
function start(options) {
  opts = options;
  stop();
  // Whatever is on the clipboard when this starts was copied before: it is not checked.
  last = null;
  Promise.resolve().then(() => clipboard().readText()).then((t) => { if (last === null) last = String(t); }, () => { if (last === null) last = ''; });
  timer = setInterval(() => { if (last !== null) tick().catch(() => {}); }, opts.commands() ? SHIELD_EVERY_MS : EVERY_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, putBack, _test: { linkIn, stoppedLine } };
