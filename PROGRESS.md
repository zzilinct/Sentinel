# Spot 12, Settings home (work/e2e-c-settings), PAUSED

## Done
- Merged origin/work/e2e-bar-1 (conflict in app.js check box: took bar-1's; package.json test list: union).
- /app/settings (settingsView, SETTINGS rows, web/assets/css/settings.css). Nine groups; 'look' and 'motion' are the
  slots for the design and motion builders (window.SentinelTheme get/set added in boot.js).
- Moved out: every switch in renderDesktopControls, the week note in weekView, chat/text safety, Your sites, parent
  lock, securityView (now account rows). Old CSS (.setting, .live__auto, .my-sites__add, .muted.is-down) deleted.
- Aliases in render(): /app/security goes to #account; /app/protection#chat-safety, #text-safety, #parent-lock,
  #my-sites go to their row. Unknown hash is ignored.
- Side bar: Account group replaced by one Settings link. The palette finds single settings.
- tests/settings.test.js (seen failing when a setter is removed from the rows); scripts/verify-web/48-settings.js
  (added to the features job). checkroute, routes and verify-web page lists updated.
- Targeted CI run 42709515415 (settings, layout, accounts, appcore): 115/115 passed. Screenshots read:
  settings-home/search/none/noapp, desktop and phone, light and dark.

## Next
- Full CI on 55bd3da was started by the push; the wait was stopped at the pause. Check:
  gh run list --commit 55bd3da1593dc91175d334f114aab03da96eafa2
- Then write the report: weakest parts are the side bar theme button sitting beside the Appearance row (left for
  c-design), desktop/src/main.js notifications still opening old /app/protection#... addresses (the aliases handle them),
  chat and text status lines not read out by screen readers, and the `/` key not going to the settings search.
