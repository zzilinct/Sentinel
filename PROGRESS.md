# c-simple (bar 2, spots 8 simple mode and 16 polish of states)

PAUSED (coordinator, usage limit). Built on origin/work/e2e-c-settings. Not yet run on CI: no run IDs.

Done (uncommitted work now committed, untested in a browser):
- boot.js `sentinel:simple` sets `html[data-simple]` before paint; `window.SentinelSimple {get,set}`.
- Settings row `simple-view` (group look, kind switch, save via SentinelSimple). 48-settings counts app switches only.
- app.html `data-full` on Site rules, Browser checkup, Your week, side labels, model badge; app.js `FULL_ONLY`
  palette filter with a final "Show all pages" row (keep: stays open); search still finds every page.
- ui.js verdict: `Show details` button (simple view only) toggles `.is-full`; app.css hides `.reasons`,
  `.result__more`, sibling `.actions`; bigger h2/lead/steps. `.result__partly` and `[data-not-run]` never hidden.
- ui.js `stateBlock(kind, text, {title, action, small})` (waiting, clear, nomatch, unavailable, error, offline;
  onyx mask + seal, design from work/e2e-bar-17). api(): fetch TypeError -> `err.offline`, event `sentinel:reach`.
- app.js `failed(slot, err, retry, {small, what})`: error/offline block with Try again running that part's loader;
  offline parts reload on `online`; focus to new Try again only after Try again. netbar under the top (app.html).
- Replaced every `banner--error` and inline `class="empty"` in app.js (boot, scan error, history, sites, models,
  intel, sessions, assistants, week, home recent, QR picture). Palette recent-history failure now said.
- Kept silent on purpose: weekCard and askChatSafety (optional offers; netbar covers offline). Say so in report.
- Found: `.skeleton` referenced keyframes `shimmer` that never existed (static). Removed the dead animation; block
  skeletons show "This is taking longer than usual." after 8 s (CSS delay, no timer). Deleted lux-float (app-lux.css).
- markLists moved from 47-honest-result.js into _shared.js. 19-qa-web, 21-appcore look for the new error words.
- New CI checks: scripts/verify-web/49-simple.js (`simple`), 49-states.js (`states`). npm test: 817 pass.

Next on continue:
1. Add `simple,states` to verify-web.yml features CHECKS default list.
2. Add tests/states.test.js (pure Node): no `banner--error`/`class="empty"` in app.js; no html[data-simple] rule
   hides result__partly, data-not-run, next-steps, real-site. Add to package.json test. Break it locally, see it fail.
3. workflow_dispatch verify-web.yml checks=simple,states,settings,honest-result,appcore,qa-web; one background wait.
4. Download PNGs (simple-*, states-*), look; fix; then one full run on final commit.
5. Measure bytes (normalize CRLF): roughly app.js +3 KB, ui.js +3.5 KB, app.css +5.5 KB, boot.js +1 KB.
6. Report (under 400 words). Weakest so far: skeleton min-heights not matched to content; slow note has no Try
   again until the 75 s timeout; simple view covers sidebar, palette, results, history filters only.

## Resumed 11/11
- Coordinator asks: waits as tall as content (done: app.js skel/keep, remembered per device and width; first-time
  heights in app.css .h-*, to tune from the states check's "heights:" log line), and week card / chat-safety offer
  fail as one quiet line with Try again (done: failed(..., { quiet })).
- tests/states.test.js added; seen fail locally (hid result__partly, dropped keep week): 2 fail, restored: pass.
- Targeted run 43120139219 (simple,states,settings,honest-result,appcore,qa-web) on 0cb... pending.
