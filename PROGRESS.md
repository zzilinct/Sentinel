# Spot 7, pricing: where I am

Branch work/e2e-bar-7. Paused on 03ef201 (this file is the only commit after it).

Done since the coordinator's grade:
- Engraved sheet: gold rim, lathe work behind the prices, seal and "Nobody can be charged today." in the old empty cell, figures under the heading.
- Typed numbers gone from index.html:406, app.js:876, guest.html, README. plans.js only says "or upgrade" in demo billing.
- Free cell reads the real lock rule ("Not the newest 5"), tested against models.freeLockApplies.
- Guard covers every plan: raising Pro's fast minutes fails on popup.js ("24 hours</b> on Pro").
- Viewed on 03ef201: desktop dark top, desktop light Pro, phone scrolled, phone light sheet, app desktop, home phone.

Open:
1. verify job FAILED on 03ef201, cause not read yet. Run 41345664960: `gh run view 41345664960 -R zzilinct/Sentinel --log-failed`, grep "FAIL ". Fix it. 21-appcore and 15-layout are the likely ones.
2. LCP finding, to report: removing data-reveal did not change mobile /pricing LCP (3.07 s, now on the h1). The 2.1 s baseline was one lucky run (bar-14). The old page on bar-11 and bar-9 is also 3.0 s. Score 64, floor 63. Test still needs an honest note; old page scored 65-72 there, so check whether TBT moved.
3. App desktop: $100 sits tight in its column. Fix with container-relative font size on .ledger__price b if a further commit is needed anyway.
4. sentinel.css is +5.8 KB raw; planbook.js is 11.9 KB (Plan page only). Net CSS up, say so or trim.

For the coordinator, not edited by me:
- companion builder: extension/src/popup.js:158 (typed limits), :182 ("upgrade" link), extension/src/background.js:5 and background.firefox.js:207 (comments).
- download builder: web/download.html:135,137 (15 minutes), :72,:78 (old changelog text).

Next report starts with what I got wrong and what I learned, and needs a full CI pass on the final SHA, with desktop and phone, light and dark, re-viewed on that SHA.
