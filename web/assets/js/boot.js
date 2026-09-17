/* Runs before first paint: opt in to reveal animations only when JS is available. */
document.documentElement.classList.add('js');
if (!('IntersectionObserver' in window)) document.documentElement.classList.add('no-io');

// Installable web app. Service workers need HTTPS (or localhost in development).
const secureContext = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && secureContext) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
