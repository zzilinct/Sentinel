# Bar spot 6, sign-in pages: where I am

Paused for the owner's usage limit. Branch work/e2e-bar-6, latest work commit 29841a1. origin/main (1.19.2) is merged in.

## Done on the branch, sent back items 2 and 3 and the first part of 1
- Server redirects someone signed in from /login and /signup before any of the form (server/index.js); the client /auth/me call is gone. Tests: tests/api.test.js, plus a browser step in auth-shell.
- The 12-hour limit is back in the Stay signed in hint, with a test.
- `.scanbox` now has the same 3:1 edge as fields (found while looking at app forms).
- Looked at app forms from review-shots of dc7f3b8 (Email, Text, Security, AI assistants, Link scan, Is this call a scam): fields read clearly. The Link scan box was the one that still looked faint, hence the fix.

## Waiting for, on GitHub (runs finish without me)
- Run in .arena is not needed: read `gh run list --branch t-bar6-g` for the instrumented galaxy run, six repeats of the check; artifact verify-web-features, report.json, the "click enlarges" results carry a `log` of pointer events and held/boosted state in `detail`.
- auth-shell on 29841a1: `gh run list --branch work/e2e-bar-6 --event workflow_dispatch`. Not yet read.

## Galaxy so far (sent back item 4)
- Failing shot: same card still held, its tag still showing, nothing enlarged, no scroll.
- Probe of 40 hover then clicks in dark and 40 in light, on my branch and on base 6b09d28: 0 of 160 failed, on both. So my work does not show as changing it, but the probe did not reproduce the failure either. Not yet a cause.
- The real check differs from the probe: an earlier tab opened and closed, and a click about 6 to 8 s after load, during which the governor (gov.tick) may be changing the card count. Unproven.
- I read one theory and dropped it: an enlarged card sliding from under the pointer. At full size the rect still contains the pointer.

## Next
1. Read the t-bar6-g log, find the cause, fix it in one small separate commit (check or web/assets/js/galaxy.js). Then delete remote branch t-bar6-g.
2. Read the auth-shell run; check the hint's extra line keeps Sign in above the fold on a phone with Google.
3. Push a final commit without [skip ci] for full CI. Look at app forms on that commit, phone and desktop, light and dark, at full size, not only contact sheets, including Email scan, Text scan, Security, AI assistants.
4. Delete this file before the final commit.
5. Report, starting with what I got wrong and what I learned: I changed every form without looking; I left a flash the server could have prevented; I removed a true statement; I passed on a red check twice.
