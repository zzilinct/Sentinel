# Spots 19 and 20, brand and trust (work/e2e-c-brandtrust)

Built on origin/work/e2e-c-settings (merged in), so Your data and Help sit in its Settings home.

## Done
- Brand: scripts/make-icons.js rewritten. It fills the logo paths from web/assets/js/masks.js (shield + helmet) in
  brand.json `mark` colours (= sentinel.css --gold-300/400/500). Small mark (solid shield, helmet cut out) at <= 32 px
  and in favicon.svg. Writes extension icons (also the desktop app icon and tray via sync-shared), web icon-192/512,
  icon-maskable-512 (manifest: separate any and maskable), og.png, desktop/build/icon.ico, installerSidebar.bmp
  (electron-builder picks it up by its default name). `--check` in tests/brand.test.js. Emails carry icon-192 and the gold.
  sw.js cache bumped to v8 so returning visitors get the new tab icon.
- Trust: POST /api/v1/account/export (password, rate limit, audit). tests/export.test.js: rows equal privacy.html
  section 3 row for row; no secrets; other users absent; false_alarm never promotes or counts in knowledge.js.
  Settings groups 'data' (download, history link, forget exposures / my sites, delete) and 'help' (what changed from
  /download's release note, false alarm form with optional trust, support mail). Verdict report form offers
  "It is safe: Sentinel got this wrong" on flagged results. privacy.html and terms.html point to Settings, Your data.
- scripts/verify-web/48-settings.js: shots settings-data-*, settings-help-*, brand-marks; checks for the groups,
  export (wrong password, then a dated file), false alarm + trust.

## Next
- CI all green on 211d6c8 (full run + settings run 42895125773). Shots read. Reported. Open: consent checkbox indent on phone, 16 px eyes.
