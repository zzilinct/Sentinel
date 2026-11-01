# Spot 11, phone home hero: where I am

Paused at the owner's usage limit. Branch work/e2e-bar-11, merged with origin/main (1.19.2).

Sent-back round, three items and the blob fix:
- Blob fix in scripts/verify-web/01-site.js: committed.
- Button on the first screen: niche height is now 100svh minus the stack (home.css), the button comes before the lede, the Preview banner's second sentence is hidden on phones. Last result: 390, 412, 430 passed; 360 and 768 missed by 13 and 19 px. Formula since changed, not yet proven.
- Desktop reduced motion: panel drawn on the page in the page's ink, a soft oval, no seam or hard edge, two whole warnings. Pills not yet looked at.
- Memory: niche capped at 1.8x, under/trail/haze freed once drawn; hero-phone asserts both.

Next:
1. Read hero-phone run 41348882681 on the latest commit (dispatch `checks=hero-phone`, cheap). Fix any FAIL.
2. Look at hero-desktop-light-still, hero-desktop-dark-still, and 360, 390, 768.
3. Full CI on the final commit (a push runs it), one background wait. gh rate limit is shared: wait long, poll rarely.
4. Report. Start with what I got wrong and what I learned: buried the Download button in a sub-point; called a known-ugly state "not good before"; quoted 2.8 MB for one canvas when the page held about 5.7 MB; compared 0.8 MB the same way (old total about 1.7 MB).

Also note in the report: the desktop brush's address line is now underlined, not struck through (shared `warning()`). 320x568 does not fit the button; hero-phone exempts it. The Download button may be disabled in the Preview build: check before claiming it works.
