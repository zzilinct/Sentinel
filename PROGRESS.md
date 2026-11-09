# bar-1 (spot 1: check tools and navigation)

Done: route.js classifier + tests/checkroute.test.js; one Check page (app.js checkView) replacing scanView, threatsView,
emailView, textView; sidebar in four groups; old /app/scan|threats|email|text open Check; dead CSS removed.
Next: update CI checks (06,11,12,13,15,19,21,30,40,42,47-calm-dig,47-honest-result, review-shots, perf-budget) to /app/check;
add a check that screenshots the Check page + sidebar (desktop+phone, light+dark); run CI; look at PNGs.
Status: commits 9849bc2 pushed (CI run 42098121990 website, 42098121914 review shots, 42098122033 test), 26a9778 local
(site links + manifest). Waiting on CI; then fix failures, download check-*.png, merge origin/main, full run, report.
