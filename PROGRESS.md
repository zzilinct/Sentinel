# work/e2e-c-design: spots 1 to 4 and 13 (paused at the usage limit)

## Where I am
Final code commit 0042ec6 (pushed): look.js deferred, boot.js draws the kept look before paint (no colour work),
account look sync (GET/POST /api/v1/account/look, newest per setting, lookRev on live-scanning answers, companion
pulls only when it moved), rainbow dark tuning adopted in the one table, ramp() takes a free hue for the preview,
privacy page says what the account keeps, card/harness fixes for the two failures on f0efb0d.

CI on 0042ec6:
- Test, Live scanning e2e, Browser checkup e2e, Review screenshots: success (island sheet read: light island on
  light and dark pages because the runner's system is light and Auto follows it).
- Desktop protections 42894145911: core (use) failed idle-cpu 1.72% (limit 1.5%). Not this work: per-process
  breakdown in core-use/run.txt shows the server utility process took 18.4 s of the 19.8 s while still importing
  threat feeds (phishing_database finished at 2002 s, inside the idle window); renderers unchanged, main +0.5 s.
  f0efb0d measured 0.27%. Re-run core (use) to confirm.
- Website 42894146059: job "verify" FAILED (not yet read: `gh run view 42894146059 --log-failed | grep FAIL`);
  features, perf-a11y, companion-soak were still running.

## Next
1. Read verify failures in 42894146059 and the features job (49-look includes the new second-device sync check).
2. Fix, re-run only what failed, read look-*.png and look-sync-second-device-phone.png.
3. Re-run desktop core (use) for idle CPU.
4. Delete this file, full CI on the final commit, report against the bar.
