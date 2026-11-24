'use strict';
/**
 * The Overview's first view, drawn by the server for someone signed in (web/app.html keeps it once, in two <template>s):
 * the greeting with their name, the box to paste into, and the confirm-email bar when it is owed. The page used to draw
 * all of this from app.js after asking who is signed in, and the largest paint waited for that; now it is in the HTML.
 * app.js takes these elements over as they are (home, verifyBar), so nothing is drawn twice and nothing moves.
 */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const part = (html, id) => { const m = new RegExp(`<template id="${id}">([\\s\\S]*?)</template>`).exec(html); return m ? m[1].trim() : ''; };
const SLOT = '<div id="view"></div>';

/**
 * `html` is web/app.html as served; `user` is auth.publicUser(); `verifyOwed` is whether the confirm-email bar shows
 * (mail can be sent and the address is not confirmed). Anything missing leaves the page as it was: app.js draws it.
 */
function fill(html, user, verifyOwed) {
  const top = part(html, 'home-top');
  if (!top || !html.includes(SLOT) || !user || user.needsTerms) return html;
  const bar = verifyOwed ? part(html, 'verify-bar').replace('<span data-email></span>', () => `<span data-email>${esc(user.email)}</span>`).replace('<div class="verify-bar"', '<div class="verify-bar" data-shell') : '';
  const first = top.replace('<span data-name></span>', () => `<span data-name>${esc(user.firstName)}</span>`);
  return html.replace(SLOT, () => `<div id="view" data-tab="home">${bar}<div class="view" data-shell>${first}</div></div>`);
}

module.exports = { fill, esc };
