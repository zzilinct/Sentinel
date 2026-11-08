# bar-5 (spot 5: Overview and page tops)

Base: work/e2e-bar-1 (Check page, four-group sidebar).
Done: Overview = greeting, box, at most one notice (allowance under a quarter, or gone), one card (guard line + week
headline); offers moved below Recent scans; sidebar card = the scarcest allowance only; slim email bar; Your week rows
without "last week", this week's bar an outline "So far"; scanbox icon sized by `.scanbox > svg` (AI padlock);
Overview mask not added on phones, models fetched after load + idle on computers; Plan rows: no meter when locked or
unlimited. Deleted protectionTeaser, old weekCard, the four-row usage list on home, the last-week glow.
Check: scripts/verify-web/48-overview.js (commit 8f8e319 alone, dispatched to see it fail: run 42528974322).
Next: commit fix, dispatch overview + perf-a11y, read PNGs, full run on final commit, report.
