# Bar update, spots 3 and 4 (tray, launch and first run)

Branch work/e2e-bar-3. One protection state (desktop/src/protection.js) feeds the tray icon, tooltip, right-click
menu, the tray card (pages/tray.html) and the start window (pages/start.html, replacing loading.html and error.html).
notify() has one gate and one queue (desktop/src/notes.js): nothing over a full-screen game or video.

## Round 1 (graded under the bar), fixed in round 2
1. Unavailable protection showed a gold switch, count left it out: now off + disabled + reason; gold only when state
   'on'; count is "N of 5 running". review-shots check seen FAIL on the old card (run 42134705981), then fixed.
2. Dark title bar: titleBarStyle hidden + titleBarOverlay in the page's colour (sentinel:frame from the page),
   36 px drag strip injected into every app page (FRAME_CSS/FRAME_SCRIPT in main.js; site pages move .nav down),
   start.html has its own strip. core-qa 'title-bar' PASS: hit test strip 2, max 9, close 20, logo 1; drag moves,
   maximise/restore by real clicks.
3. Welcome fits 720 px (side notes hidden under 700 px tall); review-shots asserts the primary button on screen.
4. Card switch now pushes sentinel:settings; download protection pushes when it really starts/stops.
   core-qa tray-downloads-app-follows / -back PASS.
- Window sized a few px inside the work area (Windows draws a 1 px border outside a hidden-title window);
  desktop-e2e-lib Qa.Windows now measures DWM frame bounds.

## Where I stopped (paused by the owner)
- Final commit ba5b4a5 (merge of origin/main 1.19.4, frontListen now sets frontApp for offers) is pushed.
  Its full CI run was started; I stopped waiting on it. Not yet seen.
- Previous targeted run (fad795f's parent 7c...) left: first-window and scale-125 failing only by the border
  (fixed by the 4 px edge in fad795f), island-pause and menu-in-30mb-one-start (flaky, seen passing before).

## Next
- Read the ba5b4a5 run: Desktop protections (first-window, scale-125/150, title-bar, tray-*), Review screenshots,
  Test, verify, live, checkup. Download and look at core-install 01-first-start, title-bar, tray-card shots.
- Report: start with what I got wrong (shipped a named truth bug; skipped the title bar; did not fit 720 px; one-way
  switch sync) and what I learned (a named weakness that breaks the bar is a fix, not a footnote).
- Web flakes (galaxy, guest double press) are being fixed on another branch; the CI-runner black rectangle round
  cards is the runner, confirmed by existing warn-card shots.
