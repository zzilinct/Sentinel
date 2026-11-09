# bar-20 (spot 20: text and QR results) - PAUSED

Base: work/e2e-bar-1 + origin/main 1.19.4 (merged 2d8fa10). Head c19e7ef, pushed.
Done: one result page (ui.js result) fed by fromVerdict / fromText / fromQr; textResult, qrCard, explainQr, data-qr-out
and their CSS deleted; server coverage for /scan/text (failed links named by host, link gaps, links past 10, middle of
long chats) and /scan/qr (what a read-only code leaves unchecked; inline, since desktop copies qr.js alone); a QR link
is one answer (link verdict, "From a QR code"); land() focuses the heading and scrolls it into view (errors too);
the wait scrolls into view; phone scroll margin above the bottom bar. Unit tests plain/textscan/qr (seen failing when
fromText/fromQr default to clear). CI checks 03, 19, 21, 40, 42, 47-honest-result, 48, review-shots updated.
CI on 8e8b5e8: honest-result all pass (phone QR flow in view + focused, dark/light), appcore pass, Test, review
shots, live, checkup green; verify job failed only on 03-qr's slice marker (fixed in c19e7ef); Desktop protections
failed on wallet clipboard swap / menu start (not touched; likely runner flake, other branches mixed).
Screenshots looked at: honest-text-*, honest-qr-*, honest-flow-* (phone light/dark), desktop light/dark: correct.
Next: wait for the c19e7ef CI (runs 42540059059 web, 42540058775 desktop, 42540059057 test); if desktop protections
fails again, rerun failed jobs once to show it is a flake; then report.
Weakest: ui.js +1.9 KB gz also lands on login/signup pages (ui.js is shared); net app page +0.6 KB gz.
