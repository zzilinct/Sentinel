// The look before the first paint, from the query main.js gives every window (light or dark, the accent). The island
// (overlay.html, data-dark) is dark on any screen.
(function () {
  var L = window.SentinelLook, q = L.fromQuery(location.search);
  L.paint(document.documentElement, document.currentScript && 'dark' in document.currentScript.dataset ? L.dark(q) : q);
  // The app window's loading and error pages: no title bar of Windows' own (main.js), so the top is where it is dragged.
  var d = window.sentinelDesktop;
  if (d && d.framed) document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;inset:0 0 auto;height:env(titlebar-area-height,36px);-webkit-app-region:drag';
    document.body.prepend(bar);
  });
})();
