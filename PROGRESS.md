# Bar update, spots 3 and 4 (tray, launch and first run)

Branch work/e2e-bar-3. One protection state (desktop/src/protection.js) feeds the tray icon, tooltip, right-click
menu, the tray card (pages/tray.html) and the start window (pages/start.html, replacing loading.html and error.html).
notify() has one gate and one queue (desktop/src/notes.js): nothing over a full-screen game or video.

## Done
- (in progress)

## Next
- protection.js + notes.js + tests/tray.test.js
- tray icons in scripts/make-icons.js -> desktop/build/tray-*.png, copied by sync-shared
- tray.html card, start.html (starting / error / welcome), main.js wiring, preload
- review-shots: start + tray card + icon sheet; desktop-core-qa tray checks
