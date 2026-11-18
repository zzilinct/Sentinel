# r1204-polish (1.20.4)

Branch work/e2e-r1204-polish from origin/work/e2e-r1203-merge.

Done:
- CI masks job: Blender from actions/cache or mirrors, sha256 checked (02255c3).
- Caution ink #645e53 everywhere (look.js CAUTION_INK), card mask cropped to full height, companion tip data-status (2c4e271).

Next:
- Speed: app/first.js split (3853e78). perf_base 5 rounds mobile /app medians: base perf 90 LCP 3530 ms 274 KB; branch perf 93 LCP 3214 ms 252 KB.
- CI: targeted verify-web green (44393072355), test.yml green (44393076422). Final: full verify-web + desktop-e2e.

Final full runs on e9459a4: desktop-e2e 44395144443 green. verify-web 44395138573 red in features: companion-door, hero-phone (390 dark), motion-level.
Not this branch (proved):
- Rerun of those three checks, twice, on this branch (44406557687, runner image 20261103.298.1): all pass.
- Same checks, twice, on base dd659af without these changes (44406768519, image 20261116.315.1): companion-door fails both times the same way (block page at #https://, Continue anyway to chrome-error), motion-level fails once with the same signature (mask3d canvas opacity 900 ms still running at Off).
- The failed run was on image 20261116.315.1. hero-phone failed once only (unmask clip at 84.9999%, the animation not yet ended) and passed 4 of 4 since.
