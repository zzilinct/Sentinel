# r1203-status (1.20.3 items 4 and 5): paused

Branch work/e2e-r1203-status, head ddaf3fe (base merged to 93da7c3, 1.20.2). Work is done; only CI confirmation is left.

Done:
- Light caution mask: yellow (--yellow-glyph) edged in an ink hairline (--yellow-edge), not solid ink; card.js has no yellow disc. Dark is unchanged.
- [style*="--c:"] catch deleted. Callers set data-status (red, orange, yellow, green, unsure); sentinel.css gives --c. Home verdict icon is-* rules deleted.
- Checks: tests/look.test.js (seen to fail on the old code), 52-colour (mask fill and edge), 51-look (card mask, no disc), 01-site (reads data-status).
- Looked at: colour-marks-sheet desktop and phone, look-card-caution light and dark.

CI on ddaf3fe: Live, Desktop (fuses incl.), Browser checkup, Review screenshots: success.
- Test 44187319037 failed: masks job, curl 403 fetching a tool (outside cause).
- Website 44187318990 failed: 470/471; companion-core Firefox gave empty output (passed on 9d11bf2; companion untouched).
- Reruns of both were requested just before the pause; result not read.

Next: read the reruns of 44187319037 and 44187318990 (gh run view). If green, report. Earlier fails: fuses/live on 9d11bf2 were the 1.20.1 build auto-updating (fixed by the merge); the public check was a GitHub 503.
