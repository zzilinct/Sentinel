# Bar update, spots 3 and 4 (tray, launch and first run)

Branch work/e2e-bar-3. One protection state (desktop/src/protection.js) feeds the tray icon, tooltip, right-click
menu, the tray card (pages/tray.html) and the start window (pages/start.html, replacing loading.html and error.html).
notify() has one gate and one queue (desktop/src/notes.js): nothing over a full-screen game or video.

## Done (commit 9b35429)
- protection.js + notes.js + tests/tray.test.js (in npm test)
- tray icons in scripts/make-icons.js -> desktop/build/tray-*.png, copied by sync-shared
- tray.html card, start.html (starting / error / welcome), main.js wiring, preload; loading/error.html deleted
- review-shots: desktop-start-*, desktop-tray-*, desktop-tray-icons.png; desktop-core-qa tray checks use the card

## Round 1 CI (9b35429)
- review-shots: tray card too tall at 150% (fixed: off rows one line, tighter rows); start page cut its top on small windows (fixed: margin auto)
- core install: ports-all-taken looked for error.html (fixed: start.html); core use pay-pause-leaves-with-page failed (not mine, pay pause)

## Round 2 CI
- 0155eef: all green except review-shots (welcome focus scrolled the top away on small windows): fixed in the final commit
- final commit: review-shots, Test, live, checkup green; desktop qa (right-click filescan), verify galaxy and perf-a11y failed, all
  passed on 0155eef and untouched by the last change (one focus() line): reran the failed jobs

## Next
- report; wait for the reviewer
