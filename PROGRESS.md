# bar-2 (spot 2: protection state)

Done: web/assets/js/guards.js (pure board; headline mirrors desktop/src/protection.js on work/e2e-bar-3, parity test in
tests/guards.test.js runs once that file is merged) + app.js protectionView/renderBoard/renderAway + .board/.guard CSS;
old cards, meters, live panel, switch wall, exposure/sites/chat/text panels deleted; Overview teaser reads the board;
CI check scripts/verify-web/49-protection.js; desktop-core-qa.ps1 / desktop-e2e.ps1 moved to data-guard selectors.
Round 1 CI (42529629609): 13/14, phone+app-signed-in case fixed. Round 2: eb7de47, dispatch 42530557037 (protection),
push runs desktop-e2e 42530530106, review shots 42530530238, test 42530530157.
Round 2 dispatch: 15/15 protection checks pass, shots read. Final commit 67c48e3: all push workflows running (one
background wait). live-e2e failed on 99ad97d with 'Run keys are still polled' (defense, not touched here); recheck.
Next: read results, report.
