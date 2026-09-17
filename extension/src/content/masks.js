/**
 * Sentinel's brand mark and its three masks, shared by the web app, the
 * marketing site and the browser extension (the build copies this file).
 *
 *   logo     helmet inside a shield            (the brand mark)
 *   scam     bare helmet, expressionless       (the anonymous con)
 *   virus    helmet ringed with spores         (infectious files)
 *   malware  horned helmet with a jagged jaw   (hostile code)
 *
 * All four are drawn from one helmet silhouette, so a mask always reads as the
 * same face as the logo. Features are cut out of the helmet (even-odd fill),
 * which keeps every glyph legible in a single colour at any size.
 */
(function (root) {
  'use strict';

  // Helmet: domed brow, flared cheeks, a chin that tapers to a point.
  var HELMET = 'M32 11.6c-5.6 0-10.4 1.8-12.6 5C18.4 18.1 18 19.9 18 21.8v7.8c0 3.8 1.2 7 3.4 9.8L32 49.4l10.6-10c2.2-2.8 3.4-6 3.4-9.8v-7.8c0-1.9-.4-3.7-1.4-5.2-2.2-3.2-7-5-12.6-5Z';
  // Eye slits, angled inward and down.
  var EYES = 'M21 23.4l8 3-.5 3.6-7.5-1.8ZM43 23.4l-8 3 .5 3.6 7.5-1.8Z';
  // The face opening either side of the nose guard.
  var CHEEKS = 'M24.6 32l4.6 1.1v8.4l-3-3.4ZM39.4 32l-4.6 1.1v8.4l3-3.4Z';
  // Jagged jaw, used in place of the plain opening on the malware mask.
  var JAW = 'M24 32.6l3.6 2.1 3.6-2.1 3.6 2.1 3.6-2.1v3.8l-3.6 2.1-3.6-2.1-3.6 2.1-3.6-2.1Z';
  var HORNS = 'M17.6 15.4 12.4 3.8l12.2 5.9ZM46.4 15.4l5.2-11.6-12.2 5.9Z';
  var SPORES = 'M32 1.4a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4ZM8.6 12.4a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4ZM55.4 12.4a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4ZM4.8 33.2a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4ZM59.2 33.2a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4ZM15 53a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4ZM49 53a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Z';
  // Shield that carries the helmet in the brand mark.
  var SHIELD = 'M32 2.6 57.4 10v18.6c0 14.6-9.9 24.6-25.4 31.4C16.5 53.2 6.6 43.2 6.6 28.6V10Zm0 4.2L10.6 13v15.6c0 12.2 8 20.7 21.4 26.8 13.4-6.1 21.4-14.6 21.4-26.8V13Z';
  // Rivet on the helmet's upper right, as on the supplied logo.
  var RIVET = 'M42.8 16.2a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Z';

  var fill = function (d) { return '<path fill="currentColor" fill-rule="evenodd" d="' + d + '"/>'; };

  var GLYPHS = {
    logo: fill(SHIELD) + '<g transform="translate(32 30.5) scale(.70) translate(-32 -30.5)">' + fill(HELMET + EYES + CHEEKS) + fill(RIVET) + '</g>',
    scam: fill(HELMET + EYES + CHEEKS) + fill(RIVET),
    virus: '<g transform="translate(32 32) scale(.82) translate(-32 -32)">' + fill(HELMET + EYES + CHEEKS) + '</g>' + fill(SPORES),
    malware: fill(HORNS) + fill(HELMET + EYES + JAW)
  };

  var COLORS = { yellow: '#f5c542', orange: '#f08a24', red: '#e5484d', clear: '#4cb782' };
  var NAMES = { scam: 'Scam', virus: 'Virus', malware: 'Malware' };

  function svg(threat, attrs) {
    var extra = attrs || '';
    return '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" ' + extra + '>' + (GLYPHS[threat] || GLYPHS.scam) + '</svg>';
  }

  /** Fill every [data-glyph] element under `scope` (no-op once painted). */
  function paint(scope) {
    var root = scope || document;
    var nodes = root.querySelectorAll('[data-glyph]');
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].firstElementChild) nodes[i].innerHTML = svg(nodes[i].dataset.glyph);
    }
  }

  /* ------------------------------------------------------------- kinds */

  // One line icon per threat kind, so a result reads at a glance without the
  // label: what it is, not just how bad. 24-unit grid, stroke only, so they
  // sit beside text at any size in any colour.
  var K = function (d) { return '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</g>'; };
  var KIND_GLYPHS = {
    // scam
    phishing:      K('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/><path d="m3 3 18 18"/>'),
    crypto:        K('<path d="M12 2.5 20 7v10l-8 4.5L4 17V7Z"/><path d="M9 9h4.5a2 2 0 0 1 0 4H9m0 0h5a2 2 0 0 1 0 4H9M11 7v2m0 8v2"/>'),
    delivery:      K('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9M8 5.3l8 4.5"/>'),
    support:       K('<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19v1a2 2 0 0 1-2 2h-3"/>'),
    prize:         K('<rect x="3" y="9" width="18" height="4" rx="1"/><path d="M5 13v8h14v-8M12 9v12M12 9c-2-4-6-4-6-1s4 1 6 1Zm0 0c2-4 6-4 6-1s-4 1-6 1Z"/>'),
    store:         K('<path d="M3 9 5 4h14l2 5"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v8h14v-8M10 20v-5h4v5"/>'),
    government:    K('<path d="M3 21h18M4 9h16L12 4Z"/><path d="M6 9v9M10 9v9M14 9v9M18 9v9"/>'),
    investment:    K('<path d="M3 20h18M4 16l5-5 4 3 7-7"/><path d="M15 7h5v5"/>'),
    romance:       K('<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/><path d="m4 4 16 16"/>'),
    impersonation: K('<circle cx="9" cy="10" r="5"/><path d="M13.5 6.5A5 5 0 1 1 15 15.8"/><path d="M2 21a7 7 0 0 1 14 0M14 21h8a6 6 0 0 0-3-5"/>'),
    address:       K('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/><path d="M12 2v2M12 20v2"/>'),
    blocked:       K('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
    // virus
    disguised:     K('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="m9 13 3 3 3-3M12 10v6"/><path d="M9 19h6"/>'),
    macro:         K('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><circle cx="12" cy="15" r="2.5"/><path d="M12 10.5v1.2M12 18.3v1.2M8.1 12.8l1 .6M14.9 16.6l1 .6M8.1 17.2l1-.6M14.9 13.4l1-.6"/>'),
    archive:       K('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 4v3h2v2h-2v2h2v2h-2v2h2v2"/>'),
    program:       K('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M12 11v7m0 0-3-3m3 3 3-3"/>'),
    sample:        K('<path d="M6 12a6 6 0 0 1 12 0v3"/><path d="M9 12a3 3 0 0 1 6 0v6"/><path d="M12 12v9M4 16a8 8 0 0 0 1 4M20 19a8 8 0 0 0 .5-3"/>'),
    // malware
    fake_update:   K('<rect x="3" y="4" width="18" height="15" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/><path d="M12 12v5m0 0-2.5-2.5M12 17l2.5-2.5"/>'),
    paste_command: K('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>'),
    miner:         K('<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 10h4v4h-4Z"/><path d="M4 9h3M4 12h3M4 15h3M17 9h3M17 12h3M17 15h3M9 4v3M12 4v3M15 4v3M9 17v3M12 17v3M15 17v3"/>'),
    notification:  K('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 21a2 2 0 0 0 4 0"/><path d="M12 2v3"/>'),
    hidden:        K('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="m4 4 16 16"/>'),
    drop:          K('<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/><path d="M17 7v10"/>'),
    known:         K('<path d="M4 6h10M4 12h10M4 18h7"/><path d="m15 17 2 2 4-5"/>'),
    stealer:       K('<circle cx="8" cy="13" r="3.5"/><path d="M11.5 13H17M15 13v3"/><path d="M14 4h6v6"/><path d="m20 4-6 6"/>')
  };

  /** Icon for a threat kind (see server/lib/scan/kinds.js). Unknown kinds get nothing. */
  function kindIcon(kind, attrs) {
    if (!KIND_GLYPHS[kind]) return '';
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ' + (attrs || '') + '>' + KIND_GLYPHS[kind] + '</svg>';
  }

  root.SentinelMasks = { svg: svg, paint: paint, kindIcon: kindIcon, GLYPHS: GLYPHS, KIND_GLYPHS: KIND_GLYPHS, COLORS: COLORS, NAMES: NAMES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
