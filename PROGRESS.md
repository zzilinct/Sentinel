# bar-20 (spot 20: text and QR results)

Base: work/e2e-bar-1 + origin/main 1.19.4 (merged 2d8fa10).
Done: one result page (ui.js result) fed by fromVerdict / fromText / fromQr; textResult, qrCard, explainQr, data-qr-out
and their CSS deleted from app.js/app.css; server coverage for /scan/text (failed links by host, link gaps, unread links)
and /scan/qr (what a read-only code leaves unchecked); a QR link is one answer (the link verdict, "From a QR code");
land() focuses the heading and brings it into view on every path; the wait scrolls into view; phone scroll margin
above the bottom bar. Unit tests in plain.test.js, textscan.test.js, qr.test.js; CI checks 47-honest-result (text and
QR states, phone QR flow), 21, 19, 40, 42, 48, review-shots updated.
Next: push, one background CI wait, download honest-*.png and honest-flow-*.png, look, fix, report.
