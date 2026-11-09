/**
 * What was pasted or dropped on the Check page (app.js checkView), and so which check runs and which of the week's
 * scans it uses. The one place that decides: the page never asks a person whether their worry is a "link", a "text"
 * or a "virus", it says what it saw and lets them change it with one press.
 *
 *   SentinelRoute.pick({ text, file }, { features, choice, deeper })
 *     -> { kind, path, meter, mode?, url?, limited? }
 *
 *   kind   empty | link | download | message | email | number | file | picture | eml
 *   path   the scan route it goes to (server/routes/scan.routes.js), or null when nothing is sent
 *   meter  the weekly allowance that route spends: linkScans, deepScans or fileScans (null when none)
 */
(() => {
  'use strict';

  // A web address and nothing else: "https://x.example/a" or "x.example/a".
  const LINK = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z][a-z0-9-]+(:\d{1,5})?([/?#]\S*)?$/i;
  // A link inside words, as the email check finds them: with its scheme, or starting www.
  const ANY_LINK = /\bhttps?:\/\/[^\s<>"')]+|(?<![\w./@-])www\.[a-z0-9.-]+\.[a-z]{2,}[^\s<>"')]*/i;
  // A link to a file that runs, installs or unpacks: what a virus scan is for.
  const DOWNLOAD = /\.(exe|msi|msix|appx|scr|bat|cmd|com|ps1|vbs|jse?|wsf|hta|jar|apk|xapk|dmg|pkg|iso|img|zip|rar|7z|gz|tgz|lnk|reg|dll|docm|xlsm|pptm)$/i;
  // The headers a mail program shows or copies. Two of them, or a From and a Subject, make it an email.
  const HEADER = /^(from|to|subject|reply-to|date|sent|cc|received|return-path|delivered-to|authentication-results|received-spf|dkim-signature|message-id|mime-version)[ \t]*:/gim;
  const IMAGE = /^image\//;

  const isLink = (s) => Boolean(s) && !/\s/.test(s) && LINK.test(s);
  const pathOf = (url) => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname; } catch { return ''; } };
  const isDownload = (url) => DOWNLOAD.test(pathOf(url));
  const firstLink = (s) => { const m = String(s || '').match(ANY_LINK); return m ? m[0].replace(/[.,;:!?]+$/, '') : null; };

  function isEmail(s) {
    const names = new Set((s.slice(0, 64 * 1024).match(HEADER) || []).map((h) => h.replace(/[ \t]*:$/, '').toLowerCase()));
    return names.size >= 2 && (names.has('from') || names.has('subject') || names.has('received') || names.has('return-path'));
  }

  // A phone number on its own: digits with the usual + ( ) - . and spaces, 6 to 15 digits, no letters.
  function isNumber(s) {
    if (!/^\+?[\d\s().-]+$/.test(s)) return false;
    const digits = s.replace(/\D/g, '').length;
    return digits >= 6 && digits <= 15;
  }

  /** What it looks like, before anyone changes it. */
  function guess({ text = '', file = null } = {}) {
    if (file) {
      if (IMAGE.test(file.type || '')) return 'picture';
      if (/\.eml$/i.test(file.name || '') || file.type === 'message/rfc822') return 'eml';
      return 'file';
    }
    const t = String(text).trim();
    if (!t) return 'empty';
    if (isLink(t)) return isDownload(t) ? 'download' : 'link';
    if (isNumber(t)) return 'number';
    if (isEmail(t)) return 'email';
    return 'message';
  }

  /** The kinds a person may change it to, for what is in the box. */
  function choices({ text = '', file = null } = {}) {
    if (file) return [];
    const t = String(text).trim();
    if (!t) return [];
    const link = isLink(t) ? t : firstLink(t);
    return [...(link ? ['link', 'download'] : []), 'message', 'email'];
  }

  function pick(input = {}, { features = {}, choice = null, deeper = false } = {}) {
    const auto = guess(input);
    const kind = choice && choices(input).includes(choice) ? choice : auto;
    const t = String(input.text || '').trim();
    const url = kind === 'link' || kind === 'download' ? (isLink(t) ? t : firstLink(t)) : undefined;
    const research = Boolean(features.research);
    switch (kind) {
      case 'link': {
        const mode = deeper && research ? 'delicate' : 'fast';
        return { kind, url, path: '/scan/link', mode, meter: mode === 'delicate' ? 'deepScans' : 'linkScans' };
      }
      case 'download': {
        // Free's link scan looks for scams only: a download goes to the virus scan there. On Pro and up the link
        // scan already looks for scams, viruses and malware, so it costs a link scan, not a virus scan.
        if (!features.virusMalwareOnLinks) return { kind, url, path: '/scan/threat', meter: 'fileScans' };
        const mode = deeper && research ? 'delicate' : 'fast';
        return { kind, url, path: '/scan/link', mode, meter: mode === 'delicate' ? 'deepScans' : 'linkScans' };
      }
      case 'email':
        // Reading who really sent it is Max's. Anywhere else an email is still checked, as a message: never a wall.
        return features.emailManual ? { kind, path: '/scan/email', meter: 'deepScans' } : { kind, path: '/scan/text', meter: 'linkScans', limited: true };
      case 'message': return { kind, path: '/scan/text', meter: 'linkScans' };
      case 'file': return { kind, path: '/scan/file', meter: 'fileScans' };
      default: return { kind, path: null, meter: null };
    }
  }

  const api = { pick, guess, choices, firstLink, isLink };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.SentinelRoute = api;
})();
