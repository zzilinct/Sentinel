/* Runs before first paint: opt in to reveal animations only when JS is available. */
document.documentElement.classList.add('js');
if (!('IntersectionObserver' in window)) document.documentElement.classList.add('no-io');
