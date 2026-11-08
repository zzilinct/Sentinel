# bar-2 (spot 2: protection state)

Goal: one board for every guard on Live protection (app.js protectionView), one line each, real state, grouped by what
it guards; headline uses the same rules and words as desktop/src/protection.js (branch work/e2e-bar-3). Outside the
app: "Open this page in the Sentinel app", never "Needs app"; app signed in to the account is read from /account/sessions.

Plan: web/assets/js/guards.js (pure, SentinelGuards.board) + tests/guards.test.js; protectionView/renderBoard in app.js
replace the four feature cards, the live meters, the live panel, the browsers and "This computer" switch wall, and the
exposure / your sites / chat / texts panels; CSS .guard*; CI check scripts/verify-web/49-protection.js with shots.
Status: started.
