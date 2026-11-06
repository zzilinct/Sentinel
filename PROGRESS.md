# CI health (branch work/e2e-ci-health): where it stands

Paused by the owner. Main 1.19.4 is merged in. Nothing merged, bumped, tagged or published.

## Done, with causes and proof

| Check | Cause | Fix | Proof |
|---|---|---|---|
| core-use `msedge-honest-checked` | Check race: the next address was typed while the page before was still moving (PayPal's sign-in redirects itself about 4 s in; Coinbase; Chase's prompt), so the visit was cancelled or the keys were swallowed and Edge stayed put. watch.log in runs 42103668301 (both attempts) and 41158225281 shows the last page read was the previous site for the whole 40 s. | `Visit` reads Edge's address bar (UI Automation) 2 s after Enter and types again when it is not on the site; 40 s count from the Enter that took; a miss logs the address bar and the last watch.log lines. | Run 42132275676: 4 rounds, 40 of 40 checked; the retype fired twice (empty address bar after Wikipedia and after Chase). Broken build (watch.js skipping 3 hosts), run 42125902390: FAIL 7 of 10. |
| core-use `pay-pause-leaves-with-page` | Outside site: Amazon answered the runner with its robot check (amazon.com/checkpoint) in all 3 failing runs I could read (42093391802, 42097773667, 42109042858), and in none of the passing ones. | When Amazon shows the robot check (never answered), the same visit goes to the giftshop.test stand-in. | Passes in 42125822580 and 42132275676. Broken build (askPause returns early): FAIL in 42125902390. |
| qa `menu-in-30mb-one-start` | Check race: it counted main processes as "Sentinel.exe without --type=", and WMI gives no command line for a process that is ending; the result window's page process was ending (the card is closed just before this check, the only case that does that). The detail line re-evaluated, so it printed "0, 1" beside FAIL. | `MainProcs`: a main process is one no Sentinel started; the check is judged once and lists the processes when it fails. | 42125822580: 23 one-start checks pass, 3 rounds. Broken build (second start stays 30 s): every one-start check fails. |
| verify `public` double press | Real product bug: a second press that arrived after a fast answer scanned again and spent a second guest scan ("7 of 10" with no flash in every failure). | guest.js and the app's link scan treat the same address pressed again within 600 ms as the same press; the check presses 250 ms apart, as a person's double press. | 42125813013: 5 of 5 pass. Old guest.js, run 42125905787: 3 of 3 fail with "7 of 10". |
| verify `share-odd` two shares | Real product bug: the first share's page could take the second share out of the box, leaving the second share's page with "Nothing is waiting" (failure state: at /app/share, box empty). | sw.js redirects to /app/share?box=time; the page takes only its own share, and leaves a newer one for its page. | tests/share.test.js (fails on the old share.js); 42125813013: 5 of 5 pass. |
| perf-a11y mobile /app and /signup | The third Lighthouse go dropped the one-process flag and lost its trace every time (5 of 5 saved reports), so a page got two goes; the kept report was the last go's. The swing on /app is real page behaviour: Lighthouse's simulated LCP counts every request finished before the text paints, and whether mask3d.js (147 KB) has finished first is a race (go 1 and 2: 84 with LCP 4177 ms, go 3: 90 with 3373 ms, same element, run 42125819341). /signup 26 was not reproduced (10 of 10 at 98 to 99). | Every go keeps one process; the best go's report is kept; each go logs its LCP element and benchmark. Dispatch inputs perf_pages and perf_rounds. Floors unchanged. | 42125816314 and 42125819341: 20 measurings, all pass; mobile /app real number 89 to 94, and 84 when mask3d.js lands first. |
| reader-cost `roblox-read` | Real product bug in chatwatch.js: a Roblox look that found words but no chat message was final; the chat box's picture then never changed, so the messages on screen were never read (run 42130649691 attempt 1: 0 messages, recogniser ran 0 times in the next 45 s). | 'chat closed' brings another look 5 s later, then 10, 20, 40, at most one a minute. | 42145330573, 42145333432, 42145336630: 3 of 3 pass, 2 messages read. Not forced to fail: the bad OCR frame cannot be made on demand. |

Desktop workflow: dispatch input `only` is now a comma list of jobs, with `repeat` beside it.

## Next

1. Full run on b406112 (pushed, every workflow) was started; read its results.
2. Desktop full run on b28c6f8 (before the merge) passed. Its website verify job failed once on a new flaky check:
   `layout: app-history` caught a usage tile mid-transform (scale 1.009) at 768x1024 dark, run 42138288529. Not
   looked into yet.
3. Final report to the coordinator.
