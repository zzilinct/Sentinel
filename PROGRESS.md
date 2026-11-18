# r1204-polish (1.20.4)

Branch work/e2e-r1204-polish from origin/work/e2e-r1203-merge.

Done:
- CI masks job: Blender from actions/cache or mirrors, sha256 checked (02255c3).
- Caution ink #645e53 everywhere (look.js CAUTION_INK), card mask cropped to full height, companion tip data-status (2c4e271).

Next:
- Speed: app/first.js split (3853e78). perf_base 5 rounds mobile /app medians: base perf 90 LCP 3530 ms 274 KB; branch perf 93 LCP 3214 ms 252 KB.
- CI: targeted verify-web green (44393072355), test.yml green (44393076422). Final: full verify-web + desktop-e2e.
