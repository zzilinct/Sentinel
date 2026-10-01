# Changelog

## 1.8.9: live scanning accuracy and reliability

- Failed live scans stay pending and retry instead of appearing clean. Incomplete research and provisional verdicts expire promptly so a failed follow-up cannot suppress another scan.
- Search-result caches include the title and search context. The companion sends that context to the engine and rescans results whose address or title changes.
- Late scan responses are discarded after navigation or stopping protection, preventing warnings for pages that have already been left.
- Both clients unwrap nested search redirects and preserve encoded path and query characters in Bing ad destinations. The companion checks user-published Google Sites and Docs results and does not substitute an arbitrary URL parameter on an unrecognized site.
- Live research and exact-URL manual research have separate verdict caches, and short research deadlines do not join longer jobs. In-progress scans are isolated when threat knowledge is invalidated.
- Community confirmation requires independent verified accounts at least seven days old. Reports alone cannot condemn verified sites; exact malicious URL listings still apply.
- Companion 1.4.2 keeps private batches out of its local verdict cache, separates contextual verdicts, and does not cache fast fallback results as completed delicate research.

Validation: all 17 new regression tests pass. Local checks passed 200 tests; 14 process-dependent tests could not run successfully under the sandbox's child-process restrictions. The release workflow runs the full suite on Windows before publishing installers. No zero-error or real-world accuracy percentage is claimed.

## 1.6.3: scan performance

- File analysis counts byte frequencies more efficiently and avoids macro-text searches for files with no macros. File-size limits, sampled bytes and detection rules are unchanged.
- Page-fingerprint comparison counts differing bits in larger chunks while preserving exact distances and confirmation thresholds.
- Related URLs share pending registry and DNS lookups. Successful DNS facts are reused for 30 seconds; socket connections still perform their own fresh, pinned address validation. Each page retains its separate content check.
- Temporary registry failures no longer populate the day-long registry cache; they can be retried on the next uncached research request.
- Added repeatable offline benchmarks and eight regression tests. The full suite passes 127 tests.

Local synthetic benchmarks measured 44–60% less time for executable-shaped file fixtures and 55% less time comparing a page against 5,000 fingerprints. A simulated 60-link batch on one host made 4 DNS requests instead of 240 and 1 registry request instead of 6, while retaining all 60 page checks. These measure specific stages, not a promised end-to-end speedup. Network latency and workload still affect scan time. See [benchmark details](PERFORMANCE.md).

## 1.6.2: account and verdict corrections

- Invalid plan names now return a validation error instead of breaking account and usage responses. Existing invalid stored plans fall back to Free.
- Live scanning honors a minute already recorded in the database after the server restarts or its memory cache is cleared.
- History entries and totals now use the same 30-day window.
- Community reports retain their scam or malware classification. Reports for different threat types no longer combine to confirm a threat, and malware reports do not also raise the scam mask.
- A front-page threat listing no longer upgrades a different feed's unrelated threat type to confirmed.
- Research preserves previously observed redirect hops when a later destination fails or is blocked, so known threats earlier in the chain remain visible.

Validation: all six new regression cases failed before their fixes. The full suite passes 119 tests. Broader scanning features and moderation-policy redesigns are not part of this maintenance release.

## 1.6.1: scanning reliability

- Fresh threat-feed imports now invalidate old scan verdicts.
- Research results stay separate for URLs with different query strings or protocols.
- Repeat scans of downloads without filename extensions retain their file checks.
- Interrupted downloads are marked incomplete instead of being fingerprinted as whole files. Failed and partial research results are not cached as completed scans.
- Shortcut headers and UTF-16 script text are checked correctly by the existing file rules.
- Email scans check pasted links and up to 60 linked addresses, with clear reporting when checks fail or hit the limit.
- Redirect checks cover intermediate and same-site destinations, with points assigned to the correct threat type.
- Research network restrictions consistently reject private and reserved IPv6 destinations.

Validation: 113 automated tests passed. These are bug fixes; no new scanning mode or archive-scanning capability is included.

The shared scanner fixes apply to the embedded desktop server and the server-backed web app. Full page fetching remains disabled on desktop. The marketing website remains static; this update does not deploy a hosted scanning API.

See [the code review](CODE_REVIEW.md) for suggested future improvements. A version entry describes the prepared source; published installers are listed on [GitHub Releases](https://github.com/zzilinct/Sentinel/releases).
