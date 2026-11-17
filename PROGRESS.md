# r1203-speed: paused

Branch `work/e2e-r1203-speed`, last code commit af86b20 (on origin/main 1.20.2 via merge 34ea875). Items 2 and 3 of
`.arena/round-1.20.3.md`.

## Done
- Fonts: Geist 28.7 -> 24.2 KB, Geist Mono 22.6 -> 18.8 KB (`scripts/subset-fonts.py`; `tests/type.test.js` reads cmap).
- app.js split by page: core 68 KB of 270 KB; pages in `web/assets/js/app/*.js` with their own scripts/CSS
  (`tests/routes.test.js`). First-run Overview waits for Settings' file (its rows).
- Critical CSS: `server/lib/critical.js` inlines rules that can match the page's markup (7.9 KB br), stylesheets
  preloaded, body scripts deferred (`tests/static.test.js`).
- live-e2e repaint: test inbox R key, `scripts/marks-at-rest.js --repaint`. Run 44194825696 passed: -40 px repaint put
  right by a fresh read in 859 ms, flagged mark back on its row.

## CI on af86b20
Live 44194825696 success, Test 44194825440 success, Desktop 44194825502 success, Checkup 44194825455 success, Review
shots 44194825749 success. Verify-web 44194825461 was still running at pause (34ea875, same web code, passed: 44184416289).

## Perf (mobile /app, 5 rounds, medians, 8cc3761 = current web code)
- vs main (1.20.2) 44173562914: score 91 -> 92, LCP 3303 -> 3352 ms, FCP 1948 -> 1407 ms, 331 -> 294 KB.
- vs r1202-merge 44173567936: 89 -> 91, LCP 3525 -> 3429, FCP 1991 -> 1420.
- Split alone (bbf9053) measured 95 / LCP 2557 vs r1202-merge (43790375665) but 91 vs main (43790373092): bimodal.

## Next
1. Read 44194825461 result.
2. LCP did not improve with critical CSS + defer (FCP did). Find why the LCP chain lengthened (app.js waits on
   `styled`; HTML grew to 11.7 KB) before calling it done; rerun perf_base 5 rounds.
3. The settle path itself was not exercised in a real run (the reader corrected by a fresh read); the "back" step
   corrected in 76 ms, likely a read already due.
4. Report per `.arena/bar/builder.md`.
