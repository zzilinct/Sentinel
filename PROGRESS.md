# Bar spot 8: companion surfaces (paused)

Branch work/e2e-bar-8. Final code commit 214e129; this file is the only thing after it.

## Done
- Door: declarativeNetRequest rule for the confirmed list, session rules for red addresses, block page (src/block.*), location.replace for pages flagged after opening. Overlay path, `warned`, emoji mask, scan-first popup deleted.
- One voice: src/lib/say.js used by block page, popup and settings. Settings in Browsing, Email and chat, Password alarm, Advanced.
- Unit: 733 of 733 locally on 214e129.
- Browser, chosen checks on the commit before last: all pass except the known case below. Firefox door passed (0 requests, moz-extension block page).
- Mutation seen failing: empty door rule, run 41332508347, five companion-door checks failed.

## Waiting on
Full CI on 214e129: Test 41348129571, Live 41348129559, Review 41348129534, Checkup 41348129531, Desktop 41348129551, Website 41348129554. The wait was stopped by the pause; the runs themselves continue. A full run has not yet been read on any commit.

## Next
1. Read those six results. If a push of PROGRESS.md started new runs, cancel them (the code is unchanged) and judge 214e129. Fix any failure.
2. Download verify-web-features and look again at: popup clean light/dark (Check again now quiet), block desktop/phone (title now 34 px max, from the scale), settings. These changed after the screenshots I last read.
3. Report to the reviewer.

## Weakest thing to report
Continue anyway on a listed site on plain http with nothing on 443, first visit: Chrome error page, no fallback. Cause not found. A non-listed site through the same block page falls back fine (runs 41343748469, 41345754526). Fails safe. companion-door logs it as `known:` and does not judge it.
Also: an unknown site is not held; it stays live until the scanner answers. An orange false alarm loses what was typed. Package grows 606 KB (masks 587 KB), worker +7.5 KB, nothing at rest. Scanner-called-red proof uses a proxy answer, not a real red verdict.
Two earlier claims of mine were wrong: "stuck tab is Chrome's upgrade, fixed by worker navigation" (no effect, reverted) and "test artefact" (only partly; the http-only case is real).

## Changelog draft
The browser companion now stops confirmed scam sites before they load, in Chrome and Firefox, with nothing slowed down.
The warning page, popup and settings were rebuilt to say one calm thing, and the emoji mask is gone.
