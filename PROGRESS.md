# c-onboard (spots 14 and 17): paused at the usage limit

Branch work/e2e-c-onboard, based on origin/work/e2e-c-settings. Work commit 3f7c53e (pushed). CI was never looked at.

## Done in 3f7c53e
- Spot 14, text size and spacing:
  - fonts.css: the reading tokens (micro to lead) are `calc(Npx * var(--ts))`. `--ts` is 1, or 1.15 or 1.3 under `html[data-text=large|larger]`. Titles are not scaled. The companion's copy is synced.
  - sentinel.css: `--ds` (.86 under `data-density=compact`). The heights of .btn, .input, .seg__btn and .segmented follow `--ds * --ts`, with a floor of 36px (34px for controls that were already smaller). Padding of .panel, .list li and .set-row__head follows `--ds`.
  - boot.js: `SentinelType` (key `sentinel:type`) applies before first paint and tells the desktop app through `setType`.
  - New Settings rows `text-size` and `density` in the Appearance group.
  - Desktop: main.js has `sentinel:type` and `typeLevel()`, and sends `sentinel:type-level` on did-finish-load. preload and overlay-preload have `onType`. New pages/type.js, loaded by overlay, warn, guard and filescan. The overlay's `.panel__why` shows 3 lines at the larger sizes.
- Spot 17, first-run step:
  - app.js `firstChoices()` on home draws Settings' own rows. It uses `rowHTML` and `paintRow`, which are factored out of settingsView.
  - `FIRST_CHOICES = [['accent','theme'],['motion'],['warn-level'],['text-size']]`. The hooks 'accent' (c-design), 'motion' (c-motion) and 'warn-level' (c-quiet) appear once those rows exist with those ids.
  - Done or Escape sets `sentinel:first-choices`, folds the panel away and puts the cursor in the scan box. Chat and exposure asks wait while the step is showing.
  - The `trayHintShown` toast is deleted; its line is now in the step (desktop only).
- Tests:
  - tests/firstrun.test.js is in npm test. I saw it fail (3 of 5) against the base fonts.css and main.js.
  - The full npm test passed locally (817).
  - New CI check scripts/verify-web/50-first-choices.js ('first-choices') was added to the verify-web features list.

## Next
1. Check the CI runs for 3f7c53e (they were queued at pause): Test 42905929772, Website 42905929764, Review screenshots 42905929744, Live 42905929733, Desktop 42905929713, Checkup 42905929809. Download verify-web-features and read the first-* and type-* PNGs.
2. Other checks that open /app home will now see the step on a fresh account. Fix any assertions this breaks (15-layout, 19-qa-web, 21-appcore, 30-perf-a11y).
3. The step's tray line is not covered by CI (the check has no desktop stand-in). Not done: the companion popup never gets a text size until sync (spot 13) carries `sentinel:type`.
4. Report (under 400 words) per builder.md.
