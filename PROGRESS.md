# Bar 15, practice inbox: paused

Work is done. The final code commit is 4ca5aad (merged with origin/main 1.19.4). Full CI was started on it, but its results have not been read yet.
This note sits in its own [skip ci] commit. Delete it before the report, with one more [skip ci] commit or a squash. The code is the same as 4ca5aad.

Already proven:
- The practice check saw a real bug fail (run 41340242412: no second look when the deal had used up every same-sign scam). It was fixed, and a unit test now covers it.
- The deliberate break (deals allowed to repeat) failed the browser check "a new inbox shares no message with the last", run 42093158426. It is now restored.
- An earlier deliberate break (no double-press guard) did NOT fail. The buttons are removed on the first press, so the guard is only a second line of defence. Say so in the report.
- Screenshots seen: phone and desktop, light and dark, of the list, open, report, verdict, end and pile. Fixed after looking: the text-sender island wording, the seal overlapping the verdict text, the "good" scam wording, and "None came down to this".

Next:
1. Read CI on 4ca5aad: gh run list --branch work/e2e-bar-15. Test, Website (verify, features, perf-a11y, soak), Review screenshots, and the rest.
2. Download the verify-web artifact. Look at the practice-*.png screenshots, and the perf-a11y result for /practice.
3. Delete this file, then push.
4. Report: bytes (practice js+css +8.6 KB gz; anime.min.js+lux.js dropped, -43.2 KB gz; net about -34.6 KB gz), the weakest thing left, and the changelog.
