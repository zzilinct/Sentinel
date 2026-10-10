'use strict';
/**
 * Pay pause: a last word before paying with gift cards or crypto. When live scanning is on a page that sells gift
 * cards or sends crypto (the scanner says which: server/lib/scan/paycheck.js payPage), and something scam-shaped
 * happened on this computer in the last hour, the shield's window says once, calmly, that no real company asks to be
 * paid this way. Never without such a sign, never a block, once per site for as long as Sentinel runs.
 *
 * The signs: a remote-control program the tech-support scam shield noticed (or one running now), a page live scanning
 * flagged, a chat warning, or the call check answering "Hang up". Only the kind of sign and its time are kept, in memory.
 */
const HOUR = 60 * 60 * 1000;
const SIGNS = ['remote', 'page', 'chat', 'call'];

function create() {
  const signs = new Map();
  const shown = new Set();
  return {
    /** Something scam-shaped happened: 'remote', 'page', 'chat' or 'call'. */
    sign(kind, at = Date.now()) { if (SIGNS.includes(kind)) signs.set(kind, at); },
    /**
     * A gift card or crypto page on this site. Returns { sign, again }: the latest sign in the last hour (or null), and
     * whether the pause was already shown here. Show it when sign && !again; that counts as shown.
     */
    ask(site, { at = Date.now(), remoteNow = false } = {}) {
      let sign = remoteNow ? 'remote' : null;
      let latest = -Infinity;
      if (!sign) for (const [kind, t] of signs) if (at - t < HOUR && t > latest) { sign = kind; latest = t; }
      const key = String(site || '');
      const again = shown.has(key);
      if (sign && !again) {
        if (shown.size >= 500) shown.clear();
        shown.add(key);
      }
      return { sign, again };
    }
  };
}

module.exports = { create, HOUR };
