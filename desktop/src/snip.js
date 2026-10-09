'use strict';
/**
 * Check something on screen: a shortcut (or the tray) lets the person draw a box around anything on screen, a pop-up,
 * an ad, a message in any app, a QR code, a phone number, and Sentinel says what it is.
 *
 * The screen is copied once, in memory, when the shortcut is pressed (before Sentinel's own window shows), and only
 * the box the person draws is read: its words by the text recogniser built into Windows (ocr.js), a QR code in it by
 * Sentinel's own reader (web/assets/js/qr.js). The words are judged here, on this computer, by the rules for texts
 * (server/lib/scan/texts.js) and chat (server/lib/scan/chat.js, for phone numbers). Only the links found are sent,
 * to this computer's own scanner, for the fast private check copied links get. The picture and the words are never
 * kept, sent or logged.
 *
 * The window is a transparent sheet over one screen with a crosshair, made when asked for and closed after: it never
 * shows over a game by itself. Escape closes it at any point.
 */
const path = require('path');
const texts = require('../shared/texts');
const { SIGNS } = require('../shared/chat');
const { classify } = require('../shared/qr');

// The shortcut, and the ones it can be changed to. Ctrl+Shift+S is "Save as" in Office, Photoshop and most editors,
// and Firefox's screenshot: a global shortcut takes it from all of them, so it is offered, not the default.
const KEYS = {
  'Super+Alt+S': 'Windows key + Alt + S',
  'Control+Alt+Shift+S': 'Ctrl + Alt + Shift + S',
  'Control+Shift+S': 'Ctrl + Shift + S (replaces "Save as" in many programs)'
};
const DEFAULT_KEY = 'Super+Alt+S';

const NUMBER = SIGNS.find((s) => s.id === 'number').re;
const SCAM_NUMBER = SIGNS.find((s) => s.id === 'scamnum').re;
const PHONE_WORDS = /\b(call|text|txt|number|phone|cell|whats ?app|dial|ring|helpline|hotline|support)\b/i;
const FOUND = 'What Sentinel found in it:';
const RANK = { danger: 3, warn: 2, info: 1, safe: 0, pending: 1 };

/** The phone numbers in some words, as written. A run of bare digits is a number only next to phone words (as in chat). */
function phoneNumbers(text) {
  const out = [];
  const re = new RegExp(NUMBER.source, 'g');
  let m;
  while ((m = re.exec(text)) && out.length < 3) {
    const n = m[0].trim();
    if (/^\d+$/.test(n) && !PHONE_WORDS.test(text)) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** One link's finding, from its check (what /api/v1/live/batch returned for it), or that it is still being checked. */
function linkFinding(url, from, v, why) {
  const where = from === 'qr' ? 'The QR code leads to' : 'A link to';
  let host = url;
  try { host = new URL(url).hostname; } catch { /* shown as written */ }
  if (why) return { level: 'info', kind: 'link', title: `${where} ${host}`, detail: `Not checked: ${why}.` };
  if (!v) return { level: 'pending', kind: 'link', title: `${where} ${host}`, detail: 'Checking it...' };
  if (!v.ok) return { level: 'info', kind: 'link', title: `${where} ${host}`, detail: 'Sentinel could not check this link.' };
  const badge = v.overall && v.overall.badge;
  const reason = (v.reasons && v.reasons[0] && v.reasons[0].text) || (v.overall && v.overall.label) || '';
  if (badge === 'red') return { level: 'danger', kind: 'link', title: `${where} a dangerous site: ${v.host || host}`, detail: reason || 'Flagged by Sentinel.' };
  if (badge === 'orange') return { level: 'warn', kind: 'link', title: `${where} a risky site: ${v.host || host}`, detail: reason || 'Flagged by Sentinel.' };
  if (badge === 'yellow') return { level: 'info', kind: 'link', title: `${where} ${v.host || host}`, detail: reason || 'Nothing clear either way.' };
  return { level: 'safe', kind: 'link', title: `${where} ${v.host || host}`, detail: 'Sentinel found nothing wrong with this link.' };
}

/**
 * What was read in the box, judged. `text`: the words the recogniser read; `codes`: the text of each QR code found;
 * `verdicts`: link checks so far, by address; `why`: why the links could not be checked, when they could not.
 * @returns {{ level: 'danger'|'warn'|'safe'|'empty', title: string, detail: string, advice: string|null,
 *            findings: { level: string, kind: string, title: string, detail: string }[], links: string[], pending: boolean }}
 */
function judge(text, codes = [], verdicts = {}, why = null) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  codes = (codes || []).filter(Boolean).slice(0, 3);
  if (!t && !codes.length) {
    return { level: 'empty', title: 'Nothing to read here', detail: 'Sentinel found no words or QR code in that box. Try drawing a larger one.', advice: null, findings: [], links: [], pending: false };
  }
  const r = texts.judgeText({ text: t });
  const from = new Map(r.links.map((u) => [u, 'text']));
  const findings = [];

  // The message itself. A warning from its wording is lowered only when every link in it is the real site (texts.js);
  // a dangerous link is its own finding below.
  const calm = {};
  for (const u of r.links) {
    const v = verdicts[u];
    if (v && v.overall && v.overall.badge !== 'red' && v.overall.badge !== 'orange') calm[u] = v;
  }
  const said = r.flag ? texts.withLinks(r, calm) : null;
  if (said) findings.push({ level: said.level, kind: 'message', title: said.title.replace(/^This text/, 'This message'), detail: said.detail, advice: said.advice });

  for (const code of codes) {
    const q = classify(code);
    if (q.kind === 'url' && q.url) { if (!from.has(q.url)) from.set(q.url, 'qr'); continue; }
    findings.push({ level: q.tone === 'red' ? 'danger' : q.tone === 'orange' ? 'warn' : 'info', kind: 'qr', title: q.title, detail: q.detail, advice: q.steps[0] || null });
  }

  const links = [...from.keys()].slice(0, 10);
  for (const u of links) findings.push(linkFinding(u, from.get(u), verdicts[u], why));

  const scamLike = findings.some((f) => f.level === 'danger' || f.level === 'warn');
  for (const n of phoneNumbers(t)) {
    if (SCAM_NUMBER.test(n)) {
      findings.push({ level: 'danger', kind: 'phone', title: `A number to call back: ${n}`, detail: 'Its area code is one consumer agencies name for callback scams: calling it can cost money by the minute.', advice: 'Do not call or text this number.' });
    } else if (scamLike) {
      findings.push({ level: 'warn', kind: 'phone', title: `A phone number: ${n}`, detail: 'It is in something that looks like a scam: whoever answers is likely part of it.', advice: 'Do not call it. Look the company up on its own website and call the number there.' });
    } else {
      findings.push({ level: 'info', kind: 'phone', title: `A phone number: ${n}`, detail: 'Sentinel cannot tell who answers it. If it says it is a company, check the number on the company\'s own website.' });
    }
  }

  findings.sort((a, b) => RANK[b.level] - RANK[a.level]);
  const top = findings[0];
  const pending = findings.some((f) => f.level === 'pending');
  const worst = top && (top.level === 'danger' || top.level === 'warn') ? top.level : 'safe';
  const advice = (findings.find((f) => f.advice && (f.level === 'danger' || f.level === 'warn')) || {}).advice || null;
  if (worst === 'danger') return { level: 'danger', title: 'This looks like a scam', detail: FOUND, advice, findings, links, pending };
  if (worst === 'warn') return { level: 'warn', title: 'Be careful with this', detail: FOUND, advice, findings, links, pending };
  return {
    level: 'safe', title: pending ? 'Checking...' : 'Nothing dangerous found',
    detail: pending ? 'Sentinel is checking the links it found.' : 'Sentinel found no sign of a scam here. If something asks for money, a code or your password, check with the person or company another way first.',
    advice: null, findings, links, pending
  };
}

/** The picture as RGBA pixels for the QR reader (Electron gives BGRA on Windows). */
function rgba(image) {
  const { width, height } = image.getSize();
  const data = Buffer.from(image.toBitmap());
  if (process.platform === 'win32') for (let i = 0; i < data.length; i += 4) { const b = data[i]; data[i] = data[i + 2]; data[i + 2] = b; }
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height };
}

/* ------------------------------------------------------------ the window */

let win = null;
let shot = null;        // { image, scale }: the screen as it was when asked, until the box is drawn
let opts = null;
let opening = false;

function send(state) { if (win && !win.isDestroyed()) win.webContents.send('snip:state', state); }

function close() {
  const { globalShortcut } = require('electron');
  shot = null;
  try { globalShortcut.unregister('Escape'); } catch { /* not ours */ }
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

/** The sheet, over the screen the pointer is on. `delay`: let a closing menu (the tray's) leave the screen first. */
async function open(delay = 0) {
  if (win || opening) { if (win) win.focus(); return; }
  opening = true;
  try {
    const { BrowserWindow, desktopCapturer, screen, globalShortcut } = require('electron');
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { width, height } = display.size;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * display.scaleFactor), height: Math.round(height * display.scaleFactor) } });
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error('the screen could not be copied');
    shot = { image: source.thumbnail, scale: source.thumbnail.getSize().width / width };
    win = new BrowserWindow({
      ...display.bounds, show: false, title: 'Sentinel: check something on screen', frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
      roundedCorners: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'snip-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
    });
    // Over everything while it is open, a full-screen game included: it was asked for.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMenu(null);
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => { win = null; shot = null; try { globalShortcut.unregister('Escape'); } catch { /* gone */ } });
    win.once('ready-to-show', () => { if (win) { win.show(); win.focus(); } });
    // Escape closes it even when another program kept the keyboard; the key is given back as soon as it closes.
    globalShortcut.register('Escape', close);
    win.loadFile(path.join(__dirname, 'pages', 'snip.html'));
  } catch (err) {
    close();
    if (opts) opts.log(`check on screen: could not start (${err.message})`);
  } finally {
    opening = false;
  }
}

/** The box the person drew, in the page's pixels: read it, judge it, check its links. */
async function pick(rect) {
  if (!shot || !win) return;
  const { scale, image } = shot;
  shot = null;   // read once; the copy of the screen goes with it
  const size = image.getSize();
  const x = Math.max(0, Math.round(rect.x * scale));
  const y = Math.max(0, Math.round(rect.y * scale));
  const box = { x, y, width: Math.min(size.width - x, Math.round(rect.w * scale)), height: Math.min(size.height - y, Math.round(rect.h * scale)) };
  if (box.width < 8 || box.height < 8) { send({ phase: 'done', result: judge('', []) }); return; }
  let part = image.crop(box);
  send({ phase: 'reading' });
  let code = null;
  try { code = require('../shared/qr-read').decode(rgba(part)); } catch { /* no code */ }
  // The recogniser reads small words better a little larger.
  if (box.width < 1400 && box.height < 1400) part = part.resize({ width: box.width * 2, quality: 'best' });
  let words = '';
  try { words = (await require('./ocr').read([part.toPNG()])).join('\n'); } catch (err) {
    if (!code) { send({ phase: 'done', error: err.message }); return; }
  }
  let result = judge(words, [code]);
  send({ phase: 'done', result });
  if (opts) opts.log(`check on screen: ${result.level}, ${result.links.length} link(s)${code ? ', a QR code' : ''}`);
  if (!result.links.length || !opts) return;
  const done = (verdicts, why) => {
    const next = judge(words, [code], verdicts || {}, why);
    send({ phase: 'done', result: next });
    if (next.level !== result.level) opts.log(`check on screen: links checked, ${next.level}`);
    result = next;
  };
  // Private: no history, nothing sent to a registry, and not counted as live scanning (as a link in a text).
  opts.api('/api/v1/live/batch', { urls: result.links, private: true, mode: 'fast', purpose: 'texts' })
    .then((res) => done(res && res.byUrl))
    .catch((err) => done({}, err && err.status === 429 ? 'too many links to check just now' : "Sentinel's scanner could not be reached"));
}

/** The calls the sheet may make; anything from another window is refused. */
function listen() {
  const { ipcMain } = require('electron');
  const mine = (event) => win && !win.isDestroyed() && event.sender === win.webContents;
  ipcMain.handle('snip:pick', (event, rect) => {
    if (!mine(event) || !rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return false;
    pick(rect).catch(() => send({ phase: 'done', error: 'Something went wrong while reading it.' }));
    return true;
  });
  ipcMain.handle('snip:close', (event) => { if (mine(event)) close(); });
}

/** `o`: { api(path, body), log(line) }. */
function init(o) { if (!opts) listen(); opts = o; }

module.exports = { init, open, close, judge, KEYS, DEFAULT_KEY, isOpen: () => Boolean(win), _test: { phoneNumbers, linkFinding, rgba } };
