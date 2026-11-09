# Spot 5, website colour preview (work/e2e-c-rainbow) - PAUSED

## Done (pushed)
- web/assets/js/accent.js: accent table (Ruby, Amber, Gold, Emerald, Sapphire, Indigo, Amethyst) in one place; non-gold
  tones derived from gold's hand-tuned hexes at gold's luminance (light text tones capped to 4.6:1 on #efe8da);
  injected stylesheet beats lux/hover theme rules; radiogroup with arrows; view transition circle on pick, gold band
  sweep on return (after scroll stops), instant under the tab wipe and on hidden tab / bfcache; skipTransition on 2nd click.
- #colour section in web/index.html (after #everywhere); styles at end of home.css (phone: view above gems).
- lux.css --btn-grad/--btn-grad-hover, hover.css --gilt replace gold literals in .btn--gold, chip-q, gilt hover.
- tests/accent.test.js (in npm test); scripts/verify-web/49-colour.js (check `colour`).
- Seen fail: CI run 42707291098 caught a real bug (2nd click swallowed by the VT overlay), fixed with
  pointer-events:none on ::view-transition. Node light-contrast test fails when LIGHT_CAP is removed.

## In flight
- CI run 42709259498 (checks=colour) on the latest commit was still QUEUED (runner contention). Not seen yet.

## Next
1. Read the run's result and screenshots (gold shot now waits 1.5s for the heading; opening shot paused at 90ms;
   phone layout with view above gems is unverified).
2. Full CI run on the final commit, then the report (weakest: gems pastel in dark because luminance-matched; Ruby/
   Emerald sit near warning red/clear green, only the preview says warnings keep colours; gold itself is 4.39:1 in light,
   pre-existing, untouched; copy does not mention the Windows app since spot 1 is not merged).
