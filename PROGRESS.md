# bar-17 (spot 17: empty states, entrances, sidebar highlight)

Built on work/e2e-bar-1. Done: app.js emptyState(kind) (waiting / clear / unavailable / nomatch, onyx-480 mask + seal,
static) replaces every inline `.empty`; app-lux.js remembers seen tabs in sessionStorage (no replay, no ghost on return,
#view.lux-again stills words, rule, meters, bars, overview mask entrance); one `.lux-plate` travels in the sidebar
(per-link ::before threads and lux-float deleted). CI check scripts/verify-web/49-empty.js ("empty", features job).
CI run 42529033246 (30a91d3, checks empty,appcore,layout,check): all pass; pictures read. Fixed after looking:
plate overshoot onto the search box (now ease-out), column of small masks in checkup (small = seal only). 73ced04 pushed.
Fail proof: branch work/e2e-bar-17-break (fresh = true), run 42529130155, checks=empty. GitHub API rate-limited 22:40 UTC.
Fail proof seen (break run: return staged 7, both memory checks FAIL). Rerun 42533150515 on 73ced04: empty all pass, pictures read.
PAUSED (owner). Full run on 5d6afd9: Test, Live scanning e2e, Browser checkup e2e pass; Review screenshots 42534464713
FAILED (not yet looked at: may be mine, e.g. a shot expecting the old empty or sidebar plate, or an outside cause);
Website 42534464723 and Desktop protections 42534464718 were still running.
Next on continue: read 42534464713's log (gh run view --log-failed), fix or prove outside cause; confirm the two running
runs; then report (fail proof done, pictures read, bytes: app.js +2.0K, app-lux.js +3.3K, app.css +2.4K, app-lux.css +0.9K raw,
onyx-480.webp 25K once on empty pages; lux-float per-frame loop deleted).
