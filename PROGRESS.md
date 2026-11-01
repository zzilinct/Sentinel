# Bar 9 progress

Work is committed on work/e2e-bar-9 and mirrored to probe/bar-9, which does not trigger the full CI.

Done: helper foreground hook, supervised chat reader, black grab state, Roblox OCR gates, web chat reads only changed
messages, unit tests (seen failing on old code), scripts/desktop-reader-cost.ps1 and its CI job.

Waiting on: reader-cost after (41332344817), reader-cost before on probe/bar-9-base (41332380949), webchats (41332348826).

Next: compare cost.txt before and after, read the reader-stopped PNGs (desktop, phone, light, dark), fix what they show,
push work/e2e-bar-9 for the full CI as the final commit, report. Delete this file from the final commit.
