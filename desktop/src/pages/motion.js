'use strict';
/**
 * Motion in Sentinel's own windows (the live scanning overlay, the warning cards, the chat cards, the screen check, the
 * loading page): the app's setting, Full, Calm or Off, and its scan effect, set as <html data-motion> and
 * <html data-scan-effect> for the page's styles and binary.js, exactly as boot.js does on the web. Windows asking for
 * less motion is Off. main.js tells every window when its page has loaded and again whenever the setting changes, so a
 * window that is open follows at once.
 */
(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var chosen = { motion: 'full', scanEffect: true };
  function apply() {
    root.dataset.motion = reduce && reduce.matches ? 'off' : chosen.motion === 'calm' || chosen.motion === 'off' ? chosen.motion : 'full';
    root.dataset.scanEffect = chosen.scanEffect === false ? 'off' : 'on';
  }
  apply();
  if (reduce && reduce.addEventListener) reduce.addEventListener('change', apply);
  var bridge = window.sentinelOverlay || window.sentinelDesktop || window.sentinelChat || window.sentinelSnip;
  if (bridge && bridge.onMotion) bridge.onMotion(function (m) { if (m) chosen = m; apply(); });
})();
