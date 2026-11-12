# c-onboard (spots 14 and 17)

Branch work/e2e-c-onboard, based on origin/work/e2e-c-settings.

## Commits
- 3f7c53e: the work.
  - Full CI ran on it. Test, Desktop, Live, Checkup and Review screenshots were green.
  - In verify-web, only the features job failed, on two auth-shell asserts about a slow sign-in. Those passed on the targeted re-run, so they were a timing flake.
- e7429bd: two fixes and a wider check.
  - In the side bar, a name that wraps at Larger now grows its row instead of crowding the next one. At larger text sizes the search button drops its Ctrl K hint.
  - The check gained a `crowd` measure and the Windows-app tray-line case.
  - Targeted run 43119896680 (first-choices and auth-shell): 27 of 27 passed.
  - Full verify-web dispatch 43120630487 was running at the time of writing.

## Row ids
The ids are confirmed with the other builders: accent, theme, motion, warn-level, text-size. `FIRST_CHOICES` in app.js uses these ids.

## Left
- The `crowd` measure was added after the crowding was seen in the 3f7c53e screenshots. It has not been run against the old CSS.
- The companion popup gets no text size until sync (spot 13).
