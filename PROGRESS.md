# bar-17 (spot 17: empty states, entrances, sidebar highlight)

Built on work/e2e-bar-1. Done: app.js emptyState(kind) (waiting / clear / unavailable / nomatch, onyx-480 mask + seal,
static) replaces every inline `.empty`; app-lux.js remembers seen tabs in sessionStorage (no replay, no ghost on return,
#view.lux-again stills words, rule, meters, bars, overview mask entrance); one `.lux-plate` travels in the sidebar
(per-link ::before threads and lux-float deleted). CI check scripts/verify-web/49-empty.js ("empty", features job).
Next: CI run with checks=empty,appcore,layout,check,perf-a11y; read empty-*.png; prove the check fails on a break; full run; report.
