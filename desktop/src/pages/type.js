'use strict';
/**
 * Text size and spacing in Sentinel's own windows (the live scanning overlay and the warning cards): the app's
 * Settings choice, set as <html data-text> and <html data-density> for fonts.css, exactly as boot.js does on the web.
 * main.js tells every window when its page has loaded and again whenever the choice changes.
 */
(function () {
  var root = document.documentElement;
  var bridge = window.sentinelOverlay || window.sentinelDesktop;
  if (!bridge || !bridge.onType) return;
  bridge.onType(function (t) {
    if (!t) return;
    if (t.text === 'large' || t.text === 'larger') root.dataset.text = t.text; else delete root.dataset.text;
    if (t.density === 'compact') root.dataset.density = 'compact'; else delete root.dataset.density;
    // Simple view (Settings): the warning cards say less, with the answer first in bigger type (warn.html).
    if (t.simple === true) root.dataset.simple = ''; else delete root.dataset.simple;
  });
})();
