# Spot 12, Settings home (work/e2e-c-settings)

Done: merged origin/work/e2e-bar-1; /app/settings (settingsView, SETTINGS rows, web/assets/css/settings.css);
switches moved out of renderDesktopControls, weekView; securityView became account rows; aliases in render()
(MOVED_TO_SETTINGS, /app/security); side bar Account group is one Settings link; palette finds single settings;
tests/settings.test.js; scripts/verify-web/48-settings.js (in the features job list).

Slots: group 'look' (accent picker, window.SentinelTheme get/set in boot.js), group 'motion' (motion builder).

Next: read CI screenshots settings-*; fix what they show; full run on the final commit; report.
