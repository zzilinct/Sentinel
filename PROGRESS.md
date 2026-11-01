# Spot 14, downloads and files: paused

Branch work/e2e-bar-14, HEAD 4862e98 before this note. Code tree equals 3e8ef10. No code work is unfinished.

Second-round grade items, all done in code:
1. Sign-in offer hidden where signing in cannot help (not checked, empty).
2. A signature names who signed and clears nothing. Downloads keeps the colour. Defense keeps the colour, logs it as noted with the publisher, still takes no action on a guess, and does not count it clean.
3. Strip check mutated (run 41345583314): 4 of 32 failed, strip proportion, green strip beside a warning, sign-in on none and on empty. Reverted.
4. downloads-desktop-light and downloads-phone-dark opened on 3e8ef10 (same tree as HEAD). filescan card now follows the app's chosen theme, else Windows. Warnings over web pages stay dark on purpose.
5. ZIP64 directory is read. A list out of reach, and rar, 7z, gzip, say "could not see what is inside" and are not green.

CI on 4862e98 when paused:
- Test: success.
- Browser checkup: success.
- Live scanning: failure, outside cause. Sentinel 1.19.2 was published at 20:25 during the run and the app under test updated itself at 20:35, in the idle minute (app.log: "updating to 1.19.2 by itself"). It will repeat while the branch is on 1.19.1.
- Desktop protections (41346305505), Website (41346305554), Review screenshots (41346305604), Evaluate (41346352910): not finished when paused.

Next:
1. Read those four results. Fix what is mine.
2. Open the desktop-qa pictures for the final commit, including 31-menu-in-30mb.
3. Live scanning: find a way to keep the app from updating during the test, or report the outside cause as proved.
4. Send the report, starting with what I got wrong and what I learned.
