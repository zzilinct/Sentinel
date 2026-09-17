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

  root.SentinelMasks = { svg: svg, paint: paint, GLYPHS: GLYPHS, COLORS: COLORS, NAMES: NAMES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
