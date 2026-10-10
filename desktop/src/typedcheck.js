'use strict';
/**
 * "Did you type anything?" after a fake sign-in. When live scanning flagged a page that had a password box or a card
 * number box (watch.js finds them through UI Automation: only whether a box is a password box or is labelled for a
 * card, never what is in it), and the person closes or leaves that page, one calm question asks whether they typed
 * a password or card number there. Yes opens the matching part of the recovery guide (web/assets/js/recover.js
 * reads ?happened=), No closes it.
 *
 * Asked once per site for as long as Sentinel runs. The sites asked about are held in memory only, never written.
 */

/** What the recovery guide ticks for the boxes the page had: 'password', 'card', both, or null for neither. */
function happened(fields) {
  const f = fields || {};
  return [f.pw === true && 'password', f.card === true && 'card'].filter(Boolean).join(',') || null;
}

function create() {
  const asked = new Set();
  return {
    /** The recovery guide's ticks when this site should be asked about now, or null (no box, or already asked). */
    ask(site, fields) {
      const h = happened(fields);
      const key = String(site || '');
      if (!h || !key || asked.has(key)) return null;
      if (asked.size >= 500) asked.clear();
      asked.add(key);
      return h;
    }
  };
}

module.exports = { happened, create };
