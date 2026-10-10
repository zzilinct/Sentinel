/**
 * Warn a friend: a picture card of a scan that found a scam (a link, a text, an email or a QR code), drawn with a
 * canvas on this device and never uploaded. It carries the mask, the verdict, the scam's tell-tale words and the
 * link written so no app can turn it into a link again (hxxps://example[.]com), never the live link.
 *
 * Every word on the card goes through defang(), so an address inside a reason is broken too. tests/warncard.test.js
 * checks the words; scripts/verify-web.js checks the picture in a real browser.
 */
(function (root) {
  'use strict';

  // The house colours of the masks (masks.js), fixed here: a picture has no theme.
  const TONES = { red: '#e5484d', orange: '#f08a24', yellow: '#f5c542' };

  /**
   * Text with every web address broken: http(s) becomes hxxp(s), a dot between parts of a name becomes [.], an @
   * becomes [@]. A few harmless dots in prose ("1.99") are broken too; a link that still works is the worse mistake.
   */
  function defang(s) {
    return String(s == null ? '' : s)
      .replace(/\bhttp(s?):\/\//gi, 'hxxp$1://')
      .replace(/\b(ftp|file|ws|wss):\/\//gi, '$1[://]')
      .replace(/(?<=[\p{L}\p{N}_-])[.。．｡](?=[\p{L}\p{N}-]{2,}|\p{N})/gu, '[.]')
      .replace(/(?<=[\p{L}\p{N}._%+-])@(?=[\p{L}\p{N}-])/gu, '[@]');
  }

  /** True when text still holds something a chat app or mail program would make tappable. */
  function linkable(s) {
    return /\b(?:https?|ftp|file):\/\//i.test(s) || /\bwww\./i.test(s) ||
      /[\p{L}\p{N}-][.。．｡](?:\p{L}{2,}|xn--)/iu.test(s) || /[\p{L}\p{N}]@[\p{L}\p{N}-]+\./u.test(s);
  }

  /**
   * The link as it goes on the card: where it leads (scheme, host, path), without the query or the part after #,
   * which in a scam link often carry the person's own email address or a tracking code. Long paths are shortened.
   */
  function shortLink(url) {
    let out = String(url || '');
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(out) ? out : `https://${out}`);
      const path = u.pathname === '/' ? '' : u.pathname;
      out = `${u.protocol}//${u.host}${path.length > 48 ? `${path.slice(0, 47)}…` : path}`;
    } catch { out = out.split(/[?#]/)[0].slice(0, 90); }
    return defang(out);
  }

  /** A card from a link, threat or email verdict (ui.js headline gives title, tone and mask). */
  function fromVerdict(v, head) {
    const email = v.kind === 'email';
    const bad = email ? (v.links || []).find((l) => l.overall && l.overall.badge) : null;
    return {
      tone: head.tone, threat: head.threat, title: head.title,
      what: email ? 'An email' : 'A link',
      from: email && v.sender && v.sender.address ? v.sender.address : null,
      link: email ? (bad ? bad.url : null) : v.url,
      tells: (v.reasons || []).map((r) => r.text).slice(0, 3)
    };
  }

  /** A card from a text scan (app.js textResult): its flag and the worst of its links. */
  function fromText(r, from, tone) {
    const link = r.links.find((l) => l.badge === 'red') || r.links.find((l) => l.badge) || r.links[0];
    return { tone, threat: 'scam', title: r.flag.title, what: 'A text message', from: from || null, link: link ? link.url : null, tells: [r.flag.detail] };
  }

  /** A card from what a QR code does (server/lib/scan/qr.js), when that is a scam on its own (a sign-in, a wallet). */
  function fromQr(info) {
    return { tone: info.tone, threat: 'scam', title: info.title, what: 'A QR code', from: null, link: info.url || null, tells: [info.detail] };
  }

  /** Every line of words on the card, in order, already defanged. The picture draws exactly these. */
  function words(card) {
    return {
      label: 'Scam warning from Sentinel',
      title: defang(card.title),
      what: card.what === 'A link' ? 'Do not open this link or type anything on it.' : `${card.what}${card.link ? ' with this link' : ''}. Do not open it, reply or pay.`,
      link: card.link ? shortLink(card.link) : null,
      from: card.from ? `From ${defang(card.from)}` : null,
      why: 'Why it is a scam',
      tells: card.tells.filter(Boolean).map(defang),
      foot: 'Checked with Sentinel. This picture was made on the device and the link is written so it cannot be tapped.'
    };
  }

  /** The card as plain text, for the share sheet and for screen readers. */
  function text(card) {
    const w = words(card);
    return [w.label, w.title, w.what, w.link, w.from, ...w.tells].filter(Boolean).join('\n');
  }

  /* ---------------------------------------------------------- drawing */

  const W = 1080;
  const PAD = 80;
  const SANS = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';
  const MONO = 'Consolas, ui-monospace, "SF Mono", Menlo, monospace';

  // Lines that fit the width, broken at spaces, and inside a word only when the word alone is too wide (a long link).
  function wrap(g, s, width) {
    const lines = [];
    let line = '';
    for (const word of s.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width <= width) { line = next; continue; }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (g.measureText(rest).width > width) {
        let n = rest.length;
        while (n > 1 && g.measureText(rest.slice(0, n)).width > width) n--;
        // A link breaks after a slash where one is near the end of the line, not in the middle of a word.
        const slash = rest.lastIndexOf('/', n - 1) + 1;
        if (slash > n * 0.6) n = slash;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines;
  }

  function maskImage(threat, colour) {
    const Masks = root.SentinelMasks;
    if (!Masks || typeof Image === 'undefined') return Promise.resolve(null);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Masks.svg(threat, `xmlns="http://www.w3.org/2000/svg" width="256" height="256" style="color:${colour}"`))}`;
    return img.decode().then(() => img, () => null);
  }

  /** Draws the card onto the canvas (1080 wide, as tall as its words need). Resolves when the mask is in. */
  async function draw(canvas, card) {
    const w = words(card);
    const tone = TONES[card.tone] || TONES.red;
    const mask = await maskImage(card.threat, tone);
    const g = canvas.getContext('2d');
    const inner = W - PAD * 2;

    // Measured first, so the canvas is made the right height once.
    const blocks = [];
    let y = PAD + 200;
    const add = (font, colour, lines, lh, gap, extra) => { blocks.push({ font, colour, lines, lh, y, ...extra }); y += lines.length * lh + gap; };
    const measure = (font, s, width = inner) => { g.font = font; return wrap(g, s, width); };
    const titleFont = `700 76px ${SANS}`;
    add(titleFont, '#ffffff', measure(titleFont, w.title), 88, 24);
    add(`400 38px ${SANS}`, '#c9ccd3', measure(`400 38px ${SANS}`, w.what), 50, 36);
    if (w.link) {
      const lines = measure(`600 40px ${MONO}`, w.link, inner - 64);
      blocks.push({ box: true, y, h: lines.length * 54 + 56 });
      y += 28;
      add(`600 40px ${MONO}`, tone, lines, 54, 64, { x: PAD + 32 });
    }
    if (w.from) add(`400 34px ${SANS}`, '#c9ccd3', measure(`400 34px ${SANS}`, w.from), 46, 36);
    if (w.tells.length) {
      add(`700 28px ${SANS}`, tone, [w.why.toUpperCase()], 40, 14);
      for (const t of w.tells) add(`400 36px ${SANS}`, '#e8eaee', measure(`400 36px ${SANS}`, t, inner - 40), 48, 18, { x: PAD + 40, bullet: true });
      y += 18;
    }
    const footFont = `400 28px ${SANS}`;
    const foot = measure(footFont, w.foot);
    canvas.width = W;
    canvas.height = Math.max(W, y + 40 + foot.length * 38 + PAD);

    g.fillStyle = '#101216';
    g.fillRect(0, 0, W, canvas.height);
    g.fillStyle = tone;
    g.fillRect(0, 0, W, 14);
    if (mask) g.drawImage(mask, PAD - 12, PAD, 176, 176);
    g.textBaseline = 'top';
    g.font = `700 30px ${SANS}`;
    g.fillStyle = tone;
    g.fillText(w.label.toUpperCase(), PAD + 196, PAD + 56);
    g.font = `400 30px ${SANS}`;
    g.fillStyle = '#9aa0ab';
    g.fillText(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }), PAD + 196, PAD + 100);

    for (const b of blocks) {
      if (b.box) {
        g.fillStyle = '#1b1e25';
        g.strokeStyle = tone;
        g.lineWidth = 3;
        g.beginPath();
        if (g.roundRect) g.roundRect(PAD, b.y, inner, b.h, 18); else g.rect(PAD, b.y, inner, b.h);
        g.fill();
        g.stroke();
        continue;
      }
      g.font = b.font;
      g.fillStyle = b.colour;
      b.lines.forEach((line, i) => g.fillText(line, b.x || PAD, b.y + i * b.lh));
      if (b.bullet) { g.fillStyle = tone; g.beginPath(); g.arc(PAD + 10, b.y + 22, 8, 0, Math.PI * 2); g.fill(); }
    }
    const fy = canvas.height - PAD - foot.length * 38;
    g.fillStyle = '#2a2e37';
    g.fillRect(PAD, fy - 32, inner, 2);
    g.font = footFont;
    g.fillStyle = '#9aa0ab';
    foot.forEach((line, i) => g.fillText(line, PAD, fy + i * 38));
    return canvas;
  }

  const api = { defang, linkable, shortLink, fromVerdict, fromText, fromQr, words, text, draw, TONES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SentinelWarnCard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
