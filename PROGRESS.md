# bar-5 (spot 5: Overview and page tops)

Base: work/e2e-bar-1 (Check page, four-group sidebar).
Done: Overview = greeting, box, at most one notice (allowance under a quarter, or gone), one card (guard line + week
headline); offers moved below Recent scans; sidebar card = the scarcest allowance only; slim email bar; Your week rows
without "last week", this week's bar an outline "So far"; scanbox icon sized by `.scanbox > svg` (AI padlock);
Overview mask not added on phones, models fetched after load + idle on computers; Plan rows: no meter when locked or
unlimited. Deleted protectionTeaser, old weekCard, the four-row usage list on home, the last-week glow.
Check: scripts/verify-web/48-overview.js. Seen failing on old code: proof/bar-5-old run 42529636769 (11 of 14 fail). New code: run 42533293115, 77/77 (overview, layout, appcore).
Next: final full run on the last commit (perf-a11y proves mobile /app), read PNGs, report.

PAUSED (owner asked). Final commit 8232a1d pushed. CI on it: Test, Review screenshots (week asserts pass), Live
scanning, Browser checkup: success. verify-web: verify job success (overview check included); features job 221/223,
the 2 failures are auth-shell (slow sign-in press), a sign-in page I did not touch (login.html loads app.css, though);
rerun dispatched: run 42539240498 (checks=auth-shell). Still running at pause: perf-a11y (proves mobile /app
Lighthouse >= 95 now the mask is not fetched on phones), companion-soak, Desktop protections 42534245976.
Next on continue: read 42539240498 and perf-a11y results (mobile /app, desktop /app scores); if auth-shell fails
again, diff app.css effect on /login; then report. Proof branch proof/bar-5-old (old code + check) on origin, delete
after review.
