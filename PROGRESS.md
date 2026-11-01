# Spot 13, Is this call a scam: paused

Branch `work/e2e-bar-13`. Graded under the bar once; rework is committed and pushed.

## Done since the grade
1. Public `/call` page (web/call.html, assets/css/call.css), no account. /app/call redirects there. Gone from app.js, app.css, app.html.
2. Ticks kept for the tab in sessionStorage, restored after the recovery guide and Back.
3. Landline line is inside the answer's next step.
4. The panel springs both ways on a plate behind the words; 09-call.js steps the animation and saves call-spring-{grow,shrink}-*.png.
5. Hang-up signal mutated: the paypause unit test failed as it should. Browser half not read yet.
6. Chip labels shortened; a check says no more than two lines at 390 px.
7. Bytes: not measured yet. Every /app page drops callcheck.js and the call CSS.
8. No banner on /call; signed-in scrolled state is checked, screenshot call-phone-signed-in-scrolled.

## Runs to read when resumed (they may have finished)
- 41345319135: `call,qa-web` on 4c59bc8.
- 41345315526: proof branch `bar-13-proof`, signal fires on every tick. Expect the "once for each time" check to FAIL.
- Full push runs on 4c59bc8: `gh api "repos/zzilinct/Sentinel/actions/runs?head_sha=$(git rev-parse 4c59bc8)"`.

## Next
- Read those results. Fix what is mine. perf-budget floors for /call are guesses: set them from the measured scores.
- Look at spring frames, both directions, and the phone/desktop shots in both themes.
- Delete remote branch `bar-13-proof`.
- Measure bytes against 6b09d28.
- Report, opening with what I got wrong and what I learned.

## Not yet proven
- Tray to /call in the Windows app (desktop-core-qa regex changed, not seen passing).
- That /call and its CSS come in lighter than what was removed.
