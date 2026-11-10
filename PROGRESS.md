# Spot 18 (companion settings and popup): paused

Branch work/e2e-c-companion, based on origin/work/e2e-c-design (0042ec6), not on c-settings. Why: settings never touches extension/, and merging design into settings conflicts in app.js, boot.js and package.json. Those conflicts are the design builder's integration to do, not this spot's.

## Done (commit "Companion: the look on every page of its own...", pushed)
- background.js: a `look` message. It asks the Windows app (127.0.0.1:47821/api/v1/look), merges the result with what is kept, applies a `change` from the settings page, and keeps it with keepLook. The popup's own fetch is deleted.
- lib/api.js keepLook: it does not write when the look is the same, so pages are not woken for nothing.
- lib/lookhere.js (new): runs on the popup, settings and block pages. It asks the worker, keeps the look in localStorage, has one storage.onChanged listener, and repaints when the system scheme changes while the mode is Auto. The coin reveal and the crossfade are skipped under reduced motion.
- Settings page: a Look group at the top (Theme and Colour radio groups, coins taken from look.js ACCENTS), with the coin CSS in options.css and the view-transition CSS in popup.css.
- options.js: a switch that fails to save now springs back and says "That change could not be saved." a089's storage.local fallback was NOT done. Reason: it needs all 6 storage.sync readers changed, hover.js among them, and hover.js belongs to c-hover.
- tests/companion-look.test.js (in the npm test script): danger, warning and safe tokens are byte-identical (a087). I have seen it fail when one red byte changes.
- scripts/verify-web/50-companion-look.js: Chrome check plus `verify-companion-firefox.js --look`, which takes 8 Firefox photos.

## Next
1. Read the result of dispatch run 42906027513 (verify-web, checks=companion-look). It was started before the pause. Do not poll it in a loop.
2. Download the verify-web-features artifact and look at companion-look-*.png, Chrome and Firefox, dark and light. Watch for the Firefox switch thumb (::before on a checkbox).
3. Fix whatever the photos show. Then run one full CI run on the final commit and write the report.
