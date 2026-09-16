/**
 * Sentinel's three masks - one per threat - shared by the web app and the
 * browser extension (the build copies this file into the extension).
 *
 *   scam     theatre mask with a smile          (the classic con)
 *   virus    mask ringed with spores            (infectious files)
 *   malware  horned mask with a jagged mouth    (hostile code)
 *
 * Features are cut out of the face (even-odd fill), so the glyph reads on any
 * background in a single colour: yellow, orange or red.
 */
(function (root) {
  'use strict';

  var FACE = 'M32 5c13.2 0 23 4.3 23 10.8 0 15.8-7.4 36.6-23 43.9C16.4 52.4 9 31.6 9 15.8 9 9.3 18.8 5 32 5Z';
  var ROUND_EYES = 'M22.2 25.4c-3 0-5.1 2-5.1 4.7s2.1 4.7 5.1 4.7 5.1-2 5.1-4.7-2.1-4.7-5.1-4.7ZM41.8 25.4c-3 0-5.1 2-5.1 4.7s2.1 4.7 5.1 4.7 5.1-2 5.1-4.7-2.1-4.7-5.1-4.7Z';
  var SMILE = 'M21.6 40.4c2.9 4.4 6.4 6.6 10.4 6.6s7.5-2.2 10.4-6.6c.6-.9 1.9-1.2 2.8-.6.9.6 1.2 1.9.6 2.8-3.7 5.6-8.3 8.4-13.8 8.4s-10.1-2.8-13.8-8.4c-.6-.9-.3-2.2.6-2.8.9-.6 2.2-.3 2.8.6Z';
  var FLAT = 'M24 41.5h16a2.2 2.2 0 0 1 0 4.4H24a2.2 2.2 0 0 1 0-4.4Z';
  var ANGRY_EYES = 'M16.5 24.5l12.8 4.6-.6 5.6-11.2-2.2ZM47.5 24.5l-12.8 4.6.6 5.6 11.2-2.2Z';
  var ZIGZAG = 'M19.5 43.2l6.2-4.6 6.3 4.6 6.3-4.6 6.2 4.6v4.4l-6.2-4.6-6.3 4.6-6.3-4.6-6.2 4.6Z';

  var GLYPHS = {
    scam: '<path fill="currentColor" fill-rule="evenodd" d="' + FACE + ROUND_EYES + SMILE + '"/>',
    virus:
      '<g transform="translate(6.4 7.4) scale(.8)"><path fill="currentColor" fill-rule="evenodd" d="' + FACE + ROUND_EYES + FLAT + '"/></g>' +
      '<path fill="currentColor" d="M32 1.2a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM8.2 12.2a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM55.8 12.2a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM4.4 33.4a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM59.6 33.4a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM14.6 53.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM49.4 53.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z"/>',
    malware:
      '<path fill="currentColor" d="M14.5 13.5 9.2 1.6l12.4 5.7ZM49.5 13.5l5.3-11.9-12.4 5.7Z"/>' +
      '<path fill="currentColor" fill-rule="evenodd" d="' + FACE + ANGRY_EYES + ZIGZAG + '"/>'
  };

  var COLORS = { yellow: '#f5c542', orange: '#f08a24', red: '#e5484d', clear: '#4cb782' };
  var NAMES = { scam: 'Scam', virus: 'Virus', malware: 'Malware' };

  function svg(threat, attrs) {
    var extra = attrs || '';
    return '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" ' + extra + '>' + (GLYPHS[threat] || GLYPHS.scam) + '</svg>';
  }

  root.SentinelMasks = { svg: svg, GLYPHS: GLYPHS, COLORS: COLORS, NAMES: NAMES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
