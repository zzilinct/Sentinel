# bar-2 (spot 2: protection state)

Done: web/assets/js/guards.js (pure board; headline mirrors desktop/src/protection.js on work/e2e-bar-3, parity test in
tests/guards.test.js runs once that file is merged) + app.js protectionView/renderBoard/renderAway + .board/.guard CSS;
old cards, meters, live panel, switch wall, exposure/sites/chat/text panels deleted; Overview teaser reads the board;
CI check scripts/verify-web/49-protection.js; desktop-core-qa.ps1 / desktop-e2e.ps1 moved to data-guard selectors.
Round 1 CI (42529629609): 13/14, phone+app-signed-in case fixed. Round 2: eb7de47, dispatch 42530557037 (protection),
push runs desktop-e2e 42530530106, review shots 42530530238, test 42530530157.
Round 2 dispatch: 15/15 protection checks pass, shots read. 67c48e3: verify-web, review shots, test, checkup green;
live-e2e failed because the app updated itself to the released 1.19.4 mid-run (outside cause, log proves it);
desktop-e2e qa menu-in-30mb-one-start fails on bar-20 too (outside); texts-english-only was mine, fixed in 898eb93.
Final: 898eb93, waiting on verify-web 42539389612, desktop-e2e 42539389685, review 42539389739, test 42539389673.

PAUSED (owner). All work committed and pushed. Next on continue: read results of the four 898eb93 runs above
(gh run view <id>; desktop-e2e texts-english-only should pass), then write the report (shots already read: stopped,
partly, away, open, phone, light and dark, in run 42530557037's artifact).
