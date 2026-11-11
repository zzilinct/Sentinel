# c-quiet (spots 10 and 11): where it stands

Resumed. Warning row id is warn-level (c-onboard). Targeted CI green: verify-web 43119623218 (settings, companion-core), desktop-e2e 43119626626 (e2e). Full run on the final commit next.

## Done (npm test 822/822 locally)
- web/assets/js/masks.js (+ extension/src/content/masks.js copy): LEVELS, level(), shows(marks, badge), warns(warnings, badge).
  Orange and red marks always show; unknown values fall back to today's behaviour.
- Desktop: store keys marksLevel / warningsLevel; main.js onThreat gates notify + showWarning by Masks.warns; IPC
  sentinel:marks-level and sentinel:warnings-level (quieter warnings need the parent lock open); tray "Pop-up warnings"
  radio submenu; status() returns both; preload setMarksLevel / setWarningsLevel; overlay.js carries the level in each
  marks payload and sends overlay:level on change; overlay.html place() skips marks that do not show (island counts and the
  scan dig still use every link; hidden marks get _cx null so hover says nothing).
- Settings rows (app.js levelRow): "Marks beside links" (Every link / Risky links / Serious only) in Live protection,
  "Pop-up warnings" (Always / Danger only / Never) in Alerts. Phone: settings segs fill the row width (settings.css).
- Companion: minimumBadge, markSafe and notifications removed; marksLevel / warningsLevel selects in options.html;
  lib/api.js levelsFrom() migration run once in onInstalled; warns() in api.js; serp/hover/webchat use Masks.shows;
  background: orange warnInPlace gated by warns, red still closed, paySign/typed check follow every flagged page.
- Tests: tests/quiet.test.js (new, in package.json), tests/island.test.js (overlay density test). Both seen failing on a
  mutation (orange dropped from shows; filter line removed).
- CI checks added: 48-settings.js (choices, save, lock refusal, fit, shots settings-marks-*/settings-warnings-*),
  25-companion-core.js (marksLevel kept after reload), desktop-e2e.ps1 (marks-serious-safe/scam, marks-every-link,
  warnings-never, warnings-back).

## Next
1. Targeted CI: verify-web.yml checks=settings,companion-core; desktop-e2e.yml only=e2e. One background wait each.
2. Read the PNGs: settings-marks/warnings desktop+phone light+dark, companion-core-options-*, marks-serious-*, warnings-never.
3. One full run on the final commit; report per builder.md.

## Known weak points
- Judge's label "Just note it in History" was not used: live-scanned pages are not written to History (live/visit does
  not record), so "Never" says the page is marked in the corner only.
- Companion users who had turned off notifications get the red background-tab notification back (migrates to Always),
  chosen so no in-page warning is lost.
- Hidden marks vanish instantly (as marks leaving always did); the delicate dig still tints safe links green briefly.
