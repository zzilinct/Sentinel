// The look before the first paint, from the query main.js gives every window (light or dark, the accent). The island
// (overlay.html, data-dark) is dark on any screen.
(function () {
  var L = window.SentinelLook, q = L.fromQuery(location.search);
  L.paint(document.documentElement, document.currentScript && 'dark' in document.currentScript.dataset ? L.dark(q) : q);
})();
