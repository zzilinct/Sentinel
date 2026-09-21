# Sentinel code review — September 21, 2026

Reviewed version 1.6.0 at `f678646`, focusing on scanning, network research, email handling, feed updates, and the surrounding API, desktop and release code. Only bug fixes were implemented. Broader changes below remain suggestions.

## Fixed

| Bug | Correction |
| --- | --- |
| Research for different query strings or protocols could reuse the same page result; long paths also collided after truncation. | Cache full request URLs using a fixed-length digest, excluding fragments. Keep desktop registry/DNS caching separate. |
| An extensionless download could lose its hash check after the short-lived verdict cache expired, because the research cache discarded its bytes. | Do not persist download research without the content needed to scan it. |
| Failed or partial research could be retained as a normal result. Interrupted downloads were also treated as complete files. | Mark interrupted bodies incomplete, skip whole-file hashing of partial content, add a coverage warning, and avoid caching failed/partial results. |
| The shortcut detector compared a twelve-byte signature against an eight-byte sample, so it never matched. UTF-16 script commands also went unread. | Validate the complete shortcut header and decode UTF-16 script/shortcut text before existing command checks. |
| Email scanning silently stopped after 25 links and omitted URLs pasted into plain text. | Scan up to the existing 60-link limit, extract plain-text URLs, and check the sender separately so it cannot fall off the limit. |
| Failed email link checks could count as passes; capped input appeared fully checked. | Return checked/failed coverage counts, skip unavailable checks, and label otherwise unflagged incomplete scans accurately. Preserve truncation through API input cleaning. |
| Same-domain and intermediate redirects escaped reputation checks. Malware-only redirect matches also added scam points. | Check every observed destination and apply evidence/points to the matching threat types. |
| Alternate IPv6 spellings of private destinations bypassed string-based network restrictions. | Normalize IPv6 numerically and reject private/reserved and transition destinations consistently. |
| Feed imports left old verdicts usable for ten minutes. A local reproduction stayed `safe` after import and became `confirmed` only after manual invalidation. | Version cache keys after imports and background refresh completion; scans started before the refresh cannot fill the new cache generation. |

Validation: **113 automated tests passed**, covering detection, API behavior, authentication, network guards, static builds, extension checks and desktop tests. Regression fixtures are inert and local. This does not establish real-world detection accuracy or replace installed-app/browser testing.

## Suggested next work — not implemented

| Priority | Suggestion | Reason and relevant code |
| --- | --- | --- |
| High | Apply one end-to-end scan deadline, with cancellation and caller-specific waiting. | `research.js` bounds registration and page promises, but DNS remains outside that budget. `engine.js` and research share in-flight work without considering caller budgets; a short live scan can join longer work. Test delayed DNS, slow response streams and concurrent manual/live scans. |
| High | Review reports before making them confirmed threats. | `scan.routes.js` promotes after three accounts report a domain; `knowledge.js` also independently treats three reports as confirmed scam evidence. Account count alone does not establish independent evidence, and malware reports can acquire an additional scam label. Define moderation, evidence and appeal rules before changing that policy. |
| High | Remove runtime backup/lock artifacts from future commits and inspect the tracked backup privately. | `data/sentinel.db.backup` and `data/sentinel.db.lock` are tracked; `.gitignore` covers the primary database but misses these suffixes. I did not inspect or publish account contents. Determine whether historical cleanup is needed based on the backup's actual contents. |
| High | Run the full test suite on pull requests and main-branch pushes. | `.github/workflows/release.yml` runs tests for releases, while ordinary source pushes have no general test workflow. Catch regressions before tagging a build. |
| Medium | Add bounded archive-content inspection. | `filescan.js` primarily checks ZIP entry names and selected Office/APK content. Recursive scanning could find renamed or nested threats. Cap total inflated bytes, entries, recursion, compression ratio and CPU time; explicitly mark encrypted/unsupported entries uninspected. This is an additional capability, so it was not included in the bug fixes. |
| Medium | Measure detection quality with a held-out corpus. | Extend the existing evaluation scripts with separate benign/malicious sets, per-threat false-positive/false-negative rates, and latency percentiles. Keep evaluation samples separate from rules and fixtures used to tune the scanner. Passing handcrafted tests does not measure field accuracy. |
| Medium | Make trust rules aware of user-controlled paths. | `knowledge.js` and `engine.js` skip research on trusted hosts. Exact listed URLs still work, but a previously unseen upload on an allowlisted service can inherit too much trust. Scope exemptions to owned pages and distinguish upload areas. |
| Medium | Profile file analysis before moving heavy work off the request thread. | Hashing, string inspection, entropy and limited decompression in `filescan.js` are synchronous. Measure concurrent large uploads; if they delay unrelated requests, use a bounded worker pool and queue. |
| Medium | Unify incomplete-scan reporting across clients. | Email now returns coverage; partial downloads have checklist warnings. A consistent coverage field and visible desktop/extension/web treatment would make unavailable checks easier to understand without treating uncertainty as a threat verdict. |

## Operational boundaries

The current repository contains a server implementation and an embedded desktop server; that is different from having a deployed hosted service. Full page research remains disabled on desktop, with registry/DNS-only research available. Hosted email delivery, real billing and any optional external reputation integration still depend on their configuration and deployment. These are setup/product decisions, not fixed by source changes in this review.

No installer release or deployment was performed as part of this review. Source fixes reach installed desktop copies only after a new release is built and distributed.
