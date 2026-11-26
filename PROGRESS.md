# r1215-steady progress (paused)

Branch work/e2e-r1215-steady, final code commit e239541 (empty commit on top of the code). Nothing tagged or released.

## Done and proven
- Eval comparability: scripts/evaluate-modes.js now scores the frozen sample (94991cea78af) with no list loaded first ("RULES ALONE", verdict digest), prints the list snapshot per source and list hits per list. Two runs on one commit (45724406116, 45724416943): 165/300, digest 48e3e3238d43, identical. Cause of 278/278 vs 45/45: the other lists' contents on the day (code and sample unchanged).
- verify-web 52 colour hover: cause was a fixed 120 ms wait; the next gem needs about 71-107 ms to start lifting (measured in frames). Check now measures it, limit 500 ms. Run 45730666983: 6 of 6 pass. A 2-frame variant failed 5 of 8 (run 45726468643), showing the check fails when the lift is late.
- updater EPERM: clearCache retries once after 30 s (the installer can still hold its file). Unit test fails on old code (seen). Cause of the one CI failure (installer did not take, then app-update.yml reset so the test feed was lost) is NOT proven; desktop-core-qa.ps1 now prints install-folder, process, pending-rename and cache diagnostics when an update does not take. core-update passed on 45729024392.
- msedge-honest-checked: honest sites now answered from the runner (scripts/honest-sites.js, trusted cert, hosts file) for Edge and Chrome. Failed run cause: Sentinel reads the page's document address, which a slow real site does not give (up to 93 s). Run 45735536395 passes.
- clickfix-program-told: not reproduced in 10 of 10 (45726471937). Earlier failure showed reads stalled about 18 s right after the flag was logged. Root cause NOT proven; the check now repeats with -Repeat and prints reads, browsers and log tail on a miss.
- Page Down on a quiet page: watch.js Glide now reports a jump it cannot line up (changed band, input within 500 ms) as a lone pixel report; marks-at-rest.js --jump (limit 250 ms) in live-e2e. New copy: 51 ms and 84 ms (45733693942). Old 1.21.4: never / 27324 ms, check fails (45735451154).

## Found, not mine
- wallet-swap-restored missed 1 swap in 10 at repeat=10 (45726471937): a safety flake still open.

## Pending runs on e239541 (full run, started before the pause)
- Test 45740597561 success; Browser checkup 45740597894 success; Live scanning 45740597618 success.
- Still running: Desktop protections 45740597579, Review screenshots 45740597691, Website/QR/companion 45740597641.

## Left
- Read the three pending results; if desktop-e2e fails, check whether it is a known flake.
- Report (under 400 words) and two-line changelog.
