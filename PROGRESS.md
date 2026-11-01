# Bar 16, download page: paused

Done and pushed on work/e2e-bar-16:
- Page rebuilt (web/download.html, web/assets/css/download.css, web/assets/js/download.js), note generated from changelog
  (scripts/release-note.js, web/partials/release-note.html, npm run build:note), tests/download-page.test.js, verify check
  scripts/verify-web/48-download-page.js. npm test: 733 pass on 0c91aa9.
- Last pushed commit is marked [skip ci]. Run 41349292085 (checks=download-page,galaxy) was in progress when paused.

Next:
1. Read run 41349292085. On 0c91aa9 the only failures were my height budget (now 7,000 phone, 4,400 desktop) and
   galaxy "(computer dark): a click enlarges the card", on the home page. Prove whether galaxy is flaky or mine.
2. Set .section__head margin-bottom tighter in download.css if the page still feels long; adjust the budget to measured.
3. Final commit without [skip ci], wait for all runs, read the shots, report.

Before figure: old page was 7 desktop and 8 phone screenshot parts (artifact 13016439000, in the scratchpad old/ folder).
New on 0c91aa9: 4 desktop, 6 phone parts; 4,686 px desktop, 7,376 px phone, before the spacing commit.
