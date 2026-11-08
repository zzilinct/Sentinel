# bar-5 (spot 5: Overview and page tops)

Base: work/e2e-bar-1 (Check page, four-group sidebar).
Done: Overview = greeting, box, at most one notice (allowance under a quarter, or gone), one card (guard line + week
headline); offers moved below Recent scans; sidebar card = the scarcest allowance only; slim email bar; Your week rows
without "last week", this week's bar an outline "So far"; scanbox icon sized by `.scanbox > svg` (AI padlock);
Overview mask not added on phones, models fetched after load + idle on computers; Plan rows: no meter when locked or
unlimited. Deleted protectionTeaser, old weekCard, the four-row usage list on home, the last-week glow.
Check: scripts/verify-web/48-overview.js. Seen failing on old code: proof/bar-5-old run 42529636769 (11 of 14 fail). New code: run 42533293115, 77/77 (overview, layout, appcore).
Next: final full run on the last commit (perf-a11y proves mobile /app), read PNGs, report.
