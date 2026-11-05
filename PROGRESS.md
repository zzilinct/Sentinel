# Bar update, spots 3 and 4 (tray, launch and first run)

Branch work/e2e-bar-3. One protection state (desktop/src/protection.js) feeds the tray icon, tooltip, right-click
menu, the tray card (pages/tray.html) and the start window (pages/start.html, replacing loading.html and error.html).
notify() has one gate and one queue (desktop/src/notes.js): nothing over a full-screen game or video.

## Done (commit 9b35429)
- protection.js + notes.js + tests/tray.test.js (in npm test)
- tray icons in scripts/make-icons.js -> desktop/build/tray-*.png, copied by sync-shared
- tray.html card, start.html (starting / error / welcome), main.js wiring, preload; loading/error.html deleted
- review-shots: desktop-start-*, desktop-tray-*, desktop-tray-icons.png; desktop-core-qa tray checks use the card

## Next
- wait for Review screenshots, Test, Desktop protections on 9b35429; read the PNGs (incl. core-install first-start, tray-card)
- see the new tray test fail on purpose (break protection.js), merge origin/main, full run on final commit
