# c-motion (spots 6 + 7: scan effect toggle, Motion Full/Calm/Off) - PAUSED

## Done (pushed; HEAD = "Motion: Calm also stills the app's mist...")
- boot.js: SentinelMotionLevel {get,set,scanEffect,setScanEffect,system,control}; sets html[data-motion|data-scan-effect]
  before paint; system reduced motion = Off, locked, "Your computer asks for less motion, so Sentinel follows."
- Web JS/CSS read only data-motion (all prefers-reduced-motion reads removed except boot.js and vendor lenis);
  Calm block in sentinel.css stops self-moving loops; mask3d src + rebuilt mask3d.js; intro is Full only.
- binary.js: level() from attributes; Off/scan effect off draws nothing; Calm = half digits, 3x slower tick, no band.
  (Diagnosis a029 was wrong: binary.js has no opts.density any more, removed in d5ae289.)
- Desktop: IPC sentinel:motion (preload setMotion) -> store motion/scanEffect -> overlay:motion; overlay.html applies;
  warn/guard/filescan cards get ?motion= (card.js).
- Companion: motion setting (options select; serp/hover/webchat/alarm use :host([data-motion])).
- Control lives temporarily in Live protection (data-motion-slot); c-settings can append SentinelMotionLevel.control().
- tests/motion-level.test.js (seen failing on mutation); scripts/verify-web/49-motion-level.js in features job.

## CI
- Commit 1: Test pass, Review shots pass; verify-web motion-level: 6 fails, cause found: the check clicked the
  sr-only radio instead of its label, and Calm missed .lux-atmos::before (lux-mist). Both fixed in HEAD.
- Screenshots read (run 42709113175): desktop dark and phone light locked look right.
- Runs queued on HEAD (not yet read): verify-web targeted 42711771439, full verify-web 42711758101,
  Test 42711758090, review-shots 42711758462, live-e2e 42711758138, desktop-e2e 42711758840, checkup-e2e 42711758140.

## Next
1. Read results of the runs above (one background wait); download verify-web-features, look at motion-*.png
   (desktop/phone, light/dark, locked, and the row now says "Animation").
2. Fix any failure; full run on the final commit; report per builder.md.
Weak spots to name: chat.html/loading.html/snip.html and companion pages (popup/options/block/sentinel.css) still
follow only the system setting; mask3d/galaxy/glyphs read the level at load (change applies on next page);
overlay calm is only a lighter dig.
