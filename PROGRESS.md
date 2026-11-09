# c-motion (spots 6 + 7: scan effect toggle, Motion Full/Calm/Off)

Done (1b55e93): boot.js SentinelMotionLevel + html[data-motion|data-scan-effect]; web JS/CSS read only that;
binary.js calm/off; mask3d rebuilt; desktop main/preload/overlay IPC `sentinel:motion` -> `overlay:motion`;
companion `motion` setting (options select, serp/hover/webchat/alarm :host([data-motion])); control in Live protection;
tests/motion-level.test.js; scripts/verify-web/49-motion-level.js (features job).
Waiting: verify-web 42709113175 (motion-level,motion,calm-dig), Test 42709092666, review-shots 42709092673, live-e2e 42709092680.
Next: read motion-*.png, fix, full run on final commit, report.
