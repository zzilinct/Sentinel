/**
 * A phone screenshot of a text conversation (SMS, WhatsApp, a DM), as Windows read it on this computer
 * (desktop/src/ocr.js gives lines, top to bottom, without positions): which line says who it is from, and which lines
 * are the messages. The phone's own words around them (the clock, "Text Message", "Delivered", the reply box, the
 * encryption notice) are left out. Runs in the page, on the Text scan tab (app.js); it sends nothing anywhere.
 *
 *   SentinelTextShot.read(text) -> { from, text }
 */
(() => {
  'use strict';

  const TIME = String.raw`\d{1,2}[:.]\d{2}(\s?[ap]\.?m\.?)?`;
  const MONTH = String.raw`(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?`;
  const WEEKDAY = String.raw`(today|yesterday|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?)\.?`;
  const DATE = String.raw`${MONTH}\s+\d{1,2}(,?\s*\d{4})?|\d{1,2}\s+${MONTH}(\s+\d{4})?|\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?`;
  const BAR = String.raw`(\d{1,2}[:.]\d{2}|\d{1,3}\s?%?|5g|4g|lte|3g|wi-?fi|volte|e|h\+?)`;
  // Lines that are the phone talking, not the sender: what is left is the messages.
  const CHROME = [
    // 9:41, Today 10:32 AM, Yesterday, Mon, Oct 6, 06/10/2026
    new RegExp(`^(${WEEKDAY})?[\\s,•·-]*(${DATE})?[\\s,•·-]*(at\\s+)?(${TIME})?$`, 'i'),
    new RegExp(`^${BAR}(\\s+${BAR})*$`, 'i'),                                            // the status bar
    /^\d{1,2}:\d{2}\b.{0,12}$/,                                                          // the clock with its icons
    /^[\s\W]*$/,                                                                         // <, >, ..., a lone icon
    /^(text message|sms|mms|imessage|rcs( chat| message)?|chat|message|messages|type a message|text message\s*[•·]\s*(sms|rcs)|send)$/i,
    new RegExp(`^(delivered|read|seen|sent|not delivered)(\\s+(at\\s+)?(${TIME}|${WEEKDAY}).*)?$`, 'i'),
    /^(online|typing\.*|last seen .*|tap for (contact )?info|contact info|details|edited)$/i,
    /end-to-end encrypted|not in your contact(s| list)|report (junk|spam)$|^block (number|contact)$|^add to contacts$|from an unknown sender/i
  ];
  const GREETING = /^(hi|hey|hello|hiya|dear|good (morning|afternoon|evening)|ok|okay|yes|no|thanks?)\b/i;

  const chrome = (line) => CHROME.some((re) => re.test(line));

  /** A line that names the other side: a number, a short code, an email address, or (`top` only) a contact's name. */
  function senderOf(line, top) {
    const s = line.replace(/^[\s<←‹>›]+|[\s<>›‹→]+$/g, '').trim();
    if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(s)) return s;
    if (/^[+(]?\d[\d\s().-]*$/.test(s) && /^\d{4,15}$/.test(s.replace(/[\s().+-]/g, ''))) return s;
    // A name only as the very first line, short, and not the start of a message.
    if (top && s.length <= 30 && s.split(/\s+/).length <= 4 && /^\p{Lu}[\p{L}'’ .&-]*$/u.test(s) && !/[.]$/.test(s) && !GREETING.test(s)) return s;
    return '';
  }

  function read(raw) {
    const kept = String(raw || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && !chrome(l));
    let from = '';
    // The header is at the top: the first few lines, never past the first long one (a message), and never the only one.
    for (let i = 0; i < Math.min(4, kept.length - 1) && !from; i++) {
      if (kept[i].length > 40) break;
      from = senderOf(kept[i], i === 0);
      if (from) kept.splice(i, 1);
    }
    return { from, text: kept.join('\n') };
  }

  const api = { read };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.SentinelTextShot = api;
})();
