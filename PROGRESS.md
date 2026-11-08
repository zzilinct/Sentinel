# bar-17 (spot 17: empty states, entrances, sidebar highlight)

Built on work/e2e-bar-1. Done: app.js emptyState(kind) (waiting / clear / unavailable / nomatch, onyx-480 mask + seal,
static) replaces every inline `.empty`; app-lux.js remembers seen tabs in sessionStorage (no replay, no ghost on return,
#view.lux-again stills words, rule, meters, bars, overview mask entrance); one `.lux-plate` travels in the sidebar
(per-link ::before threads and lux-float deleted). CI check scripts/verify-web/49-empty.js ("empty", features job).
CI run 42529033246 (30a91d3, checks empty,appcore,layout,check): all pass; pictures read. Fixed after looking:
plate overshoot onto the search box (now ease-out), column of small masks in checkup (small = seal only). 73ced04 pushed.
Fail proof: branch work/e2e-bar-17-break (fresh = true), run 42529130155, checks=empty. GitHub API rate-limited 22:40 UTC.
Fail proof seen (break run: return staged 7, both memory checks FAIL). Rerun 42533150515 on 73ced04: empty all pass, pictures read.
Next: full run on final commit, report.
