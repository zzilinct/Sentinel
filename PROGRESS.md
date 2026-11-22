# r1211-ui: where it stands (paused on the owner's word)

Branch work/e2e-r1211-ui, based on origin/work/e2e-r1211-custom (23cc007). Version 1.21.1. Not tagged, not merged.

## Done
- App finds 1-10: mask room held (fixed box), top bar in --glass, reading line in the colour, Settings without the
  Windows app names its rows (no dead switches), island and relief (--hi/--lo/--relief/--night-*) in the colour,
  browser bar from --bg (boot.js), no "gold" words, side bar fits 1280x800, phone hint whole, pointer lean in
  half-degree steps, QR camera stops when hidden.
- Site finds 1-3: hero binary reveal in the colour (home.js inks()), call/download/lux/ledger literals, companion alarm
  button; the page-world alarm (pasted commands) asks for the colour on its own box, nothing stays on <html>.
- Carry: older kept colour sets worked out again on marketing pages (look.js WEB/WEB_V/webVars, look-site.js); taskbar,
  Start menu and desktop icons via Sentinel's own shortcuts (main.js shortcutIcons, desktop/src/ico.js); title bar
  "Sentinel / Overview" seen on screen; phone scroll-padding above the bottom bar.
- Sheets: vibe-sheet-home(-phone), vibe-sheet-app(-phone) from scripts/verify-web/58-vibe.js.

## Results
- npm test 916/916.
- Full verify-web on 2bf8942: run 44963944075, all four jobs green (axe included).
- desktop-e2e core-install + qa on a6b841a: run 44962695280 green (shortcuts follow the colour; first window 2.5 s).
- Last full desktop-e2e (44956987291, bd60b93) had first-window (fixed since) and one menu-in-deleted flake.

## Next
- The running taskbar button stays gold until Windows rebuilds it (next launch, unproven): prove with a qa step that
  restarts the app after a colour change.
- Phone result card under the bottom bar: no screenshot shows the bar with a result; add one (honest-result phone,
  viewport shot scrolled to the end).
- A font-swap shift of the email bar (238 to 206 px once, before the web fonts) is real and unfixed.
- One full desktop-e2e on the final commit.
