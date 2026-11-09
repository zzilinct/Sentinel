# work/e2e-c-design: spots 1 to 4 (accent, live colours, island and tray, one theme)

## Done
- web/assets/js/look.js: the one table (gold + rose, amethyst, sapphire, teal, platinum), pure ramp(), metal(),
  tintBitmap(), paint(); the site's theme switch (moved out of boot.js); SentinelLook.get/set/on/picker() for the
  Settings home (work/e2e-c-settings). Copied to desktop/shared (sync-shared) and extension/src/lib (build-extension).
- Picker: temporary panel "Colour and theme" on /app/protection (app.js protectionView), view-transition reveal from
  the pressed coin (sentinel.css .look / .look-vt).
- Desktop: store 'look', IPC sentinel:look / sentinel:set-look, nativeTheme.themeSource, overlay:look message, look
  in the query of overlay/warn/guard/filescan/loading/error, tray icon tinted per accent, look.json for the server.
  appTheme() deleted; filescan's own light block moved into card.js for every card.
- Server: GET /api/v1/look (device server only, loopback only, no credentials, two words).
- Companion: popup fetches the look, caches localStorage + storage.local; popup/block/options paint before first
  paint; serp.js line, tint, pill and marks follow the cached accent.
- tests/look.test.js; scripts/verify-web/49-look.js (screenshots look-*.png).

## Next
- Read CI screenshots of 49-look; fix what they show.
- Still gold: snip.html, chat.html badge, companion alarm/guard/pwalarm/typed pages, legal copy ("gold line").
- Full CI run on the final commit.
