# r1204-polish (1.20.4)

Branch work/e2e-r1204-polish from origin/work/e2e-r1203-merge.

Done:
- CI masks job: Blender from actions/cache or mirrors, sha256 checked (02255c3).
- Caution ink #645e53 everywhere (look.js CAUTION_INK), card mask cropped to full height, companion tip data-status (2c4e271).

Next:
- Speed: first-visit Overview no longer waits on settings.js; first-run rows in their own chunk. Measure perf_base 5 rounds.
- CI: targeted verify-web (look, colour, serp-engines), test.yml (masks), then one full run on the final commit.
