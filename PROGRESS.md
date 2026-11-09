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

- snip.html, chat.html badge and the companion's calm notes (alarm.js 'calm') follow the accent too.
- CI run 42709796653 (checks=look): 12/12 PASS. Shots read: island, card, popup good; picker was photographed
  mid-entrance (fixed in the check), card viewport too short (fixed). Re-run 42711186312.

## Paused (owner's usage limit at 84%)
- Final commit f0efb0d pushed (full CI). Done green: Test, Live scanning e2e, Browser checkup e2e.
  Still running/queued at pause: Review screenshots 42712203517, Desktop protections e2e 42712203373,
  Website/companion (verify-web, includes the look check) 42712204501. Re-run 42711186312 was cancelled.
- 784d2f4 (double-press reveal fix) is in f0efb0d.

## Next
- Check those three runs; download verify-web artifact, read look-*.png (picker now photographed after the
  entrance; card at 520x560), then write the report.
- Still gold: the companion's red-alarm "go" button gradient (alarm.js .brand .go), legal copy ("gold line"),
  installer/taskbar .ico and the popup's brand icon PNG (files, by design).
- Bytes: +20 KB raw / 7.3 KB gzip look.js in every page's head, -1.6 KB boot.js, +3.1 KB sentinel.css.
