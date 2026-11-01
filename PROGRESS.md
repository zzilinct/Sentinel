# Bar 15, practice inbox: paused

Done and pushed on work/e2e-bar-15 (interim commits use [skip ci]):
- web/practice.html, web/assets/js/practice.js, web/assets/css/practice.css replaced: inbox with stacked rows, dialog
  sheet, sender and link peek island, Report asks what gave it away, verdict card, second look, end ledger.
- tests/practice.test.js and scripts/verify-web/08-practice.js rewritten. scripts/review-shots.js and web/llms.txt updated.
- anime.min.js and lux.js dropped from practice.html, to offset the larger pool.
- Node tests pass: practice and static, 22 of 22.

In flight: verify-web run 41340242412 (checks=practice), not yet read. May finish or need a re-dispatch.

Next:
1. Read run 41340242412, or dispatch again: gh workflow run verify-web.yml --ref work/e2e-bar-15 -f checks=practice
2. Download artifact verify-web-features. Read practice-{phone,desktop}-{dark,light}-{list,open,report,verdict,end}.png
   and practice-phone-dark-pile.png. Fix what looks wrong. The sticky pile is unproven (an ancestor overflow would break it).
3. Check the rest-state animation result and the perf budget. CSS grew; state the bytes.
4. See a browser check fail, not only a unit test (break something on purpose, then undo).
5. Final commit without [skip ci], full CI, then the report that builder.md asks for.
