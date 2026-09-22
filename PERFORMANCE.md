# Scan performance — 1.6.3

Measured locally on Node 24 using inert, offline fixtures against version 1.6.2 (`2acd5d5`). Timing varies with CPU and system load; these are stage-level measurements, not field detection or complete-scan latency guarantees.

## Results

| Workload | Before | After |
| --- | ---: | ---: |
| 1 MiB executable-shaped inert file | 11.22 ms | 4.54 ms |
| 10 MiB executable-shaped inert file | 59.82 ms | 32.88 ms |
| 25 MiB executable-shaped inert file | 97.08 ms | 54.41 ms |
| Compare one page against 5,000 fingerprints, median | 19.83 ms | 8.83 ms |
| Same comparison, 95th percentile | 28.25 ms | 11.31 ms |
| Simulated 60-URL shared-host research batch | 311.45 ms | 34.23 ms |

File measurements use alternating warmed implementations in the same process, six warmups and eleven measured rounds. Plain-text files improved little. The comparison benchmark measures 100 runs after ten warmups. The network benchmark uses three isolated runs per version, six concurrent URLs and fixed 20 ms simulated registry/DNS latency. It reduces DNS calls from 240 to 4 and registry calls from 6 to 1, retaining all 60 page checks. Real network services have different delays, caches and rate limits.

Run current-version benchmarks with `npm run benchmark:scans`. Each script can also run separately. Fixtures never execute file content, visit external sites or use the account database.

## Why no worker pool yet

Ordinary fresh URL scans in the small seeded dataset took about 0.58 ms each; most researched-link latency comes from network work. The existing URL batch pipeline already waits on multiple scans concurrently. Reducing CPU work and duplicate requests improves the current path without thread startup, buffer-copying or queue overhead.

File analysis remains synchronous. A large file or concurrent upload burst can still delay other requests; the measurements do not establish production responsiveness under heavy load. A bounded worker pool remains an option if concurrent-load measurements warrant it. It would need byte/queue limits and fresh signature lookup handling.

## Validation and remaining limits

The full suite passes 127 tests. New cases check fingerprint distances and boundaries, macro and entropy behavior, shared-domain lookup scope, page-specific content, DNS expiry and retry after upstream failures. Exact file reports also matched the previous implementation across 23 fixture invocations and 36 additional inert file/hash combinations.

DNS fact reuse never supplies the socket's address: every connection still uses netguard's fresh resolution and pinned public-address validation. Page cache keys remain URL-specific. This update does not shorten scan coverage, lower file limits, change confirmation thresholds, or add archive inspection.

Slow first-time DNS and inconsistent end-to-end scan deadlines remain follow-up work. Existing full-result research caching can still retain unavailable upstream facts; avoiding those entries requires consistent incomplete-result reporting. Full page research remains disabled in the desktop app; the fingerprint speedup applies where full page research is enabled.
