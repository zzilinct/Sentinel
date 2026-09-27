'use strict';
/**
 * "Check links I copy": many scams never reach a browser first. They arrive in a text message (shown on the
 * computer through Phone Link), a Discord or WhatsApp chat, a PDF. When the person copies a link anywhere, Sentinel
 * checks it the quick way and speaks up only if it is dangerous.
 *
 * What it reads: the clipboard's text, every 1.5 seconds, while this is switched on (it is off until the person
 * turns it on). Only a single web link is ever acted on; any other text is left alone, never sent, never kept. The
 * log records that a copied link was checked and how it came out, never the link itself.
 */
// Loaded when the check starts, so the link rules can be tested without Electron.
const clipboard = () => require('electron').clipboard;

const EVERY_MS = 1500;
const MAX_LENGTH = 2000;

let timer = null;
let last = '';
let opts = null;

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

async function tick() {
  let text = '';
  try { text = clipboard().readText(); } catch { return; }
  if (text === last) return;
  last = text;
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

function start(options) {
  opts = options;
  stop();
  // Whatever is on the clipboard when this starts was copied before: it is not checked.
  try { last = clipboard().readText(); } catch { last = ''; }
  timer = setInterval(() => { tick().catch(() => {}); }, EVERY_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, _test: { linkIn } };
